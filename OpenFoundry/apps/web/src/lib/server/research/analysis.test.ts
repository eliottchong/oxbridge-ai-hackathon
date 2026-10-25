import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DesignManifest } from '../../research/types';
import { ApiError } from '../preflight/errors';
import { analyseResults, parseResultsCsv, suggestedCounterbalancedAssignments, validateFollowupAgainstDesign } from './analysis';

const companion = (name: string) => readFileSync(fileURLToPath(new URL(`../../../../static/research-companion/${name}.csv`, import.meta.url)), 'utf8');
const initial = () => parseResultsCsv(companion('synthetic-initial'));
const followup = () => parseResultsCsv(companion('synthetic-followup'));
const header = 'run_id,specimen_id,sample_group,measurement_order,signal,is_control\n';
const manifest = (): DesignManifest => ({
  id: 'reviewed-design', title: 'Counterbalanced synthetic illustration', protocol_id: 'protocol', protocol_version: '1',
  specimen_count: 8, fixed_controls: 2, replicates_per_specimen: 1, assignments: suggestedCounterbalancedAssignments(),
  reviewed_by: 'researcher', reviewed_at: '2026-10-25T15:00:00Z', rationale: 'Separate group and linear order association.'
});

describe('bounded source-preserving result CSV import', () => {
  it('preserves physical source rows and values, including BOM, CRLF and quoted fields', () => {
    const parsed = parseResultsCsv('\uFEFF' + header.replace('\n', '\r\n') + '"run-1","A-1",A,1,-1.25e2,false\r\nrun-1,CTRL-1,CONTROL,2,20,true\r\n');
    expect(parsed).toEqual([
      { run_id: 'run-1', specimen_id: 'A-1', sample_group: 'A', measurement_order: 1, signal: -125, is_control: false, source_row: 2 },
      { run_id: 'run-1', specimen_id: 'CTRL-1', sample_group: 'CONTROL', measurement_order: 2, signal: 20, is_control: true, source_row: 3 }
    ]);
  });

  it.each([
    '', header, 'wrong,header\nr,s,A,1,2,false',
    '"run_id,specimen_id",sample_group,measurement_order,signal,is_control\nr,s,A,1,2,false',
    header + 'r,s,A,1,NaN,false', header + 'r,s,A,1,Infinity,false', header + 'r,s,A,1,1e13,false',
    header + 'r,s,A,0,2,false', header + 'r,s,A,1.5,2,false', header + 'r,s,A,1000001,2,false',
    header + 'r,s,A,1,2,yes', header + 'r,s,A,1,2,false,extra', header + 'r,s,A,1,2',
    header + 'r,../file,A,1,2,false', header + 'r,s,group with spaces,1,2,false',
    header + 'r,s,A,1,2,false\nr,s,B,2,3,false', header + 'r,s,A,1,2,false\nr,t,B,1,3,false',
    header + 'r,s,A,1,2,false\nanother,t,B,2,3,false', header + 'r,s,A,1,2,false\n\nr,t,B,2,3,false',
    header + 'r,"broken,A,1,2,false', header + 'r,"s"oops,A,1,2,false',
    header + 'r,"s\nt",A,1,2,false'
  ])('rejects malformed or unsupported input with HTTP 400', (csv) => {
    try { parseResultsCsv(csv); throw new Error('expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(ApiError); expect((error as ApiError).status).toBe(400); }
  });

  it('bounds encoded bytes and row count', () => {
    expect(() => parseResultsCsv(header + 'a'.repeat(65536))).toThrow(/64 KiB/);
    const lines = Array.from({ length: 2001 }, (_, i) => `r,s${i},A,${i + 1},1,false`).join('\n');
    expect(Buffer.byteLength(header + lines)).toBeLessThan(65536);
    expect(() => parseResultsCsv(header + lines)).toThrow(/2000/);
  });
});

describe('transparent descriptive analysis', () => {
  it('separates allocation confounding from algebraic rank deficiency in the initial observations', () => {
    const result = analyseResults(initial());
    expect(result.classification).toBe('confounded');
    expect(result.rank_deficient).toBe(false);
    expect(result.order_confounded).toBe(true);
    expect(result.raw_group_contrast).toBe(8);
    expect(result.adjusted_group_contrast).toBeCloseTo(0);
    expect(result.order_slope).toBeCloseTo(2);
    expect(result.sample_support).toBe('unresolved');
    expect(result.order_support).toBe('unresolved');
    expect(result.group_means.map((g) => g.mean)).toEqual([15, 23]);
  });

  it('detects the counterbalanced follow-up order trend and produces the required next direction', () => {
    const result = analyseResults(followup());
    expect(result.classification).toBe('order_trend');
    expect(result.counterbalanced).toBe(true);
    expect(result.raw_group_contrast).toBe(0);
    expect(result.adjusted_group_contrast).toBeCloseTo(0);
    expect(result.order_slope).toBeCloseTo(2);
    expect(result.order_correlation).toBeCloseTo(1);
    expect(result.group_means.map((g) => g.order_mean)).toEqual([4.5, 4.5]);
    expect(result.next_direction).toBe('Investigate the measurement-order trend before pursuing the sample effect.');
    expect(result.sample_support).toBe('weakened');
    expect(result.order_support).toBe('provisionally_supported');
  });

  it('changes interpretation and recommendation when supplied observations change', () => {
    const order = analyseResults(followup());
    const sample = analyseResults(parseResultsCsv(companion('synthetic-sample-effect')));
    expect(sample.classification).toBe('sample_effect');
    expect(sample.adjusted_group_contrast).toBeCloseTo(8);
    expect(sample.order_slope).toBeCloseTo(0);
    expect(sample.order_correlation).toBeCloseTo(0);
    expect(sample.next_direction).not.toBe(order.next_direction);
    expect(sample.sample_support).toBe('provisionally_supported');
    expect(sample.order_support).toBe('weakened');
  });

  it('keeps no-signal results unresolved rather than manufacturing support', () => {
    const result = analyseResults(parseResultsCsv(companion('synthetic-no-signal')));
    expect(result.classification).toBe('no_clear_signal');
    expect(result.order_slope).toBeCloseTo(0);
    expect(result.adjusted_group_contrast).toBeCloseTo(0);
    expect(result.order_correlation).toBe(null);
    expect(result.sample_support).toBe('unresolved');
    expect(result.order_support).toBe('unresolved');
  });

  it('can report both descriptive signals without inventing a probability', () => {
    const rows = followup().map((row) => ({ ...row, signal: row.signal + (row.sample_group === 'B' ? 8 : 0) }));
    const result = analyseResults(rows);
    expect(result.classification).toBe('both_signals');
    expect(result.order_slope).toBeCloseTo(2);
    expect(result.adjusted_group_contrast).toBeCloseTo(8);
    expect(result.parameters).toEqual({ relative_signal_threshold: 0.1, absolute_tolerance: 1e-9 });
    expect(result.limitations.join(' ')).toContain('not statistical significance');
  });

  it('leaves an algebraically rank-deficient model unidentified', () => {
    const rows = initial().map((row) => ({ ...row, measurement_order: row.sample_group === 'A' ? 1 : 2 }));
    const result = analyseResults(rows);
    expect(result.rank_deficient).toBe(true);
    expect(result.classification).toBe('confounded');
    expect(result.adjusted_group_contrast).toBe(null);
    expect(result.order_slope).toBe(null);
  });

  it('excludes controls regardless of their readings and does not mutate evidence', () => {
    const rows = followup();
    const snapshot = structuredClone(rows);
    const before = analyseResults(rows);
    const after = analyseResults(rows.map((row) => row.is_control ? { ...row, signal: 1e12 } : row));
    expect(after).toEqual(before);
    expect(before.row_count).toBe(10);
    expect(before.specimen_count).toBe(8);
    expect(before.control_count).toBe(2);
    expect(rows).toEqual(snapshot);
  });

  it('keeps undersized, missing-group and multiple-group designs insufficient', () => {
    expect(analyseResults([]).classification).toBe('insufficient');
    expect(analyseResults(initial().filter((r) => r.sample_group !== 'B')).classification).toBe('insufficient');
    expect(analyseResults(initial().slice(0, 6)).classification).toBe('insufficient');
    expect(analyseResults(initial().map((r) => r.specimen_id === 'A-1' ? { ...r, sample_group: 'C' } : r)).classification).toBe('insufficient');
  });
});

describe('complete reviewed follow-up manifest', () => {
  it('accepts every specimen and control with the approved assignment', () => {
    expect(() => validateFollowupAgainstDesign(followup(), manifest())).not.toThrow();
  });

  it('rejects dropping specimens or controls and initial unbalanced assignments', () => {
    expect(() => validateFollowupAgainstDesign(followup().slice(1), manifest())).toThrow(/all 8 specimens and 2 controls/);
    expect(() => validateFollowupAgainstDesign(followup().filter((r) => !r.is_control), manifest())).toThrow();
    expect(() => validateFollowupAgainstDesign(initial(), manifest())).toThrow(/does not match/);
  });

  it.each(['sample_group', 'measurement_order', 'is_control', 'specimen_id'] as const)('rejects altered %s', (field) => {
    const rows = followup();
    const changed = { sample_group: 'B', measurement_order: 42, is_control: true, specimen_id: 'other' };
    rows[0] = { ...rows[0], [field]: changed[field] };
    expect(() => validateFollowupAgainstDesign(rows, manifest())).toThrow();
  });

  it('rejects unsupported replicates and malformed manifests', () => {
    expect(() => validateFollowupAgainstDesign(followup(), { ...manifest(), replicates_per_specimen: 2 })).toThrow(/one replicate/);
    const design = manifest();
    design.assignments[0] = { ...design.assignments[1] };
    expect(() => validateFollowupAgainstDesign(followup(), design)).toThrow(/duplicate/);
  });
});
