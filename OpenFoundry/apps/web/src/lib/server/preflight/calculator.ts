import type { InventoryResource, PlanLine, ProtocolDraft, Readiness } from '../../preflight/types';

// One atom is 0.000001 uL. All arithmetic below is integer arithmetic.
const SCALE = 1_000_000n;
const MAX_AMOUNT = 1_000_000_000_000n * SCALE;
const MAX_SPECIMENS = 100_000;

export class CalculationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculationInputError';
  }
}

function decimalText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CalculationInputError('Amount must be a decimal string; JSON numbers may lose precision.');
  }
  const text = value.trim();
  if (text.length > 80 || !/^-?\d+(?:\.\d+)?$/.test(text)) {
    throw new CalculationInputError('Amount must use decimal notation without exponent or separators.');
  }
  return text;
}

function parseFixed(value: unknown, multiplier = 1n, allowNegative = true): bigint {
  const text = decimalText(value);
  const negative = text.startsWith('-');
  if (negative && !allowNegative) throw new CalculationInputError('Amount cannot be negative.');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fractional = ''] = unsigned.split('.');
  const numerator = BigInt(whole + fractional) * SCALE * multiplier;
  const denominator = 10n ** BigInt(fractional.length);
  if (numerator % denominator !== 0n) {
    throw new CalculationInputError('Amount exceeds supported precision of 0.000001 uL; rounding is not permitted.');
  }
  const result = numerator / denominator;
  if (result > MAX_AMOUNT) throw new CalculationInputError('Amount exceeds supported limit of 1000000000000 uL.');
  return negative ? -result : result;
}

