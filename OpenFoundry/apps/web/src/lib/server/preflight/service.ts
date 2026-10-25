import { createHash, randomUUID } from 'node:crypto';
import type { ActualLine, Confirmation, ConsumptionEvent, InventoryResource, ProtocolDraft, ProtocolRow, RunPlan } from '$lib/preflight/types';
import { calculatePlan, canonicalAmount, compareAmounts, subtractAmounts, addAmounts } from './calculator';
import { ApiError, invalid, notFound } from './errors';
import { requireProject, type Actor } from './auth';
import { LabStore } from './store';

export type Experiment = { id: string; project_id: string; name: string; status: 'planned' | 'completed'; created_at: string; created_by: string };
const now = () => new Date().toISOString();
const text = (value: unknown, label: string, max = 200): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(`${label} is required (maximum ${max} characters).`);
  return value.trim();
};
export class LabService {
  constructor(public store: LabStore) {}
  inventory(actor: Actor, project: unknown) {
    requireProject(actor, project);
    return this.store.list<InventoryResource>('inventory', project);
  }
  importInventory(actor: Actor, body: Record<string, unknown>) {
    requireProject(actor, body.project_id, true);
    if (body.confirmed !== true || !Array.isArray(body.resources) || !body.resources.length || body.resources.length > 100) throw invalid('Explicitly confirm 1–100 inventory resources.');
    const ids = new Set<string>();
    const resources = body.resources.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw invalid('Invalid inventory row.');
      const row = value as Record<string, unknown>;
      const id = text(row.id, 'Resource ID', 80);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || ids.has(id)) throw invalid('Use unique lower-case resource IDs.');
      ids.add(id);
      let balance: string, threshold: string;
      try { balance = canonicalAmount(row.balance, row.unit); threshold = canonicalAmount(row.reorder_threshold, row.unit); }
      catch (error) { throw invalid(error instanceof Error ? error.message : 'Invalid inventory quantities.'); }
      if (!Array.isArray(row.lots) || row.lots.length > 100) throw invalid('Provide a lots array (empty if lots are unknown).');
      const lotIds = new Set<string>();
      const lots = row.lots.map((value: unknown) => {
        if (!value || typeof value !== 'object') throw invalid('Invalid lot row.');
        const lot = value as Record<string, unknown>;
        const lotId = text(lot.id, 'Lot ID', 120);
        if (lotIds.has(lotId)) throw invalid('Duplicate lot ID.');
        lotIds.add(lotId);
        let lotBalance: string;
        try { lotBalance = canonicalAmount(lot.balance, row.unit); } catch { throw invalid('Invalid lot balance.'); }
        if (lot.expires !== null && (typeof lot.expires !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(lot.expires) || !Number.isFinite(Date.parse(lot.expires)) || new Date(lot.expires).toISOString().slice(0, 10) !== lot.expires)) throw invalid('Expiry must be a valid YYYY-MM-DD date or null.');
        return { id: lotId, balance: lotBalance, expires: lot.expires as string | null };
      });
      const total = lots.reduce((sum, lot) => addAmounts(sum, lot.balance), '0');
      if (compareAmounts(total, balance) > 0) throw invalid('Lot balances cannot exceed total recorded stock.');
      return { id, name: text(row.name, 'Resource name'), project_id: body.project_id as string, balance,
        reorder_threshold: threshold, unit: 'uL' as const, lots, revision: 1 };
    });
    return this.store.transaction(() => {
      if (this.store.list('consumption_events', body.project_id as string).length) throw new ApiError(409, 'BASELINE_LOCKED', 'Actual use is already recorded. A baseline import cannot overwrite the ledger.');
      for (const row of resources) {
        const existing = this.store.get<InventoryResource>('inventory', row.id);
        if (existing && existing.project_id !== body.project_id) throw notFound();
      }
      const generation = this.store.db.prepare('UPDATE inventory_generations SET generation=generation+1 WHERE project_id=? RETURNING generation').get(body.project_id as string) as { generation: number };
      for (const row of resources) row.revision = generation.generation;
      this.store.db.prepare('DELETE FROM inventory WHERE project_id=?').run(body.project_id as string);
      for (const row of resources) this.store.put('inventory', row);
      this.store.db.exec('CREATE TABLE IF NOT EXISTS inventory_imports (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor_id TEXT NOT NULL, timestamp TEXT NOT NULL, source_name TEXT NOT NULL, data TEXT NOT NULL)');
      this.store.db.prepare('INSERT INTO inventory_imports VALUES (?,?,?,?,?,?)').run(randomUUID(), body.project_id as string, actor.id, now(), typeof body.source_name === 'string' ? body.source_name.slice(0, 200) : 'Team inventory import', JSON.stringify(resources));
      return { resources, source: 'team-import', imported_by: actor.id };
    });
  }
  private permitted<T extends { project_id: string }>(actor: Actor, table: 'protocols' | 'plans' | 'experiments', id: string): T {
    const item = this.store.get<T>(table, id);
    if (!item) throw notFound();
    requireProject(actor, item.project_id);
    return item;
  }
  protocol(actor: Actor, id: string) { return this.permitted<ProtocolDraft>(actor, 'protocols', id); }
  experiments(actor: Actor, project: unknown) {
    requireProject(actor, project);
    return this.store.list<Experiment>('experiments', project);
  }
  saveDraft(actor: Actor, project: unknown, parsed: Omit<ProtocolDraft, 'id' | 'project_id' | 'status' | 'created_at' | 'created_by'>, source: Uint8Array) {
    requireProject(actor, project, true);
    const draft: ProtocolDraft = { ...parsed, id: randomUUID(), project_id: project, status: 'draft', created_at: now(), created_by: actor.id };
    this.store.db.prepare('INSERT INTO protocols (id, project_id, data, source) VALUES (?, ?, ?, ?)').run(draft.id, project, JSON.stringify(draft), source);
    return draft;
  }
  approve(actor: Actor, id: string, body: Record<string, unknown>) {
    const original = this.protocol(actor, id);
    requireProject(actor, original.project_id, true);
    if (original.status === 'approved') throw new ApiError(409, 'ALREADY_APPROVED', 'This protocol version is already approved. Upload a new draft to make changes.');
    if (!original.supported_layout) throw new ApiError(422, 'UNSUPPORTED_PROTOCOL', 'Only the supported synthetic protocol layout can be approved.');
    if (body.acknowledged !== true) throw invalid('Explicitly acknowledge review of the source and assumptions.');
    if (!Array.isArray(body.rows) || body.rows.length !== original.rows.length || body.rows.length === 0) throw invalid('Review every extracted reagent row.');
    const inputRows = body.rows as ProtocolRow[];
    const seen = new Set<string>();
    const rows = original.rows.map(source => {
      const reviewed = inputRows.find(row => row.id === source.id);
      if (!reviewed || seen.has(reviewed.id)) throw invalid('Each original reagent row must be reviewed exactly once.');
      seen.add(reviewed.id);
      const resource = this.inventory(actor, original.project_id).find(row => row.id === reviewed.resource_id);
      if (!resource) throw invalid('Map every reagent to a permitted inventory resource.');
      let amount: string;
      try { amount = canonicalAmount(reviewed.per_reaction, reviewed.unit); }
      catch (error) { throw invalid(error instanceof Error ? error.message : 'Invalid reagent quantity.'); }
      if (compareAmounts(amount, '0') <= 0) throw invalid('Per-reaction amounts must be positive.');
      return { ...source, resource_id: resource.id, resource_name: resource.name,
        per_reaction: String(reviewed.per_reaction), unit: String(reviewed.unit), needs_review: false, issues: [] };
    });
    if (!Number.isSafeInteger(body.fixed_controls) || Number(body.fixed_controls) < 0 || Number(body.fixed_controls) > 10000) throw invalid('Review the non-negative whole control count.');
    if (!Number.isSafeInteger(body.replicates_per_specimen) || Number(body.replicates_per_specimen) < 1 || Number(body.replicates_per_specimen) > 1000) throw invalid('Review the positive whole replicate count.');
    if (typeof body.overage_percent !== 'string' || !/^\d+(\.\d{1,4})?$/.test(body.overage_percent) || Number(body.overage_percent) > 100) throw invalid('Explicit preparation overage must be a decimal percentage from 0 to 100.');
    const approved: ProtocolDraft = { ...original, rows, original_rows: structuredClone(original.rows),
      issues: original.issues.filter(issue => issue !== 'One or more reagent rows need review before approval.'),
      status: 'approved', fixed_controls: body.fixed_controls as number, replicates_per_specimen: body.replicates_per_specimen as number,
      overage_percent: body.overage_percent, reviewed_by: actor.id, reviewed_at: now(), approval_revision: 1 };
    // Contradictory source-level instructions remain blocking after a row edit.
    const result = calculatePlan(approved, this.inventory(actor, approved.project_id), 1);
    if (result.status === 'REVIEW-REQUIRED') throw new ApiError(422, 'REVIEW_REQUIRED', 'Resolve all protocol assumptions before approval.', result.issues);
    this.store.db.prepare('UPDATE protocols SET data=? WHERE id=?').run(JSON.stringify(approved), id);
    return approved;
  }
  preview(actor: Actor, body: Record<string, unknown>) {
    requireProject(actor, body.project_id);
    const projectId = body.project_id;
    const protocol = this.protocol(actor, text(body.protocol_id, 'Protocol ID'));
    if (protocol.project_id !== body.project_id) throw notFound();
    if (protocol.status !== 'approved') throw new ApiError(409, 'PROTOCOL_NOT_APPROVED', 'Review and approve protocol assumptions before planning.');
    return this.store.transaction(() => {
      const inventory = this.inventory(actor, body.project_id);
      let calculation: ReturnType<typeof calculatePlan>;
      try { calculation = calculatePlan(protocol, inventory, body.specimen_count); }
      catch (error) { throw invalid(error instanceof Error ? error.message : 'Invalid planning inputs.'); }
      if (calculation.status === 'REVIEW-REQUIRED') throw new ApiError(422, 'REVIEW_REQUIRED', 'The plan has unresolved assumptions.', calculation.issues);
      let experiment: Experiment;
      if (body.experiment_id) {
        experiment = this.permitted<Experiment>(actor, 'experiments', text(body.experiment_id, 'Experiment ID'));
        if (experiment.project_id !== body.project_id) throw notFound();
        if (experiment.status !== 'planned') throw new ApiError(409, 'EXPERIMENT_COMPLETED', 'This experiment already has confirmed actual consumption.');
      } else {
        experiment = { id: randomUUID(), project_id: projectId, name: body.experiment_name ? text(body.experiment_name, 'Experiment name') : 'Synthetic microplate run', status: 'planned', created_at: now(), created_by: actor.id };
        this.store.put('experiments', experiment);
      }
      const plan: RunPlan = { ...calculation, specimen_count: body.specimen_count as number,
        reactions: calculation.reactions!, fixed_controls: calculation.fixed_controls!, replicates_per_specimen: calculation.replicates_per_specimen!, overage_percent: calculation.overage_percent!,
        id: randomUUID(), project_id: projectId, experiment_id: experiment.id,
        protocol_id: protocol.id, protocol_version: protocol.version, approval_revision: protocol.approval_revision!,
        created_by: actor.id, created_at: now(), consumption_events_created: 0 };
      this.store.put('plans', plan);
      return plan;
    });
  }
  confirm(actor: Actor, experimentId: string, body: Record<string, unknown>): Confirmation {
    const exp = this.permitted<Experiment>(actor, 'experiments', experimentId);
    requireProject(actor, exp.project_id, true);
    if (body.confirmed !== true) throw invalid('Explicit actual-use confirmation is required.');
    const plan = this.permitted<RunPlan>(actor, 'plans', text(body.plan_id, 'Plan ID'));
    if (plan.experiment_id !== experimentId || plan.project_id !== exp.project_id) throw notFound();
    const key = text(body.idempotency_key, 'Idempotency key', 128);
    if (!Array.isArray(body.actuals) || body.actuals.length !== plan.lines.length) throw invalid('Record actual consumption for every planned resource.');
    const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
    if (justification.length > 2000) throw invalid('Justification is limited to 2,000 characters.');
    const actuals = (body.actuals as ActualLine[]).map(line => {
      if (!line || typeof line !== 'object') throw invalid('Invalid actual consumption row.');
      text(line.resource_id, 'Resource ID', 80);
      let amount: string;
      try { amount = canonicalAmount(line.amount, line.unit); }
      catch (error) { throw invalid(error instanceof Error ? error.message : 'Invalid actual amount.'); }
      if (line.lot_id !== null && line.lot_id !== undefined && (typeof line.lot_id !== 'string' || line.lot_id.length > 120)) throw invalid('Invalid lot identifier.');
      return { resource_id: line.resource_id, amount, unit: 'uL', lot_id: line.lot_id || null };
    }).sort((a, b) => a.resource_id.localeCompare(b.resource_id));
    if (new Set(actuals.map(row => row.resource_id)).size !== plan.lines.length || actuals.some(row => !plan.lines.some(line => line.resource_id === row.resource_id))) throw invalid('Supply each planned resource exactly once.');
    if (actuals.every(row => compareAmounts(row.amount, '0') === 0)) throw invalid('No consumption was recorded. Leave the experiment planned or enter actual quantities.');
    if (actuals.some(row => compareAmounts(row.amount, plan.lines.find(line => line.resource_id === row.resource_id)!.required) !== 0) && !justification) throw invalid('Explain any variance between planned preparation and actual consumption.');
    const requestHash = createHash('sha256').update(JSON.stringify({ experimentId, plan_id: plan.id, actuals, justification })).digest('hex');
    return this.store.transaction(() => {
      const previous = this.store.db.prepare('SELECT request_hash, data FROM confirmations WHERE project_id=? AND actor_id=? AND idempotency_key=?').get(exp.project_id, actor.id, key) as { request_hash: string; data: string } | undefined;
      if (previous) {
        if (previous.request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for different actual consumption.');
        return { ...JSON.parse(previous.data), replayed: true };
      }
      const currentExperiment = this.permitted<Experiment>(actor, 'experiments', experimentId);
      if (currentExperiment.status !== 'planned') throw new ApiError(409, 'ALREADY_CONFIRMED', 'Actual consumption has already been recorded for this experiment.');
      const protocol = this.protocol(actor, plan.protocol_id);
      if (protocol.approval_revision !== plan.approval_revision) throw new ApiError(409, 'STALE_PLAN', 'Protocol review changed. Create a fresh preview.');
      const inventory = this.inventory(actor, exp.project_id);
      const timestamp = now();
      const events: ConsumptionEvent[] = [];
      for (const line of plan.lines) {
        const resource = inventory.find(row => row.id === line.resource_id);
        const actual = actuals.find(row => row.resource_id === line.resource_id)!;
        if (!resource || resource.revision !== line.inventory_revision) throw new ApiError(409, 'STALE_INVENTORY', 'Inventory changed after preview. Refresh the plan before confirming.');
        if (compareAmounts(actual.amount, resource.balance) > 0) throw new ApiError(409, 'INSUFFICIENT_STOCK', `Recorded stock is insufficient for actual use of ${resource.name}.`);
        const lot = actual.lot_id ? resource.lots.find(row => row.id === actual.lot_id) : undefined;
        if (actual.lot_id && !lot) throw invalid('Selected lot does not belong to the resource.');
        if (lot && (compareAmounts(actual.amount, lot.balance) > 0 || (lot.expires && lot.expires < timestamp.slice(0, 10)))) throw new ApiError(409, 'LOT_UNAVAILABLE', `Selected lot for ${resource.name} is expired or has insufficient recorded stock.`);
        // Unknown-lot actual use remains explicit. It is never silently allocated to a bottle.
        if (lot) lot.balance = subtractAmounts(lot.balance, actual.amount);
        else if (compareAmounts(actual.amount, '0') > 0 && resource.lots.length) {
          // We cannot continue to promise remaining per-lot quantities after unattributed use.
          resource.lots = [];
        }
        resource.balance = subtractAmounts(resource.balance, actual.amount);
        resource.revision += 1;
        this.store.put('inventory', resource);
        const issues = [...(!actual.lot_id ? ['Actual-use lot is unverified.'] : []), ...(lot && !lot.expires ? ['Lot expiry is not recorded.'] : [])];
        events.push({ id: randomUUID(), project_id: exp.project_id, experiment_id: experimentId, plan_id: plan.id,
          resource_id: resource.id, resource_name: resource.name, planned: line.required, actual: actual.amount,
          variance: subtractAmounts(actual.amount, line.required), unit: 'uL', lot_id: actual.lot_id,
          issues, actor_id: actor.id, timestamp, justification });
      }
      const confirmation: Confirmation = { id: randomUUID(), experiment_id: experimentId, plan_id: plan.id, actor_id: actor.id, timestamp, events, replayed: false };
      this.store.db.prepare('INSERT INTO confirmations (id,project_id,experiment_id,actor_id,idempotency_key,request_hash,data) VALUES (?,?,?,?,?,?,?)').run(confirmation.id, exp.project_id, experimentId, actor.id, key, requestHash, JSON.stringify(confirmation));
      const insert = this.store.db.prepare('INSERT INTO consumption_events (id,project_id,experiment_id,data) VALUES (?,?,?,?)');
      for (const event of events) insert.run(event.id, exp.project_id, experimentId, JSON.stringify(event));
      this.store.put('experiments', { ...currentExperiment, status: 'completed' } as Experiment);
      return confirmation;
    });
  }
  continuity(actor: Actor, experimentId: string) {
    const experiment = this.permitted<Experiment>(actor, 'experiments', experimentId);
    const plans = this.store.list<RunPlan>('plans', experiment.project_id, experimentId);
    const events = this.store.list<ConsumptionEvent>('consumption_events', experiment.project_id, experimentId);
    const confirmations = this.store.list<Confirmation>('confirmations', experiment.project_id, experimentId);
    return { experiment, protocol: plans.length ? this.protocol(actor, plans[plans.length - 1].protocol_id) : null,
      plans, confirmations, events, issues: [...new Set(events.flatMap(event => event.issues))] };
  }
}
