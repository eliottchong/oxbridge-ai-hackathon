import { Connection, PublicKey, Transaction, TransactionInstruction, type Signer } from '@solana/web3.js';
import { ACCOUNT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import bs58 from 'bs58';
import { setTimeout as delay } from 'node:timers/promises';
import { ApiError } from '../preflight/errors';

export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
export const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export type Payment = { network: 'solana-devnet'; to: string; amountUsdc: string; memo: string };
export type SignedPayment = Payment & { signature: string; transaction: string; blockhash: string; lastValidBlockHeight: number; sender: string; sourceAta: string; destinationAta: string };

export function amountUnits(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,13})(\.\d{1,6})?$/.test(value)) throw new ApiError(400, 'INVALID_AMOUNT', 'amountUsdc must be a positive decimal string with at most six decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n) throw new ApiError(400, 'INVALID_AMOUNT', 'USDC amount is outside the supported range.');
  return amount;
}

export function validatePayment(input: unknown): Payment {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'INVALID_INSTRUCTIONS', 'Supply payment instructions as an object.');
  const value = input as Record<string, unknown>;
  if (value.network !== 'solana-devnet') throw new ApiError(400, 'DEVNET_ONLY', 'Only network solana-devnet is supported.');
  const units = amountUnits(value.amountUsdc);
  try { if (typeof value.to !== 'string' || new PublicKey(value.to).toBase58() !== value.to) throw new Error(); }
  catch { throw new ApiError(400, 'INVALID_RECIPIENT', 'to must be a valid Solana wallet address.'); }
  if (typeof value.memo !== 'string' || !value.memo.length || Buffer.byteLength(value.memo, 'utf8') > 512 || Buffer.from(value.memo, 'utf8').toString('utf8') !== value.memo) throw new ApiError(400, 'INVALID_MEMO', 'memo must contain 1–512 valid UTF-8 bytes. It is preserved exactly.');
  return { network: 'solana-devnet', to: value.to as string, amountUsdc: (units / 1_000_000n).toString() + '.' + (units % 1_000_000n).toString().padStart(6, '0'), memo: value.memo };
}

export async function requireDevnet(connection: Connection) {
  if (await connection.getGenesisHash() !== DEVNET_GENESIS) throw new ApiError(400, 'WRONG_CLUSTER', 'RPC is not Solana devnet. Payment blocked.');
}

export async function prepareUsdc(signer: Signer, request: Payment, connection: Connection): Promise<SignedPayment> {
  const payment = validatePayment(request);
  await requireDevnet(connection);
  const recipient = new PublicKey(payment.to);
  if (recipient.equals(signer.publicKey)) throw new ApiError(400, 'SELF_PAYMENT', 'Recipient must differ from the agent wallet.');
  const mint = await getMint(connection, USDC_MINT, 'confirmed');
  if (mint.decimals !== 6) throw new ApiError(400, 'WRONG_MINT', 'Expected the six-decimal devnet USDC mint.');
  const source = getAssociatedTokenAddressSync(USDC_MINT, signer.publicKey);
  const destination = getAssociatedTokenAddressSync(USDC_MINT, recipient, true);
  let sourceAccount;
  try { sourceAccount = await getAccount(connection, source, 'confirmed'); }
  catch { throw new ApiError(422, 'USDC_REQUIRED', 'Fund the agent wallet with Solana devnet USDC from faucet.circle.com.'); }
  if (sourceAccount.amount < amountUnits(payment.amountUsdc)) throw new ApiError(422, 'INSUFFICIENT_USDC', 'Agent wallet has insufficient devnet USDC.');
  const lifetime = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ feePayer: signer.publicKey, ...lifetime }).add(
    createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, destination, recipient, USDC_MINT),
    new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(payment.memo, 'utf8') }),
    createTransferCheckedInstruction(source, USDC_MINT, destination, signer.publicKey, amountUnits(payment.amountUsdc), 6),
  );
  const fee = (await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed')).value;
  if (fee === null) throw new ApiError(503, 'FEE_UNAVAILABLE', 'Could not estimate devnet transaction fees. Retry this task.');
  const destinationExists = await connection.getAccountInfo(destination, 'confirmed');
  const rent = destinationExists ? 0 : await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, 'confirmed');
  if (await connection.getBalance(signer.publicKey, 'confirmed') < fee + rent) throw new ApiError(422, 'SOL_REQUIRED', 'Fund the agent wallet with devnet SOL for fees and recipient token-account rent at faucet.solana.com.');
  transaction.sign(signer);
  return { ...payment, signature: bs58.encode(transaction.signature!), transaction: transaction.serialize().toString('base64'), ...lifetime, sender: signer.publicKey.toBase58(), sourceAta: source.toBase58(), destinationAta: destination.toBase58() };
}

