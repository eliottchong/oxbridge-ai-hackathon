import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Actor } from '../preflight/auth';
import { LabStore } from '../preflight/store';
import { PCRDemoService } from './service';
import { analysePCR, parsePCRCsv } from './analysis';
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('node:sqlite', async () => { const { createRequire } = await import('node:module'); return createRequire(import.meta.url)('node:sqlite'); });
const actor: Actor = { id: 'demo', name: 'Researcher', role: 'researcher', nonce: 'test', expires: Number.MAX_SAFE_INTEGER, demo: true };
const csv = (name = 'initial') => readFileSync(`static/pcr-demo/${name}.csv`, 'utf8');
const body = (name = 'initial') => ({ csv: csv(name), filename: `${name}.csv`, fictional: true });
describe('PCR presentation investigation', () => {
  let store: LabStore, service: PCRDemoService;
  beforeEach(() => { store = new LabStore(':memory:'); service = new PCRDemoService(store); });
  afterEach(() => store.close());
  const create = () => service.create(actor, { project_id: 'demo-lab', title: 'PCR investigation', question: 'What next?', ...body(), idempotency_key: 'initial' });
  const select = (id: string, option = 'specificity') => {
    const detail = service.analyse(actor, id);
    return service.select(actor, id, { option_id: option, round_id: detail.current_round.id, analysis_id: detail.current_round.analysis!.id, acknowledged: true });
  };
  it.each([
    ['initial', 72.83333333333333, 33.333333333333336, 'specificity'],
    ['specificity', 74, 7.833333333333333, 'independent-repeat'],
    ['consistency', 81.33333333333333, 30.5, 'specificity'],
    ['independent-repeat', 74, 31.666666666666668, 'specificity']
  ])('uses actual %s uploaded values to calculate and rank', (name, target, background, winner) => {
    const analysis = analysePCR(parsePCRCsv(csv(name as string)), 'round', 'hash');
    expect(analysis.metrics.target_mean).toBeCloseTo(target as number, 9); expect(analysis.metrics.background_mean).toBeCloseTo(background as number, 9); expect(analysis.options[0].id).toBe(winner);
    expect(analysis.options).toHaveLength(3); expect(analysis.steps.every(step => step.status === 'completed')).toBe(true);
  });
  it('uses specimen-only population CV and mean-background-to-mean-target ratio', () => {
    const analysis = analysePCR(parsePCRCsv(csv()), 'round', 'hash');
    expect(analysis.metrics.target_cv_percent).toBeCloseTo(20.524940176719383, 4);
    expect(analysis.metrics.background_ratio_percent).toBeCloseTo(45.766590389016025, 6);
  });
  it('retains exact evidence hash and source, replays creation and analysis without duplicates', () => {
    const detail = create(); expect(detail.current_round.csv).toBe(csv()); expect(detail.current_round.content_hash).toBe(createHash('sha256').update(csv()).digest('hex'));
    expect(detail.investigation.source_sha256).toBe(service.scenario(actor).source_sha256); expect(create()).toEqual(detail); expect(service.list(actor, 'demo-lab')).toHaveLength(1);
    expect(service.analyse(actor, detail.investigation.id)).toEqual(service.analyse(actor, detail.investigation.id));
    expect(() => service.create(actor, { project_id: 'demo-lab', title: 'different', question: 'What next?', ...body(), idempotency_key: 'initial' })).toThrow('different input');
  });
  it('supports successive selected experiments while retaining conclusions, links and no stock changes', () => {
    const before = store.list('inventory', 'demo-lab'), detail = create(), id = detail.investigation.id;
    const selected = select(id), selection = selected.current_round.selection!;
    expect(selection.evidence_hash).toBe(selected.current_round.content_hash);
    const results = { ...body('specificity'), selection_id: selection.id, idempotency_key: 'results-1' };
    const next = service.addResult(actor, id, results); expect(next.current_round.parent_selection_id).toBe(selection.id); expect(next.current_round.analysis).toBeNull();
    expect(service.addResult(actor, id, results)).toEqual(next);
    const analysis = service.analyse(actor, id); expect(analysis.current_round.analysis?.why_changed).toContain('leading direction changes'); expect(analysis.rounds[0].analysis?.options[0].id).toBe('specificity');
    const second = select(id, 'independent-repeat'); const final = service.addResult(actor, id, { ...body('independent-repeat'), selection_id: second.current_round.selection!.id });
    expect(service.analyse(actor, id).rounds).toHaveLength(3); expect(final.rounds[0].selection?.status).toBe('results_added');
    expect(store.list('inventory', 'demo-lab')).toEqual(before); expect(store.list('consumption_events', 'demo-lab')).toEqual([]); expect(store.list('experiments', 'demo-lab')).toEqual([]); expect(store.list('protocols', 'demo-lab')).toEqual([]);
  });
  it('rejects stale or unreviewed selections and results', () => {
    const detail = create(), id = detail.investigation.id;
    expect(() => service.select(actor, id, { option_id: 'specificity', acknowledged: true })).toThrow('Analyse');
    service.analyse(actor, id); expect(() => service.select(actor, id, { option_id: 'specificity', acknowledged: true })).toThrow('snapshot changed');
    const selected = select(id); const old = selected.current_round;
    service.addResult(actor, id, { ...body('specificity'), selection_id: old.selection!.id }); service.analyse(actor, id);
    expect(() => service.select(actor, id, { option_id: 'specificity', round_id: old.id, analysis_id: old.analysis!.id, acknowledged: true })).toThrow('snapshot changed');
    expect(() => service.addResult(actor, id, { ...body('consistency'), selection_id: old.selection!.id })).toThrow('current round');
    expect(service.detail(actor, id).rounds).toHaveLength(2);
  });
  it('scopes access and disallows unknown protocol source or unlabelled evidence', () => {
    const detail = create(); expect(() => service.detail({ ...actor, id: '' }, detail.investigation.id)).toThrow('Resource not found');
    expect(() => service.list(actor, 'other')).toThrow('Resource not found');
    expect(() => service.create(actor, { project_id: 'other', title: 'a', question: 'b', ...body() })).toThrow('Resource not found');
    expect(() => service.create(actor, { project_id: 'demo-lab', title: 'a', question: 'b', ...body(), source_sha256: 'wrong' })).toThrow('supplied');
    expect(() => service.create(actor, { project_id: 'demo-lab', title: 'a', question: 'b', ...body(), fictional: false })).toThrow('fictional');
  });
  it('responds to altered values rather than condition names or expected fixture conclusions', () => {
    const rows = parsePCRCsv(csv('specificity')); rows.find(row => row.control_type === 'negative')!.target_signal = 50;
    const analysis = analysePCR(rows, 'r', 'h'); expect(analysis.options[0].id).toBe('independent-repeat'); expect(analysis.headline).toContain('control');
    for (const row of rows.filter(row => row.control_type === 'none')) { row.target_signal = 0; row.background_signal = 0; }
    const empty = analysePCR(rows, 'r', 'h'); expect(empty.metrics.target_cv_percent).toBeNull(); expect(empty.metrics.background_ratio_percent).toBeNull(); expect(JSON.stringify(empty)).not.toContain('NaN');
  });
  it.each([csv().replace('target_signal', 'wrong'), csv().replace(',58,', ',-5,'), csv().split('\n').slice(0, 7).join('\n'), csv().replace('positive', 'none')])('rejects malformed evidence atomically', content => {
    expect(() => service.create(actor, { project_id: 'demo-lab', title: 'a', question: 'b', ...body(), csv: content })).toThrow(); expect(service.list(actor, 'demo-lab')).toHaveLength(0);
  });
  it('marks reused fictional evidence instead of claiming an independent replicate', () => {
    const initial = create(), id = initial.investigation.id;
    const chosen = select(id, 'independent-repeat');
    service.addResult(actor, id, { ...body(), selection_id: chosen.current_round.selection!.id });
    const result = service.analyse(actor, id).current_round.analysis!;
    expect(result.limitations[0]).toContain('not an independent replicate');
    expect(result.why_changed).toContain('repeats an earlier evidence hash');
  });
  it('persists investigation memory and idempotency across restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pcr-demo-')), path = join(directory, 'test.sqlite');
    const disk = new LabStore(path), first = new PCRDemoService(disk);
    const input = { project_id: 'demo-lab', title: 'PCR', question: 'What next?', ...body(), idempotency_key: 'restart' };
    const created = first.create(actor, input), expected = first.analyse(actor, created.investigation.id); disk.close();
    const reopened = new LabStore(path);
    try { const second = new PCRDemoService(reopened); expect(second.detail(actor, created.investigation.id)).toEqual(expected); expect(second.create(actor, input).investigation.id).toBe(created.investigation.id); expect(second.list(actor, 'demo-lab')).toHaveLength(1); } finally { reopened.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
