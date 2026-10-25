import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Actor } from '../preflight/auth';
import type { ProtocolDraft, ProtocolRow } from '../../preflight/types';
import { LabStore } from '../preflight/store';
import { LabService } from '../preflight/service';
import { ResearchService } from './service';
import { executeResearchRun, startResearchRun, RESEARCH_TOOLS } from './agent';
const { settings } = vi.hoisted(() => ({ settings: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: settings }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('node:sqlite', async () => { const { createRequire } = await import('node:module'); return createRequire(import.meta.url)('node:sqlite'); });
const actor: Actor = { id: 'scientist', name: 'Scientist', role: 'researcher', nonce: 'nonce', expires: Number.MAX_SAFE_INTEGER, demo: true };
const names = ['read_evidence', 'analyse_results', 'inspect_design', 'check_materials', 'save_recommendation'];
const csv = (name = 'initial') => readFileSync(`static/research-companion/synthetic-${name}.csv`, 'utf8');
let callNumber = 0;
const call = (name: string, args: unknown = name === 'save_recommendation' ? { critique: 'Synthetic descriptive analysis cannot establish causality.' } : {}) => ({ type: 'function_call', name, call_id: `call-${++callNumber}`, arguments: JSON.stringify(args) });
const response = (name: string, args?: unknown) => Response.json({ status: 'completed', output: [call(name, args)] });

describe('bounded research coordinator using real persistence and tools', () => {
  let store: LabStore, service: ResearchService, lab: LabService, id: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv('LABRELAX_SEED_DEMO', 'true'); for (const key of Object.keys(settings)) delete settings[key]; callNumber = 0;
    store = new LabStore(':memory:'); lab = new LabService(store); service = new ResearchService(store);
    id = service.create(actor, { project_id: 'demo-lab', title: 'Order or sample?', goal: 'Understand the synthetic contrast.' }).id;
    service.importEvidence(actor, id, { phase: 'initial', kind: 'synthetic_observation', filename: 'synthetic-initial.csv', csv: csv(), protocol_version: '1.0' });
    fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { store.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  function design() {
    const parsed: Omit<ProtocolDraft, 'id' | 'project_id' | 'status' | 'created_at' | 'created_by'> = { protocol_id: 'synthetic', version: '1.0', title: 'Synthetic protocol', filename: 'synthetic.pdf', file_hash: 'sourcehash', supported_layout: true, extraction_method: 'supported-template', fixed_controls: 2, replicates_per_specimen: 1, overage_percent: '10', issues: [], source_text: 'Synthetic illustration', rows: [['buffer-a', '60'], ['indicator-b', '15'], ['wash-c', '100']].map(([resource_id, per_reaction], i): ProtocolRow => ({ id: `row-${i}`, resource_id, resource_name: resource_id, per_reaction, unit: 'uL', source_page: 1, source_row: i + 1, source_excerpt: `${resource_id} ${per_reaction} uL`, needs_review: false, issues: [] })) };
    const draft = lab.saveDraft(actor, 'demo-lab', parsed, new Uint8Array([1]));
    const protocol = lab.approve(actor, draft.id, { acknowledged: true, rows: draft.rows, fixed_controls: 2, replicates_per_specimen: 1, overage_percent: '10' });
    service.reviewDesign(actor, id, { protocol_id: protocol.id, acknowledged: true });
  }
  async function execute(mode: 'scripted_walkthrough' | 'live_agent' = 'live_agent', key = 'test-run') {
    const run = service.beginRun(actor, id, key, mode).run;
    await executeResearchRun(service, actor, id, run.id);
    return service.getRun(actor, id, run.id);
  }
  function successfulModel() { let index = 0; fetchMock.mockImplementation(async () => response(names[index++])); }
  function unchanged(before: unknown) {
    expect(lab.inventory(actor, 'demo-lab')).toEqual(before); expect(store.list('consumption_events', 'demo-lab')).toHaveLength(0); expect(store.list('confirmations', 'demo-lab')).toHaveLength(0);
  }
  it('no-key walkthrough invokes five real tools, labels its mode and never records actual use', async () => {
    design(); const before = lab.inventory(actor, 'demo-lab'); const run = await execute('scripted_walkthrough');
    expect(run).toMatchObject({ status: 'completed', mode: 'scripted_walkthrough' }); expect(run.steps.map(step => step.tool)).toEqual(names);
    const detail = service.detail(actor, id); expect(detail.analyses[0].output.classification).toBe('confounded'); expect(detail.proposals[0].material_plan?.specimen_count).toBe(8);
    expect(detail.proposals[0].rationale).toContain('scripted walkthrough'); expect(store.list('plans', 'demo-lab')).toHaveLength(1); expect(fetchMock).not.toHaveBeenCalled(); unchanged(before);
  });
  it('model-selected tools receive genuine previous outputs under finite private request settings', async () => {
    settings.OPENAI_API_KEY = 'test-key'; settings.OPENAI_RESEARCH_MODEL = 'test-research-model'; design(); successfulModel();
    const before = lab.inventory(actor, 'demo-lab'), run = await execute();
    expect(run.status).toBe('completed'); expect(fetchMock).toHaveBeenCalledTimes(5); expect(run.steps.map(step => step.tool)).toEqual(names);
    const requests = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body));
    for (const request of requests) expect(request).toMatchObject({ model: 'test-research-model', store: false, max_output_tokens: 1400, parallel_tool_calls: false, tool_choice: 'required' });
    expect(requests[0].tools).toEqual(RESEARCH_TOOLS); expect(requests[0].input).toHaveLength(1);
    const readOutput = requests[1].input.find((item: { type?: string }) => item.type === 'function_call_output');
    expect(JSON.parse(readOutput.output).evidence[0].content_hash).toBe(service.detail(actor, id).evidence[0].content_hash);
    const analysisOutputs = requests[2].input.filter((item: { type?: string }) => item.type === 'function_call_output');
    expect(JSON.parse(analysisOutputs.at(-1).output).output.classification).toBe('confounded');
    const materialOutputs = requests[4].input.filter((item: { type?: string }) => item.type === 'function_call_output');
    expect(JSON.parse(materialOutputs.at(-1).output)).toMatchObject({ specimen_count: 8, reactions: 10 });
    unchanged(before);
  });
  it('retains completed evidence and analysis steps when the provider becomes unavailable', async () => {
    settings.OPENAI_API_KEY = 'test-key'; let n = 0;
    fetchMock.mockImplementation(async () => ++n === 1 ? response('read_evidence') : n === 2 ? response('analyse_results') : new Response('unavailable', { status: 503 }));
    const before = lab.inventory(actor, 'demo-lab'), run = await execute();
    expect(run.status).toBe('failed'); expect(run.error).toContain('provider is unavailable'); expect(run.steps.map(step => step.tool)).toEqual(names.slice(0, 2));
    expect(service.detail(actor, id).analyses).toHaveLength(1); expect(service.detail(actor, id).proposals).toHaveLength(0); unchanged(before);
  });
  it('rejects actions outside the allowlist without granting stock, approvals or consumption access', async () => {
    settings.OPENAI_API_KEY = 'test-key'; fetchMock.mockResolvedValue(response('confirm_consumption', { confirmed: true }));
    const before = lab.inventory(actor, 'demo-lab'), run = await execute(); expect(run.status).toBe('failed'); expect(run.error).toContain('outside its research permissions');
    expect(run.steps).toHaveLength(0); expect(store.list('plans', 'demo-lab')).toHaveLength(0); unchanged(before);
  });
  it('rejects analysis before reading the frozen evidence snapshot', async () => {
    settings.OPENAI_API_KEY = 'test-key'; fetchMock.mockResolvedValue(response('analyse_results'));
    const run = await execute(); expect(run.status).toBe('failed'); expect(run.error).toContain('preceding research evidence'); expect(service.detail(actor, id).analyses).toHaveLength(0);
  });
  it.each([
    ['non-object arguments', () => ({ status: 'completed', output: [call('read_evidence', null)] })],
    ['unexpected argument keys', () => ({ status: 'completed', output: [call('read_evidence', { project_id: 'private-project' })] })],
    ['malformed argument JSON', () => ({ status: 'completed', output: [{ ...call('read_evidence'), arguments: '{bad' }] })],
    ['multiple simultaneous tools', () => ({ status: 'completed', output: [call('read_evidence'), call('analyse_results')] })],
    ['incomplete model response', () => ({ status: 'incomplete', output: [call('read_evidence')] })],
    ['missing function call', () => ({ status: 'completed', output: [{ type: 'message', content: 'I have completed everything.' }] })]
  ])('fails cleanly for %s rather than inventing a recommendation', async (_label, payload) => {
    settings.OPENAI_API_KEY = 'test-key'; fetchMock.mockResolvedValue(Response.json(payload()));
    const before = lab.inventory(actor, 'demo-lab'), run = await execute(); expect(run.status).toBe('failed'); expect(service.detail(actor, id).proposals).toHaveLength(0); unchanged(before);
  });
  it('bounds repeated model tool calls to seven turns and returns the prior output without duplicate steps', async () => {
    settings.OPENAI_API_KEY = 'test-key'; fetchMock.mockImplementation(async () => response('read_evidence'));
    const run = await execute(); expect(fetchMock).toHaveBeenCalledTimes(7); expect(run.status).toBe('failed'); expect(run.error).toContain('did not complete'); expect(run.steps).toHaveLength(1);
    expect(service.detail(actor, id).analyses).toHaveLength(0); expect(store.list('plans', 'demo-lab')).toHaveLength(0);
  });
  it('aborted requests persist live-agent failure and never switch to a fake offline success', async () => {
    settings.OPENAI_API_KEY = 'test-key'; fetchMock.mockRejectedValue(new DOMException('Request timed out', 'AbortError'));
    const run = await execute(); expect(run.mode).toBe('live_agent'); expect(run.status).toBe('failed'); expect(run.steps).toHaveLength(0); expect(service.detail(actor, id).proposals).toHaveLength(0);
  });
  it('enforces the total time budget before further tools can run', async () => {
    settings.OPENAI_API_KEY = 'test-key'; const run = service.beginRun(actor, id, 'timeout', 'live_agent').run, time = Date.now();
    vi.spyOn(Date, 'now').mockReturnValueOnce(time).mockReturnValue(time + 61000);
    await executeResearchRun(service, actor, id, run.id); vi.restoreAllMocks();
    expect(service.getRun(actor, id, run.id)).toMatchObject({ status: 'failed', steps: [] }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('starting an already completed idempotency key returns the existing job without executing tools again', async () => {
    design(); const completed = await execute('scripted_walkthrough', 'same-key'), before = lab.inventory(actor, 'demo-lab');
    const replay = startResearchRun(service, actor, id, 'same-key'); expect(replay).toMatchObject({ id: completed.id, status: 'completed' });
    await Promise.resolve(); expect(service.detail(actor, id).runs).toHaveLength(1); expect(store.list('plans', 'demo-lab')).toHaveLength(1); unchanged(before);
  });
  it('later evidence changes the recommendation through the same real tool loop without preparing another physical run', async () => {
    design(); await execute('scripted_walkthrough', 'initial-job'); const before = lab.inventory(actor, 'demo-lab');
    service.importEvidence(actor, id, { phase: 'followup', kind: 'synthetic_observation', filename: 'synthetic-followup.csv', csv: csv('followup'), protocol_version: '1.0' });
    const run = await execute('scripted_walkthrough', 'followup-job'), detail = service.detail(actor, id);
    expect(run.status).toBe('completed'); expect(detail.analyses.map(item => item.output.classification)).toEqual(['confounded', 'order_trend']);
    expect(detail.proposals.at(-1)).toMatchObject({ status: 'direction_only', material_plan: null, experiment_id: null, next_direction: 'Investigate the measurement-order trend before pursuing the sample effect.' });
    expect(run.steps.find(step => step.tool === 'check_materials')?.output).toMatchObject({ status: 'not_prepared' });
    expect(store.list('plans', 'demo-lab')).toHaveLength(1); unchanged(before);
  });
});
