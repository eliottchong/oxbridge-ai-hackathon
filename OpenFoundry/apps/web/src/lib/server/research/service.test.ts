import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Actor } from '../preflight/auth';
import type { ProtocolDraft, ProtocolRow } from '../../preflight/types';
import { ApiError } from '../preflight/errors';
import { LabStore } from '../preflight/store';
import { LabService } from '../preflight/service';
import { ResearchService } from './service';
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('node:sqlite', async () => { const { createRequire } = await import('node:module'); return createRequire(import.meta.url)('node:sqlite'); });
const actor: Actor = { id: 'researcher', name: 'Scientist', role: 'researcher', nonce: 'test', expires: Number.MAX_SAFE_INTEGER, demo: true };
const csv = (name = 'initial') => readFileSync(`static/research-companion/synthetic-${name}.csv`, 'utf8');
function expectCode(fn: () => unknown, code: string) {
  try { fn(); throw new Error('Expected API error'); } catch (error) { expect(error).toBeInstanceOf(ApiError); expect((error as ApiError).code).toBe(code); }
}
describe('persistent investigation service', () => {
  let store: LabStore, service: ResearchService, lab: LabService;
  beforeEach(() => { vi.stubEnv('LABRELAX_SEED_DEMO', 'true'); store = new LabStore(':memory:'); lab = new LabService(store); service = new ResearchService(store); });
  afterEach(() => { store.close(); vi.unstubAllEnvs(); });
  function investigation() { return service.create(actor, { project_id: 'demo-lab', title: 'Order or sample?', goal: 'Explain the observed contrast.' }); }
  function evidence(id: string, name = 'initial') { return service.importEvidence(actor, id, { phase: name === 'initial' ? 'initial' : 'followup', kind: 'synthetic_observation', filename: `synthetic-${name}.csv`, csv: csv(name), protocol_version: '1.0' }); }
  function design(id: string) {
    const parsed: Omit<ProtocolDraft, 'id' | 'project_id' | 'status' | 'created_at' | 'created_by'> = { protocol_id: 'synthetic', version: '1.0', title: 'Synthetic protocol', filename: 'synthetic.pdf', file_hash: 'sourcehash', supported_layout: true, extraction_method: 'supported-template', fixed_controls: 2, replicates_per_specimen: 1, overage_percent: '10', issues: [], source_text: 'Synthetic illustration', rows: [['buffer-a', '60'], ['indicator-b', '15'], ['wash-c', '100']].map(([resource_id, per_reaction], i): ProtocolRow => ({ id: `row-${i}`, resource_id, resource_name: resource_id, per_reaction, unit: 'uL', source_page: 1, source_row: i + 1, source_excerpt: `${resource_id} ${per_reaction} uL`, needs_review: false, issues: [] })) };
    const draft = lab.saveDraft(actor, 'demo-lab', parsed, new Uint8Array([1]));
    const p = lab.approve(actor, draft.id, { acknowledged: true, rows: draft.rows, fixed_controls: 2, replicates_per_specimen: 1, overage_percent: '10' });
    return service.reviewDesign(actor, id, { protocol_id: p.id, acknowledged: true });
  }
  function job(id: string, key = 'job-1') {
    const { run } = service.beginRun(actor, id, key, 'scripted_walkthrough');
    const analysis = service.analyse(actor, id, run.id, run.evidence_ids), plan = service.prepareMaterials(actor, id, run.id, analysis.id);
    const proposal = service.saveRecommendation(actor, id, run.id, analysis.id, plan, 'Descriptive results only.');
    service.completeRun(actor, id, run.id, analysis.output.next_direction); return { run, analysis, plan, proposal };
  }
  it('retains exact source content, rows, actor and hash without stock writes', () => {
    const inv = investigation(), before = lab.inventory(actor, 'demo-lab'), imported = evidence(inv.id);
    expect(imported.original_content).toBe(csv()); expect(imported.content_hash).toBe(createHash('sha256').update(csv()).digest('hex'));
    expect(imported.rows[0].source_row).toBe(2); expect(imported.imported_by).toBe(actor.id);
    expect(service.detail(actor, inv.id).evidence).toEqual([imported]); expect(lab.inventory(actor, 'demo-lab')).toEqual(before); expect(store.list('consumption_events', 'demo-lab')).toEqual([]);
  });
  it('detects confounding and preserves the full design despite a material shortage', () => {
    const inv = investigation(); evidence(inv.id); design(inv.id); const before = lab.inventory(actor, 'demo-lab'), result = job(inv.id);
    expect(result.analysis.output.classification).toBe('confounded'); expect(result.proposal.status).toBe('blocked');
    expect(result.plan).toMatchObject({ specimen_count: 8, fixed_controls: 2, reactions: 10, status: 'SHORTAGE' });
    expect(result.plan?.lines.find(line => line.resource_id === 'indicator-b')?.shortage).toBe('15');
    expect(lab.inventory(actor, 'demo-lab')).toEqual(before); expect(store.list('consumption_events', 'demo-lab')).toHaveLength(0);
    expect(lab.continuity(actor, result.plan!.experiment_id).experiment.status).toBe('planned');
  });
  it.each(['specimen', 'control'])('rejects unreviewed %s group-label changes instead of comparing different groups across runs', kind => {
    const inv = investigation(), before = lab.inventory(actor, 'demo-lab');
    const content = kind === 'specimen' ? csv().replaceAll(',A,', ',C,') : csv().replaceAll(',CONTROL,', ',A,');
    expectCode(() => service.importEvidence(actor, inv.id, { phase: 'initial', kind: 'synthetic_observation', filename: 'unmapped.csv', csv: content, protocol_version: '1.0' }), 'INVALID_INPUT');
    expect(service.detail(actor, inv.id).evidence).toHaveLength(0);
    expect(lab.inventory(actor, 'demo-lab')).toEqual(before);
  });
  it('replays jobs, analyses, previews, proposals and tool steps without duplicate records', () => {
    const inv = investigation(); evidence(inv.id); design(inv.id); const { run } = service.beginRun(actor, inv.id, 'same', 'scripted_walkthrough');
    const analysis = service.analyse(actor, inv.id, run.id, run.evidence_ids), plan = service.prepareMaterials(actor, inv.id, run.id, analysis.id);
    const step = { id: 'tool-1', tool: 'analyse', label: 'Compared groups', status: 'completed' as const, input: {}, output: analysis, started_at: new Date().toISOString(), completed_at: new Date().toISOString() };
    service.recordStep(actor, inv.id, run.id, step); service.recordStep(actor, inv.id, run.id, step);
    const proposal = service.saveRecommendation(actor, inv.id, run.id, analysis.id, plan); service.completeRun(actor, inv.id, run.id, 'Finished');
    expect(service.beginRun(actor, inv.id, 'same', 'scripted_walkthrough')).toMatchObject({ replayed: true, run: { id: run.id } });
    expect(service.analyse(actor, inv.id, run.id, run.evidence_ids).id).toBe(analysis.id);
    expect(service.prepareMaterials(actor, inv.id, run.id, analysis.id)?.id).toBe(plan?.id);
    expect(service.saveRecommendation(actor, inv.id, run.id, analysis.id, plan).id).toBe(proposal.id);
    expect(service.detail(actor, inv.id)).toMatchObject({ runs: [{ steps: [step] }], revisions: [{ revision: 1 }] }); expect(store.list('plans', 'demo-lab')).toHaveLength(1);
  });
  it('refreshes stale stock readiness on review while preserving experiment identity and counts', () => {
    const inv = investigation(); evidence(inv.id); design(inv.id); const result = job(inv.id);
    lab.importInventory(actor, { project_id: 'demo-lab', confirmed: true, resources: lab.inventory(actor, 'demo-lab').map(resource => ({ ...resource, balance: '5000', lots: [] })) });
    expect(service.detail(actor, inv.id).proposals[0].readiness_stale).toBe(true);
    const reviewed = service.reviewProposal(actor, inv.id, result.proposal.id, { acknowledged: true });
    expect(reviewed.status).toBe('awaiting_results'); expect(reviewed.experiment_id).toBe(result.plan?.experiment_id); expect(reviewed.plan_id).not.toBe(result.plan?.id);
    expect(reviewed.material_plan?.specimen_count).toBe(8); expect(store.list('consumption_events', 'demo-lab')).toHaveLength(0);
  });
  it.each([['followup', 'order_trend'], ['no-signal', 'no_clear_signal'], ['sample-effect', 'sample_effect']])('new %s evidence revises the direction without a second physical experiment', (name, classification) => {
    const inv = investigation(); evidence(inv.id); design(inv.id); const initial = job(inv.id), imported = evidence(inv.id, name);
    expectCode(() => service.reviewProposal(actor, inv.id, initial.proposal.id, { acknowledged: true }), 'STALE_EVIDENCE');
    const result = job(inv.id, 'followup-job'); expect(result.run.evidence_ids).toEqual([imported.id]); expect(result.analysis.output.classification).toBe(classification);
    expect(result.proposal.status).toBe('direction_only'); expect(result.plan).toBeNull(); expect(result.proposal.experiment_id).toBeNull();
    expectCode(() => service.reviewProposal(actor, inv.id, result.proposal.id, { acknowledged: true }), 'DIRECTION_ONLY');
    expect(service.detail(actor, inv.id).revisions).toHaveLength(2); expect(store.list('plans', 'demo-lab')).toHaveLength(1); expect(store.list('consumption_events', 'demo-lab')).toHaveLength(0);
  });
  it('rejects malformed, incomplete, mismatched or unreviewed results without partial evidence writes', () => {
    const inv = investigation(), before = lab.inventory(actor, 'demo-lab'); expectCode(() => evidence(inv.id, 'followup'), 'DESIGN_REVIEW_REQUIRED'); design(inv.id);
    for (const content of [csv('followup').replace(',A,1,', ',A,99,'), csv('followup').split('\n').slice(0, 10).join('\n'), 'wrong\nheaders']) expectCode(() => service.importEvidence(actor, inv.id, { phase: 'followup', kind: 'synthetic_observation', filename: 'bad.csv', csv: content, protocol_version: '1.0' }), 'INVALID_INPUT');
    expectCode(() => service.importEvidence(actor, inv.id, { phase: 'initial', kind: 'synthetic_observation', filename: 'bad.csv', csv: csv(), protocol_version: 'other' }), 'INVALID_INPUT');
    expect(service.detail(actor, inv.id).evidence).toHaveLength(0); expect(lab.inventory(actor, 'demo-lab')).toEqual(before);
  });
  it('isolates projects and investigations behind generic 404 errors', () => {
    const a = investigation(), b = investigation(), source = evidence(a.id); evidence(b.id); const run = service.beginRun(actor, b.id, 'b-run', 'scripted_walkthrough').run;
    expectCode(() => service.readEvidence(actor, b.id, [source.id]), 'NOT_FOUND'); expectCode(() => service.getRun(actor, a.id, run.id), 'NOT_FOUND');
    const privateItem = { ...a, id: 'private-investigation', project_id: 'secret-project' }; store.db.prepare('INSERT INTO investigations VALUES (?,?,?)').run(privateItem.id, privateItem.project_id, JSON.stringify(privateItem));
    expectCode(() => service.detail(actor, privateItem.id), 'NOT_FOUND'); expectCode(() => service.list(actor, 'secret-project'), 'NOT_FOUND');
    expectCode(() => service.create(actor, { project_id: 'secret-project', title: 'Secret', goal: 'secret' }), 'NOT_FOUND');
  });
  it('blocks changes during an active job and records provider failure cleanly', () => {
    const inv = investigation(); evidence(inv.id); const run = service.beginRun(actor, inv.id, 'live', 'live_agent').run;
    expectCode(() => evidence(inv.id), 'RUN_IN_PROGRESS'); service.failRun(actor, inv.id, run.id, 'Provider unavailable');
    expect(service.getRun(actor, inv.id, run.id)).toMatchObject({ status: 'failed', error: 'Provider unavailable' }); expect(service.detail(actor, inv.id).investigation.status).toBe('failed'); expect(store.list('plans', 'demo-lab')).toHaveLength(0);
  });
  it('recovers an interrupted persisted job after its deadline without losing completed steps', () => {
    const inv = investigation(); evidence(inv.id);
    const run = service.beginRun(actor, inv.id, 'interrupted', 'live_agent').run;
    const step = { id: 'read-1', tool: 'read_evidence', label: 'Read observations', status: 'completed' as const, input: {}, output: { rows: 10 }, started_at: run.created_at, completed_at: run.created_at };
    service.recordStep(actor, inv.id, run.id, step);
    const interrupted = { ...service.getRun(actor, inv.id, run.id), created_at: new Date(Date.now() - 71000).toISOString() };
    store.db.prepare('UPDATE agent_runs SET data=? WHERE id=?').run(JSON.stringify(interrupted), run.id);
    expect(service.getRun(actor, inv.id, run.id)).toMatchObject({ status: 'failed', steps: [step] });
    expect(service.beginRun(actor, inv.id, 'interrupted', 'live_agent')).toMatchObject({ replayed: true, run: { status: 'failed' } });
    expect(service.beginRun(actor, inv.id, 'recovery', 'scripted_walkthrough')).toMatchObject({ replayed: false, run: { status: 'running' } });
    expect(store.list('consumption_events', 'demo-lab')).toHaveLength(0);
  });
  it('rejects old cached material preparation when newer results arrive', () => {
    const inv = investigation(); evidence(inv.id); design(inv.id); const old = job(inv.id);
    evidence(inv.id, 'followup');
    expectCode(() => service.prepareMaterials(actor, inv.id, old.run.id, old.analysis.id), 'STALE_EVIDENCE');
    expect(store.list('plans', 'demo-lab')).toHaveLength(1);
  });
  it('analyses only the latest same-phase observation while retaining older evidence', () => {
    const inv = investigation(); const old = evidence(inv.id), latest = evidence(inv.id);
    const result = job(inv.id);
    expect(result.analysis.evidence_ids).toEqual([latest.id]);
    expect(result.analysis.evidence_hashes).toEqual([latest.content_hash]);
    expect(service.detail(actor, inv.id).evidence.map(item => item.id)).toEqual([old.id, latest.id]);
  });
  function failedAfterPreparation(id: string, key = 'failed-provider') {
    const run = service.beginRun(actor, id, key, 'live_agent').run;
    const analysis = service.analyse(actor, id, run.id, run.evidence_ids);
    const plan = service.prepareMaterials(actor, id, run.id, analysis.id)!;
    service.failRun(actor, id, run.id, 'Provider unavailable after the material check.');
    return { run, plan };
  }
  it('reuses the same prepared plan and physical experiment on a new-key retry after provider failure', () => {
    const inv = investigation(); evidence(inv.id); design(inv.id); const before = lab.inventory(actor, 'demo-lab');
    const failed = failedAfterPreparation(inv.id), retry = job(inv.id, 'retry-after-provider');
    expect(retry.plan?.id).toBe(failed.plan.id); expect(retry.plan?.experiment_id).toBe(failed.plan.experiment_id);
    expect(lab.experiments(actor, 'demo-lab')).toHaveLength(1); expect(store.list('plans', 'demo-lab')).toHaveLength(1);
    expect(lab.inventory(actor, 'demo-lab')).toEqual(before); expect(store.list('consumption_events', 'demo-lab')).toHaveLength(0);
  });
  it('refreshes a retry preview after stock changes using the same physical experiment', () => {
    const inv = investigation(); evidence(inv.id); design(inv.id); const failed = failedAfterPreparation(inv.id);
    lab.importInventory(actor, { project_id: 'demo-lab', confirmed: true, resources: lab.inventory(actor, 'demo-lab').map(resource => ({ ...resource, balance: '5000', lots: [] })) });
    const before = lab.inventory(actor, 'demo-lab'), retry = job(inv.id, 'retry-changed-stock');
    expect(retry.plan?.experiment_id).toBe(failed.plan.experiment_id); expect(retry.plan?.id).not.toBe(failed.plan.id);
    expect(retry.plan).toMatchObject({ status: 'RESOURCE-SUFFICIENT', specimen_count: 8, fixed_controls: 2 });
    expect(lab.experiments(actor, 'demo-lab')).toHaveLength(1); expect(store.list('plans', 'demo-lab')).toHaveLength(2);
    expect(lab.inventory(actor, 'demo-lab')).toEqual(before); expect(store.list('consumption_events', 'demo-lab')).toHaveLength(0);
  });
  it.each(['new-evidence', 'new-design', 'completed-experiment'])('does not reuse a previous plan for %s', condition => {
    const inv = investigation(); evidence(inv.id); design(inv.id); const failed = failedAfterPreparation(inv.id);
    if (condition === 'new-evidence') evidence(inv.id);
    if (condition === 'new-design') design(inv.id);
    if (condition === 'completed-experiment') {
      const experiment = lab.continuity(actor, failed.plan.experiment_id).experiment;
      const completed = { ...experiment, status: 'completed' as const };
      store.put('experiments', completed);
    }
    const before = lab.inventory(actor, 'demo-lab'), retry = job(inv.id, 'different-scope-retry');
    expect(retry.plan?.experiment_id).not.toBe(failed.plan.experiment_id); expect(retry.plan?.id).not.toBe(failed.plan.id);
    expect(lab.experiments(actor, 'demo-lab')).toHaveLength(2); expect(lab.inventory(actor, 'demo-lab')).toEqual(before); expect(store.list('consumption_events', 'demo-lab')).toHaveLength(0);
  });
  it('additively upgrades a legacy preview cache without altering its stored plan', () => {
    const inv = investigation(); evidence(inv.id); design(inv.id); const failed = failedAfterPreparation(inv.id);
    store.db.exec('DROP TABLE research_materials; CREATE TABLE research_materials (run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, investigation_id TEXT NOT NULL, data TEXT NOT NULL)');
    store.db.prepare('INSERT INTO research_materials VALUES (?,?,?,?)').run(failed.run.id, 'demo-lab', inv.id, JSON.stringify(failed.plan));
    service = new ResearchService(store);
    expect(store.db.prepare('SELECT data FROM research_materials WHERE run_id=?').get(failed.run.id)?.data).toBe(JSON.stringify(failed.plan));
    expect(store.db.prepare('PRAGMA table_info(research_materials)').all().some(column => column.name === 'design_id')).toBe(true);
    // An old cache without design provenance is preserved but cannot authorise cross-run reuse.
    const retry = job(inv.id, 'legacy-retry'); expect(retry.plan?.id).not.toBe(failed.plan.id);
  });
  it('preserves investigation, source and scientific memory after reopening SQLite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'labrelax-research-')), path = join(dir, 'lab.sqlite'); let disk = new LabStore(path);
    try {
      let durable = new ResearchService(disk); const inv = durable.create(actor, { project_id: 'demo-lab', title: 'Persistent research', goal: 'Preserve evidence' });
      durable.importEvidence(actor, inv.id, { phase: 'initial', kind: 'synthetic_observation', filename: 'synthetic.csv', csv: csv(), protocol_version: '1.0' });
      const run = durable.beginRun(actor, inv.id, 'durable', 'scripted_walkthrough').run, analysis = durable.analyse(actor, inv.id, run.id, run.evidence_ids);
      durable.saveRecommendation(actor, inv.id, run.id, analysis.id); durable.completeRun(actor, inv.id, run.id, 'Done'); disk.close(); disk = new LabStore(path); durable = new ResearchService(disk);
      expect(durable.detail(actor, inv.id)).toMatchObject({ evidence: [{ original_content: csv() }], revisions: [{ revision: 1 }], proposals: [{ status: 'needs_design' }], runs: [{ status: 'completed' }] });
    } finally { disk.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
