import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InventoryResource, ProtocolDraft, ProtocolRow, RunPlan } from '../../preflight/types';
import type { Actor } from './auth';
import { ApiError } from './errors';
import { LabService } from './service';
import { LabStore } from './store';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ dev: false }));
// Vite 5's builtin list predates node:sqlite. Load the real Node 24 binding
// through require; all persistence, transactions and triggers remain genuine.
vi.mock('node:sqlite', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('node:sqlite');
});

const actor: Actor = { id: 'scientist-1', name: 'Test scientist', role: 'researcher', nonce: 'test-nonce', expires: Number.MAX_SAFE_INTEGER, demo: true };
type Parsed = Omit<ProtocolDraft, 'id' | 'project_id' | 'status' | 'created_at' | 'created_by'>;
function parsedFixture(): Parsed {
  const resources = [['buffer-a', 'Buffer A', '60'], ['indicator-b', 'Indicator B', '15'], ['wash-c', 'Wash C', '100']];
  return {
    protocol_id: 'synthetic-microplate', version: '1.0', title: 'Synthetic Microplate Readout SOP',
    filename: 'synthetic.pdf', file_hash: 'independent-test-source-hash', supported_layout: true,
    extraction_method: 'supported-template', fixed_controls: 2, replicates_per_specimen: 1,
    overage_percent: '10', issues: [], source_text: 'Synthetic source; no biological instructions.',
    rows: resources.map(([id, name, quantity], index): ProtocolRow => ({
      id: `row-${index + 1}`, resource_id: id, resource_name: name, per_reaction: quantity, unit: 'uL',
      source_page: 1, source_row: index + 1, source_excerpt: `${name} | ${quantity} uL per reaction`,
      needs_review: false, issues: []
    }))
  };
}

function expectApiError(action: () => unknown, code: string, status?: number) {
  try { action(); throw new Error('Expected API action to fail'); }
  catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    if (status !== undefined) expect((error as ApiError).status).toBe(status);
    return error as ApiError;
  }
}

