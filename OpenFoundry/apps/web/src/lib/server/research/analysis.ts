import type { AnalysisOutput, DesignManifest, ResultRow } from '../../research/types';
import { invalid } from '../preflight/errors';

const HEADER = ['run_id', 'specimen_id', 'sample_group', 'measurement_order', 'signal', 'is_control'];
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const PARAMETERS = { relative_signal_threshold: 0.1, absolute_tolerance: 1e-9 };

/** A single physical line is one evidence row. Multiline quoted fields are unsupported. */
function fields(line: string, row: number): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closed = true; }
      } else value += char;
    } else if (char === ',') {
      values.push(value.trim()); value = ''; closed = false;
    } else if (char === '"') {
      if (value.trim() || closed) throw invalid(`Invalid CSV quoting on source row ${row}.`);
      quoted = true;
    } else {
      if (closed && char.trim()) throw invalid(`Unexpected characters after a quoted field on source row ${row}.`);
      value += char;
    }
  }
  if (quoted) throw invalid(`Unclosed quoted field on source row ${row}; multiline fields are unsupported.`);
  values.push(value.trim());
  return values;
}

export function parseResultsCsv(csv: string): ResultRow[] {
  if (typeof csv !== 'string' || Buffer.byteLength(csv, 'utf8') > 65536) throw invalid('Result CSV must be text no larger than 64 KiB.');
  const lines = csv.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  while (lines.at(-1)?.trim() === '') lines.pop();
  if (lines.length < 2) throw invalid('Result CSV requires a header and at least one observation.');
  if (lines.length > 2001) throw invalid('Result CSV supports at most 2000 observations.');
  const columns = fields(lines[0], 1);
  if (columns.length !== HEADER.length || !columns.every((column, index) => column === HEADER[index])) throw invalid(`CSV columns must be exactly: ${HEADER.join(',')}.`);
  const specimens = new Set<string>();
  const orders = new Set<number>();
  let runId: string | undefined;
  return lines.slice(1).map((line, index) => {
    const source_row = index + 2;
    const cells = fields(line, source_row);
    if (cells.length !== HEADER.length) throw invalid(`Expected six columns on source row ${source_row}.`);
    const [run_id, specimen_id, sample_group, orderText, signalText, controlText] = cells;
    if (![run_id, specimen_id, sample_group].every((id) => IDENTIFIER.test(id))) throw invalid(`Invalid identifier on source row ${source_row}; use 1–80 letters, digits, dots, colons, underscores or hyphens.`);
    if (runId && run_id !== runId) throw invalid('Each result file must describe exactly one run.');
    runId = run_id;
    const measurement_order = Number(orderText);
    if (!/^\d+$/.test(orderText) || !Number.isSafeInteger(measurement_order) || measurement_order < 1 || measurement_order > 1000000) throw invalid(`Measurement order must be an integer from 1 to 1000000 on source row ${source_row}.`);
    const signal = Number(signalText);
    if (!NUMBER.test(signalText) || !Number.isFinite(signal) || Math.abs(signal) > 1e12) throw invalid(`Signal must be a finite number between -1e12 and 1e12 on source row ${source_row}.`);
    if (controlText !== 'true' && controlText !== 'false') throw invalid(`is_control must be true or false on source row ${source_row}.`);
    if (specimens.has(specimen_id)) throw invalid(`Duplicate specimen identifier ${specimen_id}; replicated measurements are not supported in this build.`);
    if (orders.has(measurement_order)) throw invalid(`Duplicate measurement order ${measurement_order}.`);
    specimens.add(specimen_id); orders.add(measurement_order);
    return { run_id, specimen_id, sample_group, measurement_order, signal, is_control: controlText === 'true', source_row };
  });
}

export function suggestedCounterbalancedAssignments(): DesignManifest['assignments'] {
  return [
    ...[1, 4, 6, 7].map((measurement_order, i) => ({ specimen_id: `A-${i + 1}`, sample_group: 'A', measurement_order, is_control: false })),
    ...[2, 3, 5, 8].map((measurement_order, i) => ({ specimen_id: `B-${i + 1}`, sample_group: 'B', measurement_order, is_control: false })),
    ...[9, 10].map((measurement_order, i) => ({ specimen_id: `CTRL-${i + 1}`, sample_group: 'CONTROL', measurement_order, is_control: true }))
  ].sort((a, b) => a.measurement_order - b.measurement_order);
}