function formatFixed(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fractional = (absolute % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fractional ? `.${fractional}` : ''}`;
}

/** Convert an explicit supported volume to exact canonical uL. Never infer mass conversion. */
export function canonicalAmount(amount: unknown, unit: unknown): string {
  if (typeof unit !== 'string') throw new CalculationInputError('A volume unit is required.');
  const normal = unit.trim().replace(/[µμ]/g, 'u');
  let multiplier: bigint;
  if (normal === 'uL' || normal === 'ul') multiplier = 1n;
  else if (normal === 'mL' || normal === 'ml') multiplier = 1_000n;
  else throw new CalculationInputError(`Unsupported volume unit: ${unit}. Only uL and mL are supported.`);
  return formatFixed(parseFixed(amount, multiplier, false));
}

export function addAmounts(a: string, b: string): string {
  const result = parseFixed(a) + parseFixed(b);
  if (result > MAX_AMOUNT || result < -MAX_AMOUNT) throw new CalculationInputError('Combined amount exceeds supported limit.');
  return formatFixed(result);
}

export function subtractAmounts(a: string, b: string): string {
  const result = parseFixed(a) - parseFixed(b);
  if (result > MAX_AMOUNT || result < -MAX_AMOUNT) throw new CalculationInputError('Difference exceeds supported limit.');
  return formatFixed(result);
}

export function compareAmounts(a: string, b: string): number {
  const left = parseFixed(a);
  const right = parseFixed(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export type CalculationResult = {
  status: Readiness;
  issues: string[];
  lines: PlanLine[];
  reactions: number | null;
  replicates_per_specimen: number | null;
  fixed_controls: number | null;
  overage_percent: string | null;
  specimen_count: number;
};

function validInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

/** Pure preview: no inventory changes, model calls, or scientific assumptions. */
export function calculatePlan(
  protocol: ProtocolDraft,
  inventory: InventoryResource[],
  specimenCount: unknown
): CalculationResult {
  if (!validInteger(specimenCount, 1, MAX_SPECIMENS)) {
    throw new CalculationInputError(`Specimen count must be a positive integer from 1 to ${MAX_SPECIMENS}.`);
  }

  const issues: string[] = [];
  if (!protocol.supported_layout) issues.push('Protocol layout is unsupported; manual review is required.');
  if (protocol.status !== 'approved') issues.push('Protocol has not been approved by a researcher.');
  if (protocol.status === 'approved' && (!protocol.reviewed_by?.trim() || !protocol.reviewed_at?.trim())) {
    issues.push('Protocol approval is missing reviewer identity or time.');
  }
  issues.push(...protocol.issues.map((issue) => `Protocol: ${issue}`));
  if (!protocol.rows.length) issues.push('Protocol has no reagent rows.');

  const replicates = validInteger(protocol.replicates_per_specimen, 1, 10_000)
    ? protocol.replicates_per_specimen : null;
  const controls = validInteger(protocol.fixed_controls, 0, 100_000) ? protocol.fixed_controls : null;
  if (replicates === null) issues.push('Replicates per specimen must be an explicitly reviewed positive integer (maximum 10000).');
  if (controls === null) issues.push('Fixed controls must be an explicitly reviewed nonnegative integer (maximum 100000).');
  const reactions = replicates !== null && controls !== null ? specimenCount * replicates + controls : null;

  let overage: bigint | null = null;
  try {
    overage = parseFixed(protocol.overage_percent, 1n, false);
    if (overage > 1000n * SCALE) throw new CalculationInputError('Preparation overage cannot exceed 1000%.');
  } catch (error) {
    issues.push(`Preparation overage requires review: ${(error as Error).message}`);
    overage = null;
  }

  type Group = { amount: string; rows: typeof protocol.rows; blocked: boolean };
  const groups = new Map<string, Group>();
  const rowIds = new Set<string>();
  const sourceRows = new Set<string>();
  for (const row of protocol.rows) {
    const label = row.resource_name?.trim() || row.id || 'Unnamed reagent';
    const sourceKey = `${row.source_page}:${row.source_row}`;
    let blocked = false;
    if (rowIds.has(row.id) || sourceRows.has(sourceKey)) {
      issues.push(`${label}: duplicated protocol row or source location requires review.`);
      blocked = true;
    }
    rowIds.add(row.id);
    sourceRows.add(sourceKey);
    if (row.needs_review || row.issues.length) {
      issues.push(`${label}: ${row.issues.length ? row.issues.join('; ') : 'extracted value needs review'}.`);
      blocked = true;
    }
    if (!validInteger(row.source_page, 1, 100_000) || !validInteger(row.source_row, 1, 100_000) || !row.source_excerpt?.trim()) {
      issues.push(`${label}: source page, row and excerpt are required.`);
      blocked = true;
    }
    if (!row.resource_id) {
      issues.push(`${label}: no reviewed inventory resource mapping.`);
      continue;
    }
    let amount: string;
    try {
      amount = canonicalAmount(row.per_reaction, row.unit);
      if (compareAmounts(amount, '0') <= 0) throw new CalculationInputError('Per-reaction quantity must be greater than zero.');
    } catch (error) {
      issues.push(`${label}: ${(error as Error).message}`);
      const existing = groups.get(row.resource_id);
      if (existing) existing.blocked = true;
      continue;
    }
    const existing = groups.get(row.resource_id);
    if (existing) {
      try { existing.amount = addAmounts(existing.amount, amount); }
      catch (error) { issues.push(`${label}: ${(error as Error).message}`); existing.blocked = true; }
      existing.rows.push(row);
      existing.blocked ||= blocked;
    } else groups.set(row.resource_id, { amount, rows: [row], blocked });
  }

  const lines: PlanLine[] = [];
  for (const [resourceId, group] of groups) {
    const matching = inventory.filter((resource) => resource.id === resourceId);
    if (matching.length !== 1) {
      issues.push(`${group.rows[0].resource_name}: ${matching.length ? 'duplicate inventory resource records' : 'unknown inventory resource'}; review mapping.`);
      continue;
    }
    const resource = matching[0];
    if (resource.project_id !== protocol.project_id) {
      issues.push(`${group.rows[0].resource_name}: inventory mapping is outside the protocol project.`);
      continue;
    }
    if (!validInteger(resource.revision, 0, Number.MAX_SAFE_INTEGER)) {
      issues.push(`${resource.name}: inventory revision is missing or invalid.`);
      continue;
    }
    if (reactions === null || overage === null) continue;
    try {
      const available = canonicalAmount(resource.balance, resource.unit);
      const threshold = canonicalAmount(resource.reorder_threshold, resource.unit);
      const product = parseFixed(group.amount) * BigInt(reactions) * (100n * SCALE + overage);
      const divisor = 100n * SCALE;
      if (product % divisor !== 0n) throw new CalculationInputError('Prepared requirement exceeds supported precision; rounding is not permitted.');
      const required = formatFixed(product / divisor);
      if (parseFixed(required) > MAX_AMOUNT) throw new CalculationInputError('Prepared requirement exceeds supported amount limit.');
      const forecast = subtractAmounts(available, required);
      const shortage = compareAmounts(forecast, '0') < 0 ? subtractAmounts('0', forecast) : '0';
      lines.push({
        resource_id: resource.id, resource_name: resource.name, per_reaction: group.amount, unit: 'uL',
        required, available, shortage, forecast_balance: forecast, reorder_threshold: threshold,
        conventional_low_stock: compareAmounts(available, threshold) <= 0,
        inventory_revision: resource.revision, source_page: group.rows[0].source_page,
        source_excerpt: group.rows.map((row) => `Page ${row.source_page}, row ${row.source_row}: ${row.source_excerpt}`).join('\n'),
        status: group.blocked ? 'REVIEW-REQUIRED' : compareAmounts(shortage, '0') > 0 ? 'SHORTAGE' : 'RESOURCE-SUFFICIENT'
      });
    } catch (error) { issues.push(`${resource.name}: ${(error as Error).message}`); }
  }

  const status: Readiness = issues.length ? 'REVIEW-REQUIRED'
    : lines.some((line) => line.status === 'SHORTAGE') ? 'SHORTAGE' : 'RESOURCE-SUFFICIENT';
  if (status === 'REVIEW-REQUIRED') for (const line of lines) line.status = 'REVIEW-REQUIRED';
  return {
    status, issues: [...new Set(issues)], lines, reactions, replicates_per_specimen: replicates,
    fixed_controls: controls, overage_percent: overage === null ? null : formatFixed(overage), specimen_count: specimenCount
  };
}
