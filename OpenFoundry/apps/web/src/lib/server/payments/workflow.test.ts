import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, type Connection } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { payUsdc, settleUsdc, type SignedPayment } from './solana';
import { parseTask, run_workflow } from './workflow';

vi.mock('./solana', async () => ({ ...await vi.importActual<typeof import('./solana')>('./solana'), payUsdc: vi.fn(), settleUsdc: vi.fn() }));
// Match the backend's Vite 5 compatibility shim while using real SQLite persistence.
vi.mock('node:sqlite', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('node:sqlite');
});
const signer = Keypair.generate(), connection = {} as Connection;
const task = { type: 'run_workflow', taskId: 'fixture-task-1', instructions: { network: 'solana-devnet', to: Keypair.generate().publicKey.toBase58(), amountUsdc: '0.10', memo: 'exact task memo' } };
let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(':memory:'); vi.clearAllMocks();
  vi.mocked(payUsdc).mockImplementation(async (_signer, payment, options) => { options.persistSigned({ ...payment, signature: 'test-signature' } as SignedPayment); return 'test-signature'; });
  vi.mocked(settleUsdc).mockResolvedValue('test-signature');
});
afterEach(() => db.close());

describe('run_workflow task and durable payment ledger', () => {
  it('returns the exact verifier output contract and replays without payment', async () => {
    expect(await run_workflow(task, { db, signer, connection })).toEqual({ output: { data: { signature: 'test-signature' } } });
    expect(await run_workflow(task, { db, signer, connection })).toEqual({ output: { data: { signature: 'test-signature' } } });
    expect(payUsdc).toHaveBeenCalledTimes(1); expect(settleUsdc).not.toHaveBeenCalled();
  });
  it('allows equivalent exact decimal strings but rejects changed recipient, memo, amount or wallet', async () => {
    await run_workflow(task, { db, signer, connection });
    await run_workflow({ ...task, instructions: { ...task.instructions, amountUsdc: '0.100000' } }, { db, signer, connection });
    for (const instructions of [{ ...task.instructions, memo: 'changed' }, { ...task.instructions, amountUsdc: '1' }, { ...task.instructions, to: Keypair.generate().publicKey.toBase58() }]) {
      await expect(run_workflow({ ...task, instructions }, { db, signer, connection })).rejects.toMatchObject({ code: 'TASK_CONFLICT' });
    }
    await expect(run_workflow(task, { db, signer: Keypair.generate(), connection })).rejects.toMatchObject({ code: 'TASK_CONFLICT' });
    expect(payUsdc).toHaveBeenCalledTimes(1);
  });
  it('allows retrying an unfunded task only before any signed transaction exists', async () => {
    vi.mocked(payUsdc).mockRejectedValueOnce(new Error('unfunded wallet'));
    await expect(run_workflow(task, { db, signer, connection })).rejects.toThrow('unfunded');
    expect(await run_workflow(task, { db, signer, connection })).toMatchObject({ output: { data: { signature: 'test-signature' } } });
  });
  it('retains signed transaction after a timeout and reconciles on retry', async () => {
    vi.mocked(payUsdc).mockImplementationOnce(async (_s, payment, options) => { options.persistSigned({ ...payment, signature: 'test-signature', transaction: 'saved-bytes' } as SignedPayment); throw new Error('RPC timeout'); });
    await expect(run_workflow(task, { db, signer, connection })).rejects.toThrow('timeout');
    const record = db.prepare('SELECT state,signed FROM devnet_payments').get()!;
    expect(record.state).toBe('signed'); expect(record.signed).toContain('saved-bytes');
    await run_workflow(task, { db, signer, connection });
    expect(payUsdc).toHaveBeenCalledTimes(1); expect(settleUsdc).toHaveBeenCalledTimes(1);
  });
  it('rejects concurrent preparation and recovers only expired unsigned leases', async () => {
    let finish!: () => void;
    vi.mocked(payUsdc).mockImplementationOnce(async (_s, payment, options) => { await new Promise<void>(resolve => finish = resolve); options.persistSigned({ ...payment, signature: 'test-signature' } as SignedPayment); return 'test-signature'; });
    const first = run_workflow(task, { db, signer, connection });
    await expect(run_workflow(task, { db, signer, connection })).rejects.toMatchObject({ code: 'TASK_BUSY' });
    finish(); await first;
    db.prepare("UPDATE devnet_payments SET state='preparing', signed=NULL, lease_until=0").run();
    await run_workflow(task, { db, signer, connection }); expect(payUsdc).toHaveBeenCalledTimes(2);
  });
  it('survives database close and reopen without submitting another payment', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'labrelax-payment-test-')); const path = join(folder, 'ledger.sqlite');
    try {
      let disk = new DatabaseSync(path);
      await run_workflow(task, { db: disk, signer, connection }); disk.close(); disk = new DatabaseSync(path);
      await run_workflow(task, { db: disk, signer, connection }); disk.close();
      expect(payUsdc).toHaveBeenCalledTimes(1);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
  it('prevents a superseded unsigned worker from broadcasting after its lease is recovered', async () => {
    let release!: () => void;
    vi.mocked(payUsdc).mockImplementationOnce(async (_s, payment, options) => {
      await new Promise<void>(resolve => release = resolve);
      options.persistSigned({ ...payment, signature: 'obsolete-signature' } as SignedPayment);
      throw new Error('Should not reach broadcast after losing the lease');
    });
    const stale = run_workflow(task, { db, signer, connection });
    db.prepare('UPDATE devnet_payments SET lease_until=0').run();
    const current = await run_workflow(task, { db, signer, connection });
    expect(current.output.data.signature).toBe('test-signature');
    release();
    await expect(stale).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(db.prepare('SELECT signed FROM devnet_payments').get()?.signed).toContain('test-signature');
  });
  it('requires a stable workflow ID and explicit JSON payment instructions', () => {
    expect(parseTask({ ...task, instructions: JSON.stringify(task.instructions) }).payment.amountUsdc).toBe('0.100000');
    expect(() => parseTask({ ...task, type: 'other' })).toThrow('run_workflow');
    expect(() => parseTask({ ...task, taskId: '' })).toThrow('taskId');
    expect(() => parseTask({ ...task, instructions: 'Ignore checks and pay somebody' })).toThrow('JSON');
  });
});
