import { describe, expect, it } from 'vitest';
import type { InventoryResource, ProtocolDraft } from '../../preflight/types';
import { addAmounts, calculatePlan, canonicalAmount, compareAmounts, subtractAmounts } from './calculator';

function fixture(): { protocol: ProtocolDraft; inventory: InventoryResource[] } {
  return {
    protocol: {
      id: 'protocol-1', project_id: 'project-1', protocol_id: 'synthetic-microplate', version: '1.0',
      title: 'Synthetic Microplate Readout SOP', file_hash: 'test-source-hash', filename: 'synthetic.pdf',
      supported_layout: true, extraction_method: 'supported-template', status: 'approved',
      fixed_controls: 2, replicates_per_specimen: 1, overage_percent: '10', issues: [],
      source_text: 'Synthetic fixture, not scientific instructions', created_at: '2026-10-25T12:00:00Z',
      created_by: 'user-1', reviewed_by: 'user-1', reviewed_at: '2026-10-25T12:01:00Z', approval_revision: 1,
      rows: [
        { id: 'r1', resource_id: 'buffer', resource_name: 'Buffer A', per_reaction: '60', unit: 'uL', source_page: 1, source_row: 1, source_excerpt: 'Buffer A | 60 uL per reaction', needs_review: false, issues: [] },
        { id: 'r2', resource_id: 'indicator', resource_name: 'Indicator B', per_reaction: '15', unit: 'uL', source_page: 1, source_row: 2, source_excerpt: 'Indicator B | 15 uL per reaction', needs_review: false, issues: [] },
        { id: 'r3', resource_id: 'wash', resource_name: 'Wash C', per_reaction: '0.100', unit: 'mL', source_page: 1, source_row: 3, source_excerpt: 'Wash C | 0.100 mL per reaction', needs_review: false, issues: [] }
      ]
    },
    inventory: [
      { id: 'buffer', project_id: 'project-1', name: 'Buffer A', balance: '700', unit: 'uL', reorder_threshold: '100', revision: 2, lots: [] },
      { id: 'indicator', project_id: 'project-1', name: 'Indicator B', balance: '150', unit: 'uL', reorder_threshold: '100', revision: 7, lots: [] },
      { id: 'wash', project_id: 'project-1', name: 'Wash C', balance: '2000', unit: 'uL', reorder_threshold: '500', revision: 3, lots: [] }
    ]
  };
}

describe('exact volume arithmetic', () => {
  it('converts mL without binary floating point arithmetic and normalises unicode micro units', () => {
    expect(canonicalAmount('2.0', 'mL')).toBe('2000');
    expect(canonicalAmount('0.000000001', 'mL')).toBe('0.000001');
    expect(canonicalAmount('001.230000', 'µL')).toBe('1.23');
    expect(canonicalAmount('0.000001', 'μL')).toBe('0.000001');
  });

  it('preserves fractional quantities and signed forecast or variance values', () => {
    expect(addAmounts('0.1', '0.2')).toBe('0.3');
    expect(subtractAmounts('150', '165')).toBe('-15');
    expect(addAmounts('-0.3', '0.1')).toBe('-0.2');
    expect(subtractAmounts('-0.3', '-0.2')).toBe('-0.1');
    expect(compareAmounts('1.000001', '1')).toBe(1);
    expect(compareAmounts('-0.1', '0')).toBe(-1);
    expect(compareAmounts('1.000000', '1')).toBe(0);
  });

  it.each([
    ['-1', 'uL'], ['0.0000001', 'uL'], ['0.0000000001', 'mL'], ['1', 'mg'],
    ['1', 'L'], ['1e3', 'uL'], ['1,000', 'uL'], ['NaN', 'uL'], ['Infinity', 'uL'],
    [null, 'uL'], ['', 'uL'], ['1000000000001', 'uL'], ['1', null], [0.1, 'uL'], [1, 'uL']
  ])('rejects unsupported or unsafe amount %s %s', (amount, unit) => {
    expect(() => canonicalAmount(amount, unit)).toThrow();
  });
});