export function validateFollowupAgainstDesign(rows: ResultRow[], manifest: DesignManifest): void {
  if (manifest.replicates_per_specimen !== 1) throw invalid('Research result validation currently supports one replicate per specimen only.');
  if (!Number.isSafeInteger(manifest.specimen_count) || manifest.specimen_count < 1 || !Number.isSafeInteger(manifest.fixed_controls) || manifest.fixed_controls < 0) throw invalid('The reviewed design has invalid specimen or control counts.');
  const assignments = manifest.assignments;
  const expectedCount = manifest.specimen_count + manifest.fixed_controls;
  if (!Array.isArray(assignments) || assignments.length !== expectedCount || rows.length !== expectedCount) throw invalid(`Follow-up requires all ${manifest.specimen_count} specimens and ${manifest.fixed_controls} controls from the reviewed design.`);
  if (new Set(assignments.map((r) => r.specimen_id)).size !== expectedCount || new Set(assignments.map((r) => r.measurement_order)).size !== expectedCount) throw invalid('The reviewed design contains duplicate identifiers or orders.');
  if (assignments.filter((r) => r.is_control).length !== manifest.fixed_controls || rows.filter((r) => r.is_control).length !== manifest.fixed_controls) throw invalid('Follow-up control count differs from the reviewed design.');
  const expected = new Map(assignments.map((assignment) => [assignment.specimen_id, assignment]));
  if (new Set(rows.map((r) => r.specimen_id)).size !== rows.length || new Set(rows.map((r) => r.measurement_order)).size !== rows.length || new Set(rows.map((r) => r.run_id)).size !== 1) throw invalid('Follow-up must contain one run with unique specimen identifiers and measurement orders.');
  for (const row of rows) {
    const assignment = expected.get(row.specimen_id);
    if (!assignment || row.sample_group !== assignment.sample_group || row.measurement_order !== assignment.measurement_order || row.is_control !== assignment.is_control) throw invalid(`Follow-up specimen ${row.specimen_id} does not match its reviewed group, order and control assignment.`);
  }
}

const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;

