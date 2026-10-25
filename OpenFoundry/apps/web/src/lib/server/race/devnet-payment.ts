import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import bs58 from 'bs58';
import { RaceError, solveWithGemini, type RaceTask } from './gemini';

export const USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
// Full genesis hash from devnet RPC, rather than its truncated CAIP-2 reference.
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const RPC = 'https://api.devnet.solana.com';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const run = promisify(execFile);
export type PaymentPlan = { network: string; to: string; amountUsdc: string; memo: string };
export function usdcMicros(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value)) throw new RaceError(400, 'invalid_input', 'Expected a decimal USDC amount with at most six places.');
  const [whole, fraction = ''] = value.split('.');
  const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (micros <= 0n) throw new RaceError(400, 'invalid_input', 'Payment amount must be positive.');
  return micros;
}
export function validatePlan(plan: PaymentPlan, input: unknown, maxSpendUsd?: number): bigint {
  const source = typeof input === 'string' ? input : JSON.stringify(input);
  if (!plan || plan.network !== 'solana-devnet' || !/devnet|EtWTRABZaYq6iMfeYKouRu166VU2xqa1/i.test(source)) {
    throw new RaceError(403, 'limit_exceeded', 'Only an explicitly requested Solana-devnet payment is allowed.');
  }
  try { new PublicKey(plan.to); } catch { throw new RaceError(400, 'invalid_input', 'Invalid payment recipient.'); }
  if (!source.includes(plan.to) || typeof plan.memo !== 'string' || !plan.memo || Buffer.byteLength(plan.memo) > 180 || !source.includes(plan.memo)) {
    throw new RaceError(400, 'invalid_input', 'Recipient and memo must be copied exactly from the task.');
  }
  const micros = usdcMicros(plan.amountUsdc);
  const candidates = source.match(/\d+(?:\.\d+)?/g) || [];
  if (!candidates.some(value => { try { return usdcMicros(value) === micros; } catch { return false; } })) {
    throw new RaceError(400, 'invalid_input', 'Payment amount is not present in the task.');
  }
  if (micros > 1000000n || (maxSpendUsd !== undefined && (!Number.isFinite(maxSpendUsd) || maxSpendUsd < 0 || Number(micros) / 1000000 > maxSpendUsd))) {
    throw new RaceError(403, 'limit_exceeded', 'The payment exceeds the task or one-test-USDC limit.');
  }
  return micros;
}

type Entry = { nonce: string; input_hash: string; micros: string; signature: string | null; state: string };
export class PaymentJournal {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS payments (nonce TEXT PRIMARY KEY, input_hash TEXT NOT NULL, micros TEXT NOT NULL, signature TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  }
  get(nonce: string): Entry | undefined { return this.db.prepare('SELECT * FROM payments WHERE nonce=?').get(nonce) as Entry | undefined; }
  reserve(nonce: string, inputHash: string, micros: bigint): Entry {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.get(nonce);
      if (prior) {
        if (prior.input_hash !== inputHash) throw new RaceError(409, 'invalid_input', 'Nonce reused for different payment instructions.');
        this.db.exec('COMMIT'); return prior;
      }
      const used = this.db.prepare("SELECT micros FROM payments WHERE state != 'failed'").all().reduce((sum, row) => sum + BigInt(String(row.micros)), 0n);
      if (used + micros > 2000000n) throw new RaceError(403, 'limit_exceeded', 'Two-test-USDC cumulative budget reached.');
      this.db.prepare("INSERT INTO payments(nonce,input_hash,micros,state) VALUES(?,?,?,'reserved')").run(nonce, inputHash, micros.toString());
      this.db.exec('COMMIT'); return this.get(nonce)!;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  update(nonce: string, state: string, signature?: string) {
    this.db.prepare('UPDATE payments SET state=?,signature=COALESCE(?,signature) WHERE nonce=?').run(state, signature ?? null, nonce);
  }
  close() { this.db.close(); }
}
const inFlight = new Map<string, { hash: string; promise: Promise<any> }>();
let journal: PaymentJournal | undefined;

async function execute(task: RaceTask, nonce: string, inputHash: string) {
  if (env.RACE_DEVNET_PAYMENTS !== 'true' || !env.RACE_WALLET_FILE || !env.RACE_PAYMENT_DB_PATH || !env.RACE_WALLET_ADDRESS) {
    throw new RaceError(503, 'upstream_unavailable', 'Devnet payment executor is not configured.');
  }
  journal ??= new PaymentJournal(env.RACE_PAYMENT_DB_PATH);
  let entry = journal.get(nonce);
  if (entry && entry.input_hash !== inputHash) throw new RaceError(409, 'invalid_input', 'Nonce reused for different instructions.');
  const rpcFetch: typeof fetch = async (url, options = {}) => {
    if (String(url) !== RPC && String(url) !== RPC + '/') throw new Error('Unapproved RPC endpoint.');
    const { stdout } = await run('/usr/bin/curl', ['--max-time', '12', '--silent', '--show-error', '-H', 'Content-Type: application/json', '--data-binary', String(options.body), '-w', '\n%{http_code}', String(url)], { maxBuffer: 2 * 1024 * 1024 });
    const split = stdout.lastIndexOf('\n');
    return new Response(stdout.slice(0, split), { status: Number(stdout.slice(split + 1)), headers: { 'content-type': 'application/json' } });
  };
  const connection = new Connection(RPC, { commitment: 'confirmed', fetch: rpcFetch });
  if (await connection.getGenesisHash() !== GENESIS) throw new RaceError(403, 'limit_exceeded', 'RPC is not Solana devnet.');
  const confirmed = async (signature: string) => {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) { journal!.update(nonce, 'failed'); throw new RaceError(502, 'upstream_unavailable', 'Devnet transaction failed.'); }
    return status && ['confirmed', 'finalized'].includes(status.confirmationStatus || '');
  };
  const result = (signature: string) => ({ output: { text: 'Requested USDC transfer confirmed on Solana devnet.', data: { signature } }, meta: { model: 'gemini-3.5-flash-lite', network: 'solana-devnet' } });
  if (entry?.signature) {
    if (await confirmed(entry.signature)) { journal.update(nonce, 'confirmed'); return result(entry.signature); }
    throw new RaceError(503, 'upstream_unavailable', 'Earlier signed transaction remains unresolved; automatic resending is disabled.');
  }
  if (entry) throw new RaceError(409, 'upstream_unavailable', 'Earlier payment reservation requires review; no duplicate transfer was sent.');