export async function verifyPayment(connection: Connection, payment: SignedPayment) {
  const transaction = await connection.getParsedTransaction(payment.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!transaction) throw new ApiError(503, 'PAYMENT_PENDING', 'Transaction confirmation is not yet readable. Retry the same task ID.');
  if (!transaction.meta || transaction.meta.err !== null) throw new ApiError(422, 'TRANSACTION_FAILED', 'The devnet transaction failed. No successful payment result returned.');
  const instructions = transaction.transaction.message.instructions;
  const transfer = instructions.find(instruction => {
    if (!('parsed' in instruction) || instruction.parsed?.type !== 'transferChecked') return false;
    const info = instruction.parsed.info;
    return instruction.programId.equals(TOKEN_PROGRAM_ID) && instruction.program === 'spl-token' && info.mint === USDC_MINT.toBase58() && info.source === payment.sourceAta && info.destination === payment.destinationAta && info.authority === payment.sender && info.tokenAmount?.amount === amountUnits(payment.amountUsdc).toString() && info.tokenAmount?.decimals === 6;
  });
  const memo = instructions.find(instruction => instruction.programId.equals(MEMO_PROGRAM) && ('parsed' in instruction ? instruction.parsed === payment.memo : Buffer.from(bs58.decode(instruction.data)).toString('utf8') === payment.memo));
  if (!transfer || !memo || transaction.transaction.signatures[0] !== payment.signature || !transaction.transaction.message.accountKeys.some(key => key.signer && key.pubkey.toBase58() === payment.sender)) throw new ApiError(409, 'PAYMENT_MISMATCH', 'On-chain transfer or memo does not match the task.');
}

export async function settleUsdc(connection: Connection, payment: SignedPayment, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<string> {
  await requireDevnet(connection);
  const transaction = Transaction.from(Buffer.from(payment.transaction, 'base64'));
  if (!transaction.verifySignatures() || bs58.encode(transaction.signature!) !== payment.signature) throw new ApiError(409, 'INVALID_SAVED_TRANSACTION', 'Saved payment transaction is invalid.');
  const deadline = Date.now() + (options.timeoutMs ?? 45_000);
  let sent = false;
  do {
    const status = (await connection.getSignatureStatuses([payment.signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new ApiError(422, 'TRANSACTION_FAILED', 'The devnet transaction failed. No successful payment result returned.');
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      await verifyPayment(connection, payment);
      return payment.signature;
    }
    if (!status && await connection.getBlockHeight('confirmed') > payment.lastValidBlockHeight) throw new ApiError(409, 'PAYMENT_EXPIRED', 'Saved transaction expired without confirmed success. It will not be replaced automatically; reconcile this signature before authorising another payment.');
    if (!sent && !status) {
      // The exact signed bytes are durable before broadcast. An RPC timeout never creates a new transfer.
      try {
        const signature = await connection.sendRawTransaction(Buffer.from(payment.transaction, 'base64'), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
        if (signature !== payment.signature) throw new ApiError(409, 'SIGNATURE_MISMATCH', 'RPC returned an unexpected transaction signature.');
      } catch (error) { if (error instanceof ApiError) throw error; /* Reconcile ambiguous submission through its saved signature. */ }
      sent = true;
    }
    await delay(options.pollMs ?? 1500);
  } while (Date.now() < deadline);
  throw new ApiError(503, 'PAYMENT_PENDING', 'Payment is not confirmed yet. Retry the same task ID; never create a replacement task to retry.');
}

/** Same call shape as Builder's helper. persistSigned MUST complete before any broadcast. */
export async function payUsdc(signer: Signer, request: Payment, options: { connection: Connection; persistSigned: (payment: SignedPayment) => void }): Promise<string> {
  const payment = await prepareUsdc(signer, request, options.connection);
  options.persistSigned(payment);
  return settleUsdc(options.connection, payment);
}
