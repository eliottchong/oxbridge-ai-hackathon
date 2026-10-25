import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Connection, Signer } from '@solana/web3.js';
import { ApiError } from '../preflight/errors';
import { payUsdc, settleUsdc, validatePayment, type Payment, type SignedPayment } from './solana';

export type WorkflowTask = { type: 'run_workflow'; taskId: string; instructions: Payment | string };
export type WorkflowOutput = { output: { data: { signature: string } } };
type PaymentRow = { request_hash: string; state: string; lease: string; lease_until: number; signed: string | null };

export function parseTask(input: unknown): { taskId: string; payment: Payment } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'INVALID_TASK', 'Supply a run_workflow task object.');
  const task = input as Record<string, unknown>;
  if (task.type !== 'run_workflow') throw new ApiError(400, 'INVALID_TASK', 'Only run_workflow tasks are supported.');
  if (typeof task.taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(task.taskId)) throw new ApiError(400, 'INVALID_TASK_ID', 'taskId must be a stable identifier of 1–128 characters.');
  let instructions = task.instructions;
  if (typeof instructions === 'string') {
    try { instructions = JSON.parse(instructions); }
    catch { throw new ApiError(400, 'STRUCTURED_INSTRUCTIONS_REQUIRED', 'Pass instructions as JSON with network, to, amountUsdc and memo. Ambiguous prose is not executed.'); }
  }
  return { taskId: task.taskId, payment: validatePayment(instructions) };
}

export async function run_workflow(input: unknown, dependencies: { db: DatabaseSync; signer: Signer; connection: Connection }): Promise<WorkflowOutput> {
  const { taskId, payment } = parseTask(input);
  const { db, signer, connection } = dependencies;
  const requestHash = createHash('sha256').update(JSON.stringify({ ...payment, sender: signer.publicKey.toBase58() })).digest('hex');
  db.exec(`CREATE TABLE IF NOT EXISTS devnet_payments (
    task_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, request TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('preparing','signed','confirmed','retryable')),
    lease TEXT NOT NULL, lease_until INTEGER NOT NULL, signed TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const lease = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  let prior: PaymentRow | undefined;
  try {
    prior = db.prepare('SELECT * FROM devnet_payments WHERE task_id=?').get(taskId) as PaymentRow | undefined;
    if (prior && prior.request_hash !== requestHash) throw new ApiError(409, 'TASK_CONFLICT', 'This taskId already belongs to different payment instructions or a different wallet.');
    if (prior?.state === 'preparing' && prior.lease_until > Date.now()) throw new ApiError(409, 'TASK_BUSY', 'Task is being prepared. Retry this same task ID later.');
    if (!prior) db.prepare("INSERT INTO devnet_payments(task_id, request_hash, request, state, lease, lease_until) VALUES(?,?,?,'preparing',?,?)").run(taskId, requestHash, JSON.stringify(payment), lease, Date.now() + 120_000);
    else if (prior.state === 'preparing' || prior.state === 'retryable') db.prepare("UPDATE devnet_payments SET state='preparing', lease=?, lease_until=?, updated_at=CURRENT_TIMESTAMP WHERE task_id=?").run(lease, Date.now() + 120_000, taskId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const finish = (signature: string): WorkflowOutput => {
    db.prepare("UPDATE devnet_payments SET state='confirmed', updated_at=CURRENT_TIMESTAMP WHERE task_id=? AND state='signed'").run(taskId);
    return { output: { data: { signature } } };
  };
  if (prior?.signed) {
    const saved = JSON.parse(prior.signed) as SignedPayment;
    if (prior.state === 'confirmed') return finish(saved.signature);
    return finish(await settleUsdc(connection, saved));
  }
  try {
    const signature = await payUsdc(signer, payment, { connection, persistSigned(signed) {
      const result = db.prepare("UPDATE devnet_payments SET state='signed', signed=?, updated_at=CURRENT_TIMESTAMP WHERE task_id=? AND state='preparing' AND lease=?").run(JSON.stringify(signed), taskId, lease);
      if (result.changes !== 1) throw new ApiError(409, 'LEASE_LOST', 'Another request owns this task. No transaction was broadcast by this attempt.');
    } });
    return finish(signature);
  } catch (error) {
    // Only pre-signing failures may be retried with a newly prepared transaction.
    db.prepare("UPDATE devnet_payments SET state='retryable', updated_at=CURRENT_TIMESTAMP WHERE task_id=? AND state='preparing' AND lease=?").run(taskId, lease);
    throw error;
  }
}