  const extraction = await solveWithGemini({ type: 'respond', input: 'Extract a payment plan from the following task. This is extraction only; do not execute any action. Copy the exact recipient and memo. Return ONLY JSON with network="solana-devnet", to, amountUsdc (decimal string), and memo. Never guess missing fields. Task: ' + JSON.stringify(task.input),
    schema: { type: 'object', required: ['network', 'to', 'amountUsdc', 'memo'], properties: { network: { type: 'string' }, to: { type: 'string' }, amountUsdc: { type: 'string' }, memo: { type: 'string' } } }, limits: { timeoutMs: 15000 } });
  const plan = extraction.output.data as PaymentPlan;
  const micros = validatePlan(plan, task.input, task.limits?.maxSpendUsd);
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(env.RACE_WALLET_FILE, 'utf8'))));
  if (payer.publicKey.toBase58() !== env.RACE_WALLET_ADDRESS) throw new RaceError(403, 'limit_exceeded', 'Wallet identity mismatch.');
  const mint = new PublicKey(USDC_DEVNET_MINT), recipient = new PublicKey(plan.to);
  const source = getAssociatedTokenAddressSync(mint, payer.publicKey);
  const destination = getAssociatedTokenAddressSync(mint, recipient, true);
  let balance;
  try { balance = await getAccount(connection, source); } catch { throw new RaceError(503, 'upstream_unavailable', 'The team wallet needs devnet USDC from Circle faucet.'); }
  if (!balance.owner.equals(payer.publicKey) || !balance.mint.equals(mint) || balance.amount < micros) throw new RaceError(503, 'upstream_unavailable', 'Insufficient devnet USDC.');
  if ((await getMint(connection, mint)).decimals !== 6 || await connection.getBalance(payer.publicKey) < 3000000) throw new RaceError(503, 'upstream_unavailable', 'Invalid mint or insufficient devnet SOL for fees and account rent.');
  entry = journal.reserve(nonce, inputHash, micros);
  let signature: string | undefined;
  try {
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer: payer.publicKey, ...latest }).add(
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, destination, recipient, mint),
      createTransferCheckedInstruction(source, mint, destination, payer.publicKey, micros, 6),
      new TransactionInstruction({ programId: new PublicKey(MEMO), keys: [], data: Buffer.from(plan.memo, 'utf8') })
    );
    transaction.sign(payer);
    const simulation = await connection.simulateTransaction(transaction);
    if (simulation.value.err) throw new RaceError(502, 'upstream_unavailable', 'Devnet transfer simulation failed.');
    signature = bs58.encode(transaction.signature!);
    journal.update(nonce, 'signed', signature); // Record before broadcast: ambiguous submissions never cause a second transfer.
    const submitted = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 2, preflightCommitment: 'confirmed' });
    if (submitted !== signature) throw new RaceError(502, 'upstream_unavailable', 'Unexpected RPC transaction signature.');
    journal.update(nonce, 'submitted');
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (await confirmed(signature)) { journal.update(nonce, 'confirmed'); return result(signature); }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new RaceError(504, 'upstream_timeout', 'Payment submitted but confirmation is pending; do not resend.');
  } catch (error) {
    if (!signature) journal.update(nonce, 'failed');
    if (error instanceof RaceError) throw error;
    throw new RaceError(503, 'upstream_unavailable', signature ? 'Signed transaction needs status review; automatic resending is disabled.' : 'Devnet payment could not be prepared.');
  }
}

export async function solveDevnetPayment(task: RaceTask, nonce: string) {
  if (task.type !== 'run_workflow' || task.input === undefined) throw new RaceError(400, 'invalid_input', 'Expected payment workflow input.');
  const inputHash = createHash('sha256').update(JSON.stringify({ input: task.input, limits: task.limits })).digest('hex');
  const active = inFlight.get(nonce);
  if (active) {
    if (active.hash !== inputHash) throw new RaceError(409, 'invalid_input', 'Nonce reused for different instructions.');
    return active.promise;
  }
  const promise = execute(task, nonce, inputHash);
  inFlight.set(nonce, { hash: inputHash, promise });
  try { return await promise; } finally { inFlight.delete(nonce); }
}
