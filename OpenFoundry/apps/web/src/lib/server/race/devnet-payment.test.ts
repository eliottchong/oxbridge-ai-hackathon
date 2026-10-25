import { describe, expect, it, vi } from 'vitest';
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('node:sqlite', async () => (await import('node:module')).createRequire(import.meta.url)('node:sqlite'));
import { PaymentJournal, usdcMicros, validatePlan } from './devnet-payment';

const recipient = 'DBhYGC9kziUsibkop4PxgsmfgFX6yo628EmG5Hi91VWc';
const input = `Pay 0.01 devnet USDC to ${recipient} with memo test-run-123.`;
const plan = { network: 'solana-devnet', to: recipient, amountUsdc: '0.01', memo: 'test-run-123' };

describe('devnet-only payment constraints', () => {
  it('converts amounts exactly without floating-point rounding', () => {
    expect(usdcMicros('0.01')).toBe(10000n);
    expect(usdcMicros('0.000001')).toBe(1n);
    expect(usdcMicros('1.000001')).toBe(1000001n);
    for (const value of ['0', '-1', 'NaN', '0.0000001', '1e-2', 0.01]) expect(() => usdcMicros(value)).toThrow();
  });
  it('allows only source-backed devnet recipient, memo and amount', () => {
    expect(validatePlan(plan, input, 0.02)).toBe(10000n);
    expect(() => validatePlan({ ...plan, network: 'solana-mainnet' }, input)).toThrow();
    expect(() => validatePlan(plan, input.replace('devnet', 'mainnet'))).toThrow();
    expect(() => validatePlan({ ...plan, memo: 'invented' }, input)).toThrow();
    expect(() => validatePlan({ ...plan, amountUsdc: '0.02' }, input)).toThrow();
    expect(() => validatePlan(plan, input, 0.001)).toThrow();
    expect(() => validatePlan({ ...plan, amountUsdc: '2' }, input.replace('0.01', '2'))).toThrow();
  });
  it('keeps one reservation for a nonce and rejects changed content', () => {
    const journal = new PaymentJournal(':memory:');
    try {
      journal.reserve('nonce-1', 'input-hash', 10000n);
      journal.reserve('nonce-1', 'input-hash', 10000n);
      expect(journal.db.prepare('SELECT COUNT(*) AS n FROM payments').get()?.n).toBe(1);
      expect(() => journal.reserve('nonce-1', 'changed-hash', 10000n)).toThrow();
      journal.update('nonce-1', 'signed', 'signed-before-broadcast');
      expect(journal.get('nonce-1')).toMatchObject({ state: 'signed', signature: 'signed-before-broadcast' });
      journal.update('nonce-1', 'confirmed');
      expect(journal.get('nonce-1')).toMatchObject({ state: 'confirmed', signature: 'signed-before-broadcast' });
    } finally { journal.close(); }
  });
  it('counts unresolved signed payments against the cumulative test-token budget', () => {
    const journal = new PaymentJournal(':memory:');
    try {
      journal.reserve('one', 'a', 1000000n); journal.update('one', 'signed', 'pending-signature');
      journal.reserve('two', 'b', 1000000n);
      expect(() => journal.reserve('three', 'c', 1n)).toThrow();
      journal.update('two', 'failed');
      expect(journal.reserve('three', 'c', 1n).state).toBe('reserved');
    } finally { journal.close(); }
  });
});
