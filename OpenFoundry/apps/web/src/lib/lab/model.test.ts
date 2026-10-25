import { describe, it, expect } from 'vitest';
import { seed, evaluate, propose, transition, remaining, committed, spent, finishExperiment, addExperiment } from './model';

describe('lab demo decisions and money paths', () => {
  it('excludes expired stock, allocates demand, rounds packs and deduplicates scans', () => {
    const lab = seed();
    const mix = evaluate(lab).find(d => d.supply.id === 'mix')!;
    expect(mix.available).toBe(80);
    expect(mix.shortage).toBe(120);
    expect(mix.quantity).toBe(200);
    expect(lab.orders).toHaveLength(3);
    expect(propose(lab).orders).toEqual(lab.orders);
  });
  it('requires manager, reserves budget, pays once and receives once', () => {
    let lab = seed(); const order = lab.orders[0]; const before = remaining(lab); const originalSpent = spent(lab);
    expect(() => transition(lab, order.id, 'approve', 'researcher')).toThrow('Lab manager');
    expect(() => transition(lab, order.id, 'pay', 'manager')).toThrow();
    lab = transition(lab, order.id, 'approve', 'manager');
    expect(committed(lab)).toBe(order.total); expect(remaining(lab)).toBe(before - order.total);
    expect(evaluate(lab).find(d => d.supply.id === order.supply)?.shortage).toBe(0);
    lab = transition(lab, order.id, 'pay', 'manager');
    expect(committed(lab)).toBe(0); expect(spent(lab)).toBe(originalSpent + order.total);
    expect(() => transition(lab, order.id, 'pay', 'manager')).toThrow();
    const stock = lab.batches.length;
    lab = transition(lab, order.id, 'receive', 'manager');
    expect(lab.batches).toHaveLength(stock + 1);
    expect(() => transition(lab, order.id, 'receive', 'manager')).toThrow();
  });
  it('does not overspend and releases funds after failed payment', () => {
    let lab = seed(); const order = lab.orders[0]; lab.budget = lab.initialSpent + order.total;
    lab = transition(lab, order.id, 'approve', 'manager');
    expect(remaining(lab)).toBe(0);
    expect(() => transition(lab, lab.orders[1].id, 'approve', 'manager')).toThrow('Insufficient');
    lab = transition(lab, order.id, 'fail', 'manager');
    expect(remaining(lab)).toBe(order.total);
    expect(() => transition(lab, order.id, 'pay', 'manager')).toThrow();
  });
  it('rejects stale approvals and late delivery', () => {
    const lab = seed(); const order = lab.orders[0];
    lab.experiments[0].needs[0].quantity += 2000;
    expect(() => transition(lab, order.id, 'approve', 'manager')).toThrow('changed');
    lab.supplies[0].lead = 20;
    expect(evaluate(lab)[0].late).toBe(true);
    expect(propose(lab).orders.find(o => o.id === order.id)?.status).toBe('rejected');
  });
  it('blocks payment after demand changes and allows cancelling reservation', () => {
    let lab = seed(); const order = lab.orders[0];
    lab = transition(lab, order.id, 'approve', 'manager');
    for (const exp of lab.experiments) lab = finishExperiment(lab, exp.id, true);
    expect(() => transition(lab, order.id, 'pay', 'manager')).toThrow('Demand changed');
    lab = transition(lab, order.id, 'reject', 'manager');
    expect(committed(lab)).toBe(0);
  });
  it('completion is atomic and consumes earliest eligible batch once', () => {
    let lab = seed(); const before = structuredClone(lab.batches);
    expect(() => finishExperiment(lab, 'EXP-001')).toThrow('Not enough'); expect(lab.batches).toEqual(before);
    for (const order of lab.orders) {
      lab = transition(lab, order.id, 'approve', 'manager');
      lab = transition(lab, order.id, 'pay', 'manager');
      lab = transition(lab, order.id, 'receive', 'manager');
    }
    lab = finishExperiment(lab, 'EXP-001');
    expect(lab.batches.find(b => b.id === 'LOT-118')?.quantity).toBe(0);
    expect(lab.batches.find(b => b.id === 'LOT-092')?.quantity).toBe(50);
    expect(() => finishExperiment(lab, 'EXP-001')).toThrow('no longer');
  });
  it('validates experiment inputs and updates demand when cancelled', () => {
    let lab = seed();
    expect(() => addExperiment(lab, { name: 'Bad', date: '2026-10-30', owner: 'A', needs: [{ supply: 'tips', quantity: -1 }], data: '', notes: '' })).toThrow('positive');
    for (const exp of lab.experiments) lab = finishExperiment(lab, exp.id, true);
    expect(evaluate(lab).every(d => d.shortage === 0)).toBe(true);
    expect(lab.orders.every(o => o.status === 'rejected')).toBe(true);
  });
});