describe('LabService transactional experiment preflight', () => {
  let store: LabStore;
  let service: LabService;
  beforeEach(() => {
    vi.stubEnv('LABRELAX_SEED_DEMO', 'true');
    store = new LabStore(':memory:');
    service = new LabService(store);
  });
  afterEach(() => { store.close(); vi.unstubAllEnvs(); });

  function draft(parsed = parsedFixture()) {
    return service.saveDraft(actor, 'demo-lab', parsed, new TextEncoder().encode('Synthetic source document'));
  }
  function approvalBody(protocol: ProtocolDraft) {
    return { acknowledged: true, rows: structuredClone(protocol.rows), fixed_controls: 2, replicates_per_specimen: 1, overage_percent: '10' };
  }
  function approved(parsed = parsedFixture()) {
    const protocol = draft(parsed);
    return service.approve(actor, protocol.id, approvalBody(protocol));
  }
  function preview(specimens = 6, protocol = approved()) {
    return service.preview(actor, { project_id: 'demo-lab', protocol_id: protocol.id, specimen_count: specimens });
  }
  function confirmationBody(plan: RunPlan, knownLots = true) {
    const inventory = service.inventory(actor, 'demo-lab');
    return {
      confirmed: true, plan_id: plan.id, idempotency_key: `key-${plan.id}`, justification: '',
      actuals: plan.lines.map(line => ({
        resource_id: line.resource_id, amount: line.required, unit: 'uL',
        lot_id: knownLots ? inventory.find(resource => resource.id === line.resource_id)!.lots[0]?.id ?? null : null
      }))
    };
  }
  function eventCount() { return store.list('consumption_events', 'demo-lab').length; }
  function importBody(resources = service.inventory(actor, 'demo-lab')) {
    return { project_id: 'demo-lab', confirmed: true, source_name: 'Independent inventory fixture', resources };
  }

  it('keeps original source evidence when the reviewer edits a reagent quantity', () => {
    const protocol = draft();
    const body = approvalBody(protocol);
    body.rows[0].per_reaction = '61';
    const result = service.approve(actor, protocol.id, body);
    expect(result.status).toBe('approved');
    expect(result.rows[0].per_reaction).toBe('61');
    expect(result.rows[0].source_excerpt).toBe('Buffer A | 60 uL per reaction');
    expect(result.original_rows?.[0].per_reaction).toBe('60');
    expect(result.reviewed_by).toBe(actor.id);
    expect(result.reviewed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.approval_revision).toBe(1);
    expect(service.protocol(actor, protocol.id)).toEqual(result);
  });

  it('allows an explicit row correction while retaining the ambiguous original source', () => {
    const parsed = parsedFixture();
    parsed.rows[1].per_reaction = null;
    parsed.rows[1].needs_review = true;
    parsed.rows[1].issues = ['Per-reaction amount is ambiguous.'];
    parsed.rows[1].source_excerpt = 'Indicator B | 15 or 16 | uL';
    parsed.issues = ['One or more reagent rows need review before approval.'];
    const protocol = draft(parsed);
    const body = approvalBody(protocol);
    body.rows[1].per_reaction = '15';
    const result = service.approve(actor, protocol.id, body);
    expect(result.status).toBe('approved');
    expect(result.original_rows?.[1].per_reaction).toBeNull();
    expect(result.rows[1].source_excerpt).toContain('15 or 16');
    expect(preview(8, result).lines[1].shortage).toBe('15');
    expect(eventCount()).toBe(0);
  });

  it('previews8 versus6 specimens with exact independent expectations and zero consumption', () => {
    const initialStock = service.inventory(actor, 'demo-lab');
    const protocol = approved();
    const eight = preview(8, protocol);
    const six = service.preview(actor, { project_id: 'demo-lab', protocol_id: protocol.id, specimen_count: 6, experiment_id: eight.experiment_id });
    expect(eight.status).toBe('SHORTAGE');
    expect(eight.lines.map(line => line.required)).toEqual(['660', '165', '1100']);
    expect(eight.lines[1]).toMatchObject({ shortage: '15', conventional_low_stock: false });
    expect(six.status).toBe('RESOURCE-SUFFICIENT');
    expect(six.lines.map(line => line.required)).toEqual(['528', '132', '880']);
    expect(six.lines.map(line => line.forecast_balance)).toEqual(['172', '18', '1120']);
    expect(eight.consumption_events_created).toBe(0);
    expect(six.consumption_events_created).toBe(0);
    expect(eventCount()).toBe(0);
    expect(service.inventory(actor, 'demo-lab')).toEqual(initialStock);
    expect(service.continuity(actor, eight.experiment_id).plans).toHaveLength(2);
  });

  it.each(['unacknowledged', 'invalid-amount', 'unresolved-source', 'missing-provenance'])('does not persist partial approval or mutate stock for %s', condition => {
    const parsed = parsedFixture();
    if (condition === 'unresolved-source') parsed.issues = ['Contradictory batch-versus-reaction instruction'];
    if (condition === 'missing-provenance') parsed.rows[2].source_excerpt = '';
    const protocol = draft(parsed);
    const stock = service.inventory(actor, 'demo-lab');
    const body = approvalBody(protocol);
    if (condition === 'unacknowledged') body.acknowledged = false;
    if (condition === 'invalid-amount') body.rows[1].per_reaction = '-1';
    expect(() => service.approve(actor, protocol.id, body)).toThrow(ApiError);
    expect(service.protocol(actor, protocol.id)).toEqual(protocol);
    expect(service.inventory(actor, 'demo-lab')).toEqual(stock);
    expect(eventCount()).toBe(0);
  });

  it('rejects unapproved preview and invalid specimen counts without creating experiments or plans', () => {
    const protocol = draft();
    expectApiError(() => preview(6, protocol), 'PROTOCOL_NOT_APPROVED', 409);
    const reviewed = service.approve(actor, protocol.id, approvalBody(protocol));
    expectApiError(() => preview(1.5, reviewed), 'INVALID_INPUT', 400);
    expect(service.experiments(actor, 'demo-lab')).toEqual([]);
    expect(store.list('plans', 'demo-lab')).toEqual([]);
    expect(eventCount()).toBe(0);
  });

  it('requires explicit confirmation and actual amounts rather than consuming a preview', () => {
    const plan = preview();
    const stock = service.inventory(actor, 'demo-lab');
    const body = confirmationBody(plan);
    body.confirmed = false;
    expectApiError(() => service.confirm(actor, plan.experiment_id, body), 'INVALID_INPUT', 400);
    expect(service.inventory(actor, 'demo-lab')).toEqual(stock);
    expect(eventCount()).toBe(0);
  });

  it('commits one event per resource and keeps planned/actual variance and reviewer identity', () => {
    const plan = preview();
    const body = confirmationBody(plan);
    body.actuals[0].amount = '520';
    body.justification = 'Scientist recorded actual preparation after the run.';
    const result = service.confirm(actor, plan.experiment_id, body);
    expect(result.replayed).toBe(false);
    expect(result.events).toHaveLength(3);
    expect(result.events[0]).toMatchObject({ actor_id: actor.id, planned: '528', actual: '520', variance: '-8', lot_id: 'BUF-001' });
    expect(service.inventory(actor, 'demo-lab').map(row => row.balance)).toEqual(['180', '18', '1120']);
    expect(service.inventory(actor, 'demo-lab').map(row => row.revision)).toEqual([2, 2, 2]);
    const continuity = service.continuity(actor, plan.experiment_id);
    expect(continuity.experiment.status).toBe('completed');
    expect(continuity.events).toEqual(result.events);
    expect(continuity.protocol?.version).toBe('1.0');
  });

  it('replays identical confirmation without a second stock change or event', () => {
    const plan = preview();
    const body = confirmationBody(plan);
    const first = service.confirm(actor, plan.experiment_id, body);
    const stock = service.inventory(actor, 'demo-lab');
    const second = service.confirm(actor, plan.experiment_id, body);
    expect(second.replayed).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.events).toEqual(first.events);
    expect(service.inventory(actor, 'demo-lab')).toEqual(stock);
    expect(eventCount()).toBe(3);
    expect(store.list('confirmations', 'demo-lab')).toHaveLength(1);
  });

  it('rejects idempotency-key reuse with changed actuals and repeated confirmation with a new key', () => {
    const plan = preview();
    const body = confirmationBody(plan);
    service.confirm(actor, plan.experiment_id, body);
    const changed = structuredClone(body);
    changed.actuals[0].amount = '500';
    changed.justification = 'Corrected actual amount';
    expectApiError(() => service.confirm(actor, plan.experiment_id, changed), 'IDEMPOTENCY_CONFLICT', 409);
    expectApiError(() => service.confirm(actor, plan.experiment_id, { ...body, idempotency_key: 'another-key' }), 'ALREADY_CONFIRMED', 409);
    expect(eventCount()).toBe(3);
  });

  it('rolls back earlier resource deductions when a later actual amount exceeds stock', () => {
    const plan = preview(8);
    const stock = service.inventory(actor, 'demo-lab');
    expectApiError(() => service.confirm(actor, plan.experiment_id, confirmationBody(plan)), 'INSUFFICIENT_STOCK', 409);
    expect(service.inventory(actor, 'demo-lab')).toEqual(stock);
    expect(eventCount()).toBe(0);
    expect(store.list('confirmations', 'demo-lab')).toEqual([]);
    expect(service.continuity(actor, plan.experiment_id).experiment.status).toBe('planned');
  });

  it('rejects a competing experiment planned from an older stock revision', () => {
    const protocol = approved();
    const first = preview(6, protocol);
    const competing = preview(6, protocol);
    service.confirm(actor, first.experiment_id, confirmationBody(first));
    const current = service.inventory(actor, 'demo-lab');
    expectApiError(() => service.confirm(actor, competing.experiment_id, confirmationBody(competing)), 'STALE_INVENTORY', 409);
    expect(service.inventory(actor, 'demo-lab')).toEqual(current);
    expect(eventCount()).toBe(3);
  });

  it('aggregates multiple protocol rows for a resource into one exact deduction', () => {
    const parsed = parsedFixture();
    parsed.rows = [parsed.rows[0], { ...parsed.rows[0], id: 'second-use', source_row: 4, source_excerpt: 'Additional Buffer A | 10 uL per reaction', per_reaction: '10' }];
    const protocol = approved(parsed);
    const eight = preview(8, protocol);
    expect(eight.status).toBe('SHORTAGE');
    expect(eight.lines).toHaveLength(1);
    expect(eight.lines[0]).toMatchObject({ required: '770', shortage: '70' });
    const six = preview(6, protocol);
    expect(six.lines[0].required).toBe('616');
    const confirmation = service.confirm(actor, six.experiment_id, confirmationBody(six));
    expect(confirmation.events).toHaveLength(1);
    expect(service.inventory(actor, 'demo-lab')[0].balance).toBe('84');
  });

  it('requires variance justification and refuses duplicated or malformed actual resource rows', () => {
    const plan = preview();
    const body = confirmationBody(plan);
    body.actuals[0].amount = '500';
    expectApiError(() => service.confirm(actor, plan.experiment_id, body), 'INVALID_INPUT', 400);
    const duplicate = confirmationBody(plan);
    duplicate.actuals[1] = duplicate.actuals[0];
    expectApiError(() => service.confirm(actor, plan.experiment_id, duplicate), 'INVALID_INPUT', 400);
    const malformed = confirmationBody(plan);
    (malformed.actuals[1] as unknown as Record<string, unknown>).resource_id = null;
    expectApiError(() => service.confirm(actor, plan.experiment_id, malformed), 'INVALID_INPUT', 400);
    expect(eventCount()).toBe(0);
  });

  it('retains unknown-lot uncertainty without inventing a lot allocation', () => {
    const plan = preview();
    const result = service.confirm(actor, plan.experiment_id, confirmationBody(plan, false));
    expect(result.events.every(event => event.lot_id === null)).toBe(true);
    expect(result.events.every(event => event.issues.includes('Actual-use lot is unverified.'))).toBe(true);
    expect(service.continuity(actor, plan.experiment_id).issues).toContain('Actual-use lot is unverified.');
    expect(service.inventory(actor, 'demo-lab').every(resource => resource.lots.length === 0)).toBe(true);
  });

  it('rejects expired or unrelated lots with no consumption effects', () => {
    const resource = service.inventory(actor, 'demo-lab')[1];
    resource.lots[0].expires = '2000-01-01';
    store.put('inventory', resource);
    const plan = preview();
    const stock = service.inventory(actor, 'demo-lab');
    expectApiError(() => service.confirm(actor, plan.experiment_id, confirmationBody(plan)), 'LOT_UNAVAILABLE', 409);
    const wrongLot = confirmationBody(plan);
    wrongLot.actuals[0].lot_id = 'IND-001';
    expectApiError(() => service.confirm(actor, plan.experiment_id, wrongLot), 'INVALID_INPUT', 400);
    expect(service.inventory(actor, 'demo-lab')).toEqual(stock);
    expect(eventCount()).toBe(0);
  });

  it('enforces append-only events and confirmations at the database boundary', () => {
    const plan = preview();
    const confirmation = service.confirm(actor, plan.experiment_id, confirmationBody(plan));
    for (const table of ['consumption_events', 'confirmations']) {
      expect(() => store.db.prepare(`UPDATE ${table} SET data='{}'`).run()).toThrow(/Append-only/);
      expect(() => store.db.prepare(`DELETE FROM ${table}`).run()).toThrow(/Append-only/);
    }
    expect(store.list('consumption_events', 'demo-lab')).toHaveLength(3);
    expect(store.list('confirmations', 'demo-lab')[0]).toEqual(confirmation);
  });

  it('denies every restricted-project service path without disclosing content or counts', () => {
    const secret = { ...draft(), id: 'private-protocol', project_id: 'private-project', title: 'SECRET_PROTOCOL_TITLE' };
    store.db.prepare('INSERT INTO protocols (id,project_id,data,source) VALUES (?,?,?,?)').run(secret.id, secret.project_id, JSON.stringify(secret), new Uint8Array());
    store.put('experiments', { id: 'private-experiment', project_id: 'private-project', name: 'SECRET_EXPERIMENT_NAME' } as never);
    const plan = preview();
    store.put('plans', { ...plan, id: 'private-plan', project_id: 'private-project', experiment_id: 'private-experiment' });
    const actions = [
      () => service.inventory(actor, 'private-project'),
      () => service.experiments(actor, 'private-project'),
      () => service.importInventory(actor, { project_id: 'private-project' }),
      () => service.saveDraft(actor, 'private-project', parsedFixture(), new Uint8Array()),
      () => service.protocol(actor, secret.id),
      () => service.approve(actor, secret.id, {}),
      () => service.preview(actor, { project_id: 'private-project', protocol_id: secret.id, specimen_count: 6 }),
      () => service.preview(actor, { project_id: 'demo-lab', protocol_id: secret.id, specimen_count: 6 }),
      () => service.confirm(actor, 'private-experiment', {}),
      () => service.confirm(actor, plan.experiment_id, { confirmed: true, plan_id: 'private-plan' }),
      () => service.continuity(actor, 'private-experiment')
    ];
    for (const action of actions) {
      const error = expectApiError(action, 'NOT_FOUND', 404);
      expect(error.message).toBe('Resource not found or access is not permitted.');
      expect(error.details).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain('SECRET');
      expect(JSON.stringify(error)).not.toContain('private-');
    }
  });

  it('does not let baseline import overwrite a resource owned by another project', () => {
    const privateResource: InventoryResource = { id: 'private-stock', project_id: 'private-project', name: 'SECRET_STOCK', unit: 'uL', balance: '42', reorder_threshold: '1', revision: 5, lots: [] };
    store.put('inventory', privateResource);
    const before = service.inventory(actor, 'demo-lab');
    expectApiError(() => service.importInventory(actor, importBody([{ ...privateResource, project_id: 'demo-lab' }])), 'NOT_FOUND', 404);
    expect(store.get('inventory', privateResource.id)).toEqual(privateResource);
    expect(service.inventory(actor, 'demo-lab')).toEqual(before);
  });

  it('keeps import revisions increasing across removal and reintroduction and invalidates old plans', () => {
    const plan = preview();
    const original = service.inventory(actor, 'demo-lab');
    const withoutBuffer = service.importInventory(actor, importBody(original.slice(1))).resources;
    expect(withoutBuffer.every(resource => resource.revision > 1)).toBe(true);
    const restored = service.importInventory(actor, importBody(original)).resources;
    expect(restored.every(resource => resource.revision > withoutBuffer[0].revision)).toBe(true);
    expectApiError(() => service.confirm(actor, plan.experiment_id, confirmationBody(plan)), 'STALE_INVENTORY', 409);
    expect(eventCount()).toBe(0);
  });

  it('locks baseline replacement after actual use, preserving balances and ledger', () => {
    const plan = preview();
    service.confirm(actor, plan.experiment_id, confirmationBody(plan));
    const before = service.inventory(actor, 'demo-lab');
    expectApiError(() => service.importInventory(actor, importBody()), 'BASELINE_LOCKED', 409);
    expect(service.inventory(actor, 'demo-lab')).toEqual(before);
    expect(eventCount()).toBe(3);
  });

  it('does not reintroduce removed seed resources when the persisted database reopens', () => {
    const folder = mkdtempSync(join(tmpdir(), 'labrelax-persistence-test-'));
    const path = join(folder, 'lab.sqlite');
    let persistent = new LabStore(path);
    try {
      const localService = new LabService(persistent);
      const remaining = localService.inventory(actor, 'demo-lab').filter(resource => resource.id !== 'buffer-a');
      localService.importInventory(actor, { project_id: 'demo-lab', confirmed: true, resources: remaining });
      persistent.close();
      persistent = new LabStore(path);
      expect(new LabService(persistent).inventory(actor, 'demo-lab').map(resource => resource.id)).toEqual(['indicator-b', 'wash-c']);
    } finally { persistent.close(); rmSync(folder, { recursive: true, force: true }); }
  });
});