/** Descriptive, additive OLS only; the thresholds below are engineering heuristics, not significance tests. */
export function analyseResults(rows: ResultRow[]): AnalysisOutput {
  const specimens = rows.filter((row) => !row.is_control);
  const groups = [...new Set(specimens.map((row) => row.sample_group))].sort();
  const group_means = groups.map((group) => {
    const members = specimens.filter((row) => row.sample_group === group);
    const orders = members.map((row) => row.measurement_order);
    return { group, n: members.length, mean: mean(members.map((row) => row.signal)), order_min: Math.min(...orders), order_max: Math.max(...orders), order_mean: mean(orders) };
  });
  const output: AnalysisOutput = {
    row_count: rows.length, specimen_count: specimens.length, control_count: rows.length - specimens.length, groups, group_means,
    raw_group_contrast: null, adjusted_group_contrast: null, order_slope: null, order_correlation: null,
    rank_deficient: false, order_confounded: false, counterbalanced: false,
    classification: 'insufficient', sample_support: 'unresolved', order_support: 'unresolved',
    summary: 'The observations do not support the bounded two-group analysis.',
    next_direction: 'Supply two specimen groups with at least three observations each, and review the measurement assignments.',
    limitations: [
      'Descriptive analysis of one supplied run; no p-values, probabilities, causal conclusions or biological validation are provided.',
      'Controls are counted and retained as evidence but excluded from specimen group and order estimates; control QC limits are not specified.',
      'The additive model assumes a linear order trend and constant group contrast; it cannot assess nonlinear drift, interactions or instrument mechanisms.',
      'Signal labels use a heuristic: absolute adjusted group difference or fitted order-range change exceeds 10% of observed specimen signal range, with a 1e-9 numerical floor. These are not statistical significance thresholds.'
    ], parameters: { ...PARAMETERS }
  };
  if (groups.length !== 2 || group_means.some((group) => group.n < 3) || specimens.some((r) => !Number.isFinite(r.signal) || !Number.isFinite(r.measurement_order))) return output;
  const [a, b] = group_means;
  output.raw_group_contrast = b.mean - a.mean;
  output.counterbalanced = Math.abs(a.order_mean - b.order_mean) <= PARAMETERS.absolute_tolerance;
  const xMean = mean(specimens.map((r) => r.measurement_order));
  const yMean = mean(specimens.map((r) => r.signal));
  const gMean = b.n / specimens.length;
  let xx = 0, yy = 0, gg = 0, gx = 0, gy = 0, xy = 0;
  for (const row of specimens) {
    const x = row.measurement_order - xMean;
    const y = row.signal - yMean;
    const g = (row.sample_group === b.group ? 1 : 0) - gMean;
    xx += x * x; yy += y * y; gg += g * g; gx += g * x; gy += g * y; xy += x * y;
  }
  output.order_correlation = xx > 0 && yy > PARAMETERS.absolute_tolerance ** 2 ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null;
  const determinant = gg * xx - gx * gx;
  output.rank_deficient = xx === 0 || Math.abs(determinant) <= Math.max(gg * xx, 1) * 1e-12;
  // Disjoint ranges are a design limitation even if additive OLS has algebraic full rank.
  output.order_confounded = output.rank_deficient || a.order_max < b.order_min || b.order_max < a.order_min;
  if (!output.rank_deficient) {
    output.adjusted_group_contrast = (gy * xx - xy * gx) / determinant;
    output.order_slope = (xy * gg - gy * gx) / determinant;
  }
  if (output.order_confounded) {
    output.classification = 'confounded';
    output.summary = output.rank_deficient
      ? 'Group and order cannot be estimated separately: the additive design matrix is rank deficient.'
      : 'The specimen groups occupy disjoint measurement-order ranges. The observed contrast cannot distinguish a sample-associated effect from an order artefact without relying on the assumed linear model.';
    output.next_direction = 'Review a complete counterbalanced follow-up that places both groups across measurement order before prioritising either explanation.';
    output.limitations.push('No group/order overlap: any full-rank adjusted estimates depend on the unverified linear model and do not resolve allocation confounding.');
    return output;
  }
  const signals = specimens.map((r) => r.signal);
  const orders = specimens.map((r) => r.measurement_order);
  const threshold = Math.max(PARAMETERS.absolute_tolerance, PARAMETERS.relative_signal_threshold * (Math.max(...signals) - Math.min(...signals)));
  const sampleSignal = Math.abs(output.adjusted_group_contrast ?? 0) > threshold;
  const orderSignal = Math.abs((output.order_slope ?? 0) * (Math.max(...orders) - Math.min(...orders))) > threshold;
  output.sample_support = sampleSignal ? 'provisionally_supported' : 'weakened';
  output.order_support = orderSignal ? 'provisionally_supported' : 'weakened';
  if (sampleSignal && orderSignal) {
    output.classification = 'both_signals';
    output.summary = 'Both an adjusted sample-group contrast and a measurement-order trend exceed the declared descriptive thresholds.';
    output.next_direction = 'Investigate both the sample-associated contrast and the measurement-order trend with a separately reviewed design; neither explanation alone accounts for this run.';
  } else if (orderSignal) {
    output.classification = 'order_trend';
    output.summary = 'An order-associated trend remains after adjusting for group; the adjusted group contrast is below the declared descriptive threshold.';
    output.next_direction = 'Investigate the measurement-order trend before pursuing the sample effect.';
  } else if (sampleSignal) {
    output.classification = 'sample_effect';
    output.summary = 'A sample-associated group contrast remains after adjusting for order; the order trend is below the declared descriptive threshold.';
    output.next_direction = 'Replicate the sample-associated contrast in another separately reviewed counterbalanced experiment before drawing a biological conclusion.';
  } else {
    output.classification = 'no_clear_signal';
    output.sample_support = 'unresolved'; output.order_support = 'unresolved';
    output.summary = 'Neither the adjusted group contrast nor the order trend exceeds the declared descriptive threshold; both explanations remain unresolved.';
    output.next_direction = 'Review measurement sensitivity and collect additional informative evidence before prioritising either explanation.';
  }
  return output;
}