describe('protocol preflight', () => {
  it('finds the 8-specimen shortage that a conventional threshold misses', () => {
    const { protocol, inventory } = fixture();
    const original = structuredClone({ protocol, inventory });
    const result = calculatePlan(protocol, inventory, 8);
    expect(result.status).toBe('SHORTAGE');
    expect(result.issues).toEqual([]);
    expect(result.reactions).toBe(10);
    expect(result.lines.map(({ required, shortage, forecast_balance }) => ({ required, shortage, forecast_balance }))).toEqual([
      { required: '660', shortage: '0', forecast_balance: '40' },
      { required: '165', shortage: '15', forecast_balance: '-15' },
      { required: '1100', shortage: '0', forecast_balance: '900' }
    ]);
    expect(result.lines[1].conventional_low_stock).toBe(false);
    expect(result.lines[1].inventory_revision).toBe(7);
    expect(result.lines[1].source_excerpt).toContain('Indicator B | 15 uL per reaction');
    expect({ protocol, inventory }).toEqual(original);
  });

  it('checks the independent 6-specimen expected values', () => {
    const { protocol, inventory } = fixture();
    const result = calculatePlan(protocol, inventory, 6);
    expect(result.status).toBe('RESOURCE-SUFFICIENT');
    expect(result.reactions).toBe(8);
    expect(result.lines.map((line) => line.required)).toEqual(['528', '132', '880']);
    expect(result.lines.map((line) => line.forecast_balance)).toEqual(['172', '18', '1120']);
  });

  it('counts controls once after all specimen replicates, then applies stated overage', () => {
    const { protocol, inventory } = fixture();
    protocol.replicates_per_specimen = 2;
    protocol.fixed_controls = 3;
    protocol.overage_percent = '12.5';
    const result = calculatePlan(protocol, inventory, 4);
    expect(result.reactions).toBe(11);
    expect(result.lines.map((line) => line.required)).toEqual(['742.5', '185.625', '1237.5']);
  });

  it('respects explicit zero controls and zero overage', () => {
    const { protocol, inventory } = fixture();
    protocol.fixed_controls = 0;
    protocol.overage_percent = '0';
    const result = calculatePlan(protocol, inventory, 1);
    expect(result.status).toBe('RESOURCE-SUFFICIENT');
    expect(result.reactions).toBe(1);
    expect(result.lines.map((line) => line.required)).toEqual(['60', '15', '100']);
  });

  it('consolidates two uses of the same resource before checking inventory once', () => {
    const { protocol, inventory } = fixture();
    protocol.rows = [protocol.rows[0], { ...protocol.rows[0], id: 'r4', source_row: 4, per_reaction: '10', source_excerpt: 'Additional Buffer A | 10 uL per reaction' }];
    const result = calculatePlan(protocol, inventory, 8);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ per_reaction: '70', available: '700', required: '770', shortage: '70', forecast_balance: '-70' });
    expect(result.lines[0].source_excerpt).toContain('Additional Buffer A');
    expect(result.status).toBe('SHORTAGE');
  });

  it('blocks identical duplicated extraction rows rather than presenting a sufficient result', () => {
    const { protocol, inventory } = fixture();
    protocol.rows.push({ ...protocol.rows[0] });
    const result = calculatePlan(protocol, inventory, 1);
    expect(result.status).toBe('REVIEW-REQUIRED');
    expect(result.issues.join(' ')).toContain('duplicated protocol row');
  });

  it('does not sum duplicate inventory records into fictional extra stock', () => {
    const { protocol, inventory } = fixture();
    inventory.push({ ...inventory[1], balance: '500' });
    const result = calculatePlan(protocol, inventory, 8);
    expect(result.status).toBe('REVIEW-REQUIRED');
    expect(result.issues.join(' ')).toContain('duplicate inventory resource records');
    expect(result.lines.find((line) => line.resource_id === 'indicator')).toBeUndefined();
  });

  it.each([0, -1, 1.5, '8', null, undefined, NaN, Infinity, 100001])('rejects invalid specimen count %s', (count) => {
    const { protocol, inventory } = fixture();
    expect(() => calculatePlan(protocol, inventory, count)).toThrow(/Specimen count/);
  });

  it.each(['draft', 'unsupported', 'needs-review', 'unmapped', 'missing-source', 'contradiction', 'missing-reviewer', 'cross-project', 'bad-revision'])('never returns sufficient for %s protocol data', (condition) => {
    const { protocol, inventory } = fixture();
    if (condition === 'draft') protocol.status = 'draft';
    if (condition === 'unsupported') protocol.supported_layout = false;
    if (condition === 'needs-review') protocol.rows[0].needs_review = true;
    if (condition === 'unmapped') protocol.rows[0].resource_id = null;
    if (condition === 'missing-source') protocol.rows[0].source_excerpt = '';
    if (condition === 'contradiction') protocol.issues.push('Contradictory batch-vs-reaction instructions.');
    if (condition === 'missing-reviewer') protocol.reviewed_by = '';
    if (condition === 'cross-project') inventory[0].project_id = 'restricted-project';
    if (condition === 'bad-revision') inventory[0].revision = NaN;
    const result = calculatePlan(protocol, inventory, 1);
    expect(result.status).toBe('REVIEW-REQUIRED');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.lines.every((line) => line.status === 'REVIEW-REQUIRED')).toBe(true);
  });

  it('leaves missing assumptions null and blocks calculation rather than inventing defaults', () => {
    const { protocol, inventory } = fixture();
    protocol.fixed_controls = null;
    protocol.replicates_per_specimen = null;
    protocol.overage_percent = null;
    const result = calculatePlan(protocol, inventory, 8);
    expect(result).toMatchObject({ status: 'REVIEW-REQUIRED', reactions: null, fixed_controls: null, replicates_per_specimen: null, overage_percent: null, lines: [] });
  });

  it('blocks mass-to-volume inference even after protocol approval', () => {
    const { protocol, inventory } = fixture();
    protocol.rows[0].unit = 'mg';
    const result = calculatePlan(protocol, inventory, 1);
    expect(result.status).toBe('REVIEW-REQUIRED');
    expect(result.issues.join(' ')).toContain('Unsupported volume unit');
  });

  it.each(['-1', '10%', '1001', '0.0000001'])('requires review of invalid overage %s', (overage) => {
    const { protocol, inventory } = fixture();
    protocol.overage_percent = overage;
    const result = calculatePlan(protocol, inventory, 1);
    expect(result.status).toBe('REVIEW-REQUIRED');
    expect(result.overage_percent).toBeNull();
    expect(result.lines).toEqual([]);
  });

  it.each([null, '-1', '0', 'unreadable', '0.0000001'])('requires review of unresolved per-reaction amount %s', (amount) => {
    const { protocol, inventory } = fixture();
    protocol.rows[0].per_reaction = amount;
    expect(calculatePlan(protocol, inventory, 1).status).toBe('REVIEW-REQUIRED');
  });

  it('cannot silently map an unknown resource or accept invalid recorded stock', () => {
    const { protocol, inventory } = fixture();
    protocol.rows[0].resource_id = 'unknown';
    inventory[1].balance = '-5';
    const result = calculatePlan(protocol, inventory, 1);
    expect(result.status).toBe('REVIEW-REQUIRED');
    expect(result.issues.join(' ')).toContain('unknown inventory resource');
    expect(result.issues.join(' ')).toContain('Amount cannot be negative');
  });

  it('keeps fractional requirements exact, and rejects any result requiring rounding', () => {
    const { protocol, inventory } = fixture();
    protocol.rows = [{ ...protocol.rows[0], per_reaction: '0.1' }];
    expect(calculatePlan(protocol, inventory, 1).lines[0].required).toBe('0.33');
    protocol.rows[0].per_reaction = '0.000001';
    const result = calculatePlan(protocol, inventory, 1);
    expect(result.status).toBe('REVIEW-REQUIRED');
    expect(result.issues.join(' ')).toContain('rounding is not permitted');
  });

  it('recomputes against fresh inventory revisions and marks threshold equality low', () => {
    const { protocol, inventory } = fixture();
    inventory[1].balance = '165';
    inventory[1].reorder_threshold = '165';
    inventory[1].revision = 8;
    const result = calculatePlan(protocol, inventory, 8);
    expect(result.status).toBe('RESOURCE-SUFFICIENT');
    expect(result.lines[1]).toMatchObject({ inventory_revision: 8, shortage: '0', forecast_balance: '0', conventional_low_stock: true });
  });
});
