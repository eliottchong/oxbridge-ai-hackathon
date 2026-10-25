import { createHash, randomUUID } from 'node:crypto';
import type { AgentRun, AgentStep, DesignManifest, HypothesisRevision, Investigation, InvestigationDetail, ResearchAnalysis, ResearchEvidence, ResearchProposal } from '$lib/research/types';
import type { RunPlan } from '$lib/preflight/types';
import { requireProject, type Actor } from '../preflight/auth';
import { ApiError, invalid, notFound } from '../preflight/errors';
import { LabService } from '../preflight/service';
import { LabStore } from '../preflight/store';
import { analyseResults, parseResultsCsv, suggestedCounterbalancedAssignments, validateFollowupAgainstDesign } from './analysis';
import { migrateResearch } from './migration';

const now = () => new Date().toISOString();
const text = (value: unknown, label: string, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(`${label} is required (maximum ${max} characters).`);
  return value.trim();
};
type Scoped = { id: string; project_id: string; investigation_id: string };
type Table = 'investigations' | 'research_evidence' | 'research_analyses' | 'hypothesis_revisions' | 'research_proposals' | 'agent_runs';
const conflict = (code: string, message: string) => new ApiError(409, code, message);

export class ResearchService {
  readonly lab: LabService;
  constructor(public store: LabStore) { migrateResearch(store); this.lab = new LabService(store); }
  private get<T>(table: Table, id: string): T | undefined {
    const row = this.store.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  private all<T>(table: Table, project: string, investigation?: string): T[] {
    const rows = investigation
      ? this.store.db.prepare(`SELECT data FROM ${table} WHERE project_id=? AND investigation_id=? ORDER BY rowid`).all(project, investigation)
      : this.store.db.prepare(`SELECT data FROM ${table} WHERE project_id=? ORDER BY rowid`).all(project);
    return rows.map(row => JSON.parse(row.data as string));
  }
  private save<T extends { id: string; project_id: string }>(table: Table, item: T) {
    this.store.db.prepare(`UPDATE ${table} SET data=? WHERE id=? AND project_id=?`).run(JSON.stringify(item), item.id, item.project_id);
    return item;
  }
  private append(table: Exclude<Table, 'investigations' | 'agent_runs'>, item: Scoped, runId?: string) {
    const columns = runId ? '(id,project_id,investigation_id,run_id,data)' : '(id,project_id,investigation_id,data)';
    const values = runId ? [item.id, item.project_id, item.investigation_id, runId, JSON.stringify(item)] : [item.id, item.project_id, item.investigation_id, JSON.stringify(item)];
    this.store.db.prepare(`INSERT INTO ${table} ${columns} VALUES (${values.map(() => '?').join(',')})`).run(...values);
  }
  private investigation(actor: Actor, id: string): Investigation {
    const item = this.get<Investigation>('investigations', id);
    if (!item) throw notFound();
    requireProject(actor, item.project_id);
    return this.recoverInterrupted(item);
  }
  private recoverInterrupted(investigation: Investigation): Investigation {
    const expired = this.all<AgentRun>('agent_runs', investigation.project_id, investigation.id).filter(run => run.status === 'running' && Date.now() - Date.parse(run.created_at) > 70000);
    if (!expired.length) return investigation;
    for (const run of expired) this.save('agent_runs', { ...run, status: 'failed', error: 'Investigation interrupted or exceeded its time limit. Completed tool outputs were preserved; start a new job to continue.', completed_at: now() });
    return this.setStatus(investigation, 'failed');
  }
  private linked<T extends Scoped>(actor: Actor, id: string, table: Exclude<Table, 'investigations'>, itemId: string): T {
    const investigation = this.investigation(actor, id);
    const item = this.get<T>(table, itemId);
    if (!item || item.project_id !== investigation.project_id || item.investigation_id !== id) throw notFound();
    return item;
  }
  private setStatus(investigation: Investigation, status: Investigation['status']) {
    const value = { ...investigation, status, updated_at: now() };
    this.save('investigations', value); return value;
  }
  create(actor: Actor, body: Record<string, unknown>): Investigation {
    requireProject(actor, body.project_id, true);
    let protocolId: string | null = null;
    if (body.protocol_id) {
      const protocol = this.lab.protocol(actor, text(body.protocol_id, 'Protocol ID'));
      if (protocol.project_id !== body.project_id) throw notFound(); protocolId = protocol.id;
    }
    const item: Investigation = { id: randomUUID(), project_id: body.project_id, title: text(body.title, 'Investigation title'), goal: text(body.goal, 'Research goal', 4000), status: 'awaiting_evidence', protocol_id: protocolId, design: null, created_by: actor.id, created_at: now(), updated_at: now() };
    this.store.db.prepare('INSERT INTO investigations VALUES (?,?,?)').run(item.id, item.project_id, JSON.stringify(item));
    return item;
  }
  list(actor: Actor, projectId: unknown): Investigation[] { requireProject(actor, projectId); return this.all('investigations', projectId); }
  private stale(actor: Actor, proposal: ResearchProposal) {
    if (!proposal.material_plan) return false;
    const stock = this.lab.inventory(actor, proposal.project_id);
    const protocol = this.lab.protocol(actor, proposal.material_plan.protocol_id);
    return proposal.material_plan.approval_revision !== protocol.approval_revision || proposal.material_plan.lines.some(line => stock.find(resource => resource.id === line.resource_id)?.revision !== line.inventory_revision);
  }
  detail(actor: Actor, id: string): InvestigationDetail {
    const investigation = this.investigation(actor, id), p = investigation.project_id;
    return { investigation, evidence: this.all('research_evidence', p, id), analyses: this.all('research_analyses', p, id), revisions: this.all('hypothesis_revisions', p, id), runs: this.all('agent_runs', p, id), proposals: this.all<ResearchProposal>('research_proposals', p, id).map(proposal => ({ ...proposal, readiness_stale: this.stale(actor, proposal) })) };
  }
  importEvidence(actor: Actor, id: string, body: Record<string, unknown>): ResearchEvidence {
    const investigation = this.investigation(actor, id);
    if (this.all<AgentRun>('agent_runs', investigation.project_id, id).some(run => run.status === 'running')) throw conflict('RUN_IN_PROGRESS', 'Wait for the current investigation run before adding evidence.');
    if (body.phase !== 'initial' && body.phase !== 'followup') throw invalid('Evidence phase must be initial or followup.');
    const kinds = ['synthetic_observation', 'imported_measurement', 'simulation_output', 'reviewed_note', 'literature_excerpt'];
    if (!kinds.includes(body.kind as string)) throw invalid('Choose an explicit evidence source type.');
    text(body.csv, 'CSV content', 65536);
    const csv = body.csv as string;
    let rows: ResearchEvidence['rows'];
    try { rows = parseResultsCsv(csv); } catch (error) { throw invalid(error instanceof Error ? error.message : 'Invalid results CSV.'); }
    if (rows.filter(row => !row.is_control).length !== 8 || rows.filter(row => row.is_control).length !== 2) throw invalid('This investigation requires all eight specimens and two controls.');
    const groups = [...new Set(rows.filter(row => !row.is_control).map(row => row.sample_group))];
    if (groups.length !== 2 || groups.some(group => rows.filter(row => !row.is_control && row.sample_group === group).length !== 4)) throw invalid('Supply two specimen groups with four specimens each.');
    if (groups.some(group => group !== 'A' && group !== 'B') || rows.some(row => row.is_control && row.sample_group !== 'CONTROL')) throw invalid('This supported design uses specimen groups A and B and the control label CONTROL. Review the group mapping before import.');
    const version = text(body.protocol_version, 'Protocol version', 80);
    if (investigation.protocol_id && this.lab.protocol(actor, investigation.protocol_id).version !== version) throw invalid('Evidence protocol version must match the investigation protocol.');
    if (body.phase === 'followup') {
      if (!investigation.design) throw conflict('DESIGN_REVIEW_REQUIRED', 'Review the complete follow-up design before importing its results.');
      try { validateFollowupAgainstDesign(rows, investigation.design); } catch (error) { throw invalid(error instanceof Error ? error.message : 'Results do not match the reviewed design.'); }
    }
    let experimentId: string | null = null;
    if (body.experiment_id) {
      const experiment = this.lab.continuity(actor, text(body.experiment_id, 'Experiment ID')).experiment;
      if (experiment.project_id !== investigation.project_id) throw notFound();
      // An existing experiment must actually belong to this investigation's proposal.
      if (!this.all<ResearchProposal>('research_proposals', investigation.project_id, id).some(proposal => proposal.experiment_id === experiment.id)) throw notFound();
      experimentId = experiment.id;
    }
    const item: ResearchEvidence = { id: randomUUID(), project_id: investigation.project_id, investigation_id: id, phase: body.phase, kind: body.kind as ResearchEvidence['kind'], filename: text(body.filename, 'Filename'), content_hash: createHash('sha256').update(csv).digest('hex'), original_content: csv, rows, note: typeof body.note === 'string' ? body.note.slice(0, 4000) : '', protocol_version: version, experiment_id: experimentId, imported_by: actor.id, imported_at: now() };
    this.append('research_evidence', item); this.setStatus(investigation, 'ready'); return item;
  }
  reviewDesign(actor: Actor, id: string, body: Record<string, unknown>): DesignManifest {
    const investigation = this.investigation(actor, id);
    if (this.all<AgentRun>('agent_runs', investigation.project_id, id).some(run => run.status === 'running')) throw conflict('RUN_IN_PROGRESS', 'Wait for the current investigation run before reviewing the design.');
    if (body.acknowledged !== true) throw invalid('Explicitly acknowledge the full scientific design.');
    const protocol = this.lab.protocol(actor, text(body.protocol_id, 'Protocol ID'));
    if (protocol.project_id !== investigation.project_id) throw notFound();
    if (protocol.status !== 'approved') throw conflict('PROTOCOL_NOT_APPROVED', 'Review and approve the protocol before reviewing this design.');
    if (protocol.fixed_controls !== 2 || protocol.replicates_per_specimen !== 1) throw invalid('This supported investigation requires the complete eight-specimen, two-control, one-replicate design.');
    const expected = suggestedCounterbalancedAssignments();
    const assignments = body.assignments === undefined ? expected : body.assignments;
    if (JSON.stringify(assignments) !== JSON.stringify(expected)) throw invalid('Only the complete supported counterbalanced assignment is available in this build.');
    if (investigation.design?.protocol_id === protocol.id) return investigation.design;
    const manifest: DesignManifest = { id: randomUUID(), title: 'Counterbalanced eight-specimen follow-up', protocol_id: protocol.id, protocol_version: protocol.version, specimen_count: 8, fixed_controls: 2, replicates_per_specimen: 1, assignments: expected, reviewed_by: actor.id, reviewed_at: now(), rationale: typeof body.rationale === 'string' ? body.rationale.slice(0, 4000) : 'Compare sample-associated signal with measurement-order trend using balanced groups.' };
    this.save('investigations', { ...investigation, protocol_id: protocol.id, design: manifest, updated_at: now() }); return manifest;
  }
  beginRun(actor: Actor, id: string, key: unknown, mode: AgentRun['mode']): { run: AgentRun; replayed: boolean } {
    const investigation = this.investigation(actor, id), idempotency = text(key, 'Run idempotency key', 128);
    const previous = this.all<AgentRun>('agent_runs', investigation.project_id, id).find(run => run.idempotency_key === idempotency);
    if (previous) return { run: previous, replayed: true };
    if (mode !== 'live_agent' && mode !== 'scripted_walkthrough') throw invalid('Invalid agent mode.');
    if (this.all<AgentRun>('agent_runs', investigation.project_id, id).some(run => run.status === 'running')) throw conflict('RUN_IN_PROGRESS', 'An investigation job is already running.');
    const evidence = this.all<ResearchEvidence>('research_evidence', investigation.project_id, id);
    if (!evidence.length) throw invalid('Import result evidence before starting the investigation.');
    const phase = evidence.some(item => item.phase === 'followup') ? 'followup' : 'initial';
    const item: AgentRun = { id: randomUUID(), project_id: investigation.project_id, investigation_id: id, idempotency_key: idempotency, mode, status: 'running', evidence_ids: [evidence.filter(item => item.phase === phase).at(-1)!.id], steps: [], summary: null, error: null, created_by: actor.id, created_at: now(), completed_at: null };
    this.store.db.prepare('INSERT INTO agent_runs VALUES (?,?,?,?,?)').run(item.id, item.project_id, id, idempotency, JSON.stringify(item)); this.setStatus(investigation, 'running'); return { run: item, replayed: false };
  }
  getRun(actor: Actor, id: string, runId: string): AgentRun { return this.linked(actor, id, 'agent_runs', runId); }
  recordStep(actor: Actor, id: string, runId: string, step: AgentStep): AgentRun {
    const run = this.getRun(actor, id, runId);
    if (run.steps.some(item => item.id === step.id)) return run;
    if (run.status !== 'running') throw conflict('RUN_FINISHED', 'This investigation job has finished.');
    if (run.steps.length >= 12) throw conflict('STEP_LIMIT', 'The bounded tool-step limit was reached.');
    const value = { ...run, steps: [...run.steps, step] }; this.save('agent_runs', value); return value;
  }
  completeRun(actor: Actor, id: string, runId: string, summary: string): AgentRun {
    const run = this.getRun(actor, id, runId);
    if (run.status !== 'running') return run;
    const value: AgentRun = { ...run, status: 'completed', summary: summary.slice(0, 8000), completed_at: now() };
    this.save('agent_runs', value);
    const proposal = this.all<ResearchProposal>('research_proposals', run.project_id, id).find(item => item.agent_run_id === runId);
    this.setStatus(this.investigation(actor, id), proposal?.status === 'direction_only' ? 'updated' : 'awaiting_review'); return value;
  }
  failRun(actor: Actor, id: string, runId: string, error: string): AgentRun {
    const run = this.getRun(actor, id, runId); if (run.status !== 'running') return run;
    const value: AgentRun = { ...run, status: 'failed', error: error.slice(0, 2000), completed_at: now() }; this.save('agent_runs', value); this.setStatus(this.investigation(actor, id), 'failed'); return value;
  }
  readEvidence(actor: Actor, id: string, evidenceIds: string[]): ResearchEvidence[] {
    if (!Array.isArray(evidenceIds) || !evidenceIds.length || evidenceIds.length > 20 || new Set(evidenceIds).size !== evidenceIds.length) throw invalid('Select 1–20 unique evidence records.');
    return evidenceIds.map(evidenceId => this.linked(actor, id, 'research_evidence', evidenceId));
  }
  analyse(actor: Actor, id: string, runId: string, evidenceIds: string[]): ResearchAnalysis {
    const run = this.getRun(actor, id, runId);
    const previous = this.all<ResearchAnalysis>('research_analyses', run.project_id, id).find(item => this.store.db.prepare('SELECT id FROM research_analyses WHERE id=? AND run_id=?').get(item.id, runId));
    if (previous) return previous;
    if (run.status !== 'running') throw conflict('RUN_FINISHED', 'This investigation job has finished.');
    if (JSON.stringify([...evidenceIds].sort()) !== JSON.stringify([...run.evidence_ids].sort())) throw invalid('Analyse the complete evidence snapshot for this run.');
    const evidence = this.readEvidence(actor, id, evidenceIds);
    // Separate result files are analysed as distinct runs, never silently pooled as independent observations.
    const latest = evidence[evidence.length - 1];
    const output = analyseResults(latest.rows);
    if (evidence.length > 1) output.limitations.push('Multiple files are present in this phase; the most recently imported file is analysed and earlier files remain contextual evidence.');
    const value: ResearchAnalysis = { id: randomUUID(), project_id: run.project_id, investigation_id: id, evidence_ids: evidence.map(item => item.id), evidence_hashes: evidence.map(item => item.content_hash), tool: 'bounded-group-order-analysis', tool_version: '1.0', output, created_at: now(), created_by: actor.id };
    this.append('research_analyses', value, runId); return value;
  }
  inspectDesign(actor: Actor, id: string) {
    const investigation = this.investigation(actor, id);
    return { design: investigation.design, protocol: investigation.protocol_id ? this.lab.protocol(actor, investigation.protocol_id) : null, required_specimen_count: 8, required_controls: 2, required_replicates: 1, explanation: 'Only the complete reviewed follow-up can receive physical experiment readiness.' };
  }
  prepareMaterials(actor: Actor, id: string, runId: string, analysisId: string): RunPlan | null {
    const run = this.getRun(actor, id, runId), analysis = this.linked<ResearchAnalysis>(actor, id, 'research_analyses', analysisId);
    this.assertAnalysisRun(analysis.id, run.id);
    const evidence = this.readEvidence(actor, id, analysis.evidence_ids);
    this.assertCurrentEvidence(actor, id, analysis.evidence_ids);
    if (evidence.some(item => item.phase === 'followup')) return null;
    const investigation = this.investigation(actor, id);
    if (!investigation.design) return null;
    const design = investigation.design;
    const previous = this.store.db.prepare('SELECT data,design_id FROM research_materials WHERE run_id=? AND project_id=? AND investigation_id=?').get(runId, run.project_id, id) as { data: string; design_id: string | null } | undefined;
    if (previous) {
      if (previous.design_id !== design.id) throw conflict('DESIGN_CHANGED', 'The reviewed design changed. Start a new investigation job for the current design.');
      return JSON.parse(previous.data);
    }
    if (run.status !== 'running') throw conflict('RUN_FINISHED', 'This investigation job has finished.');
    const protocol = this.lab.protocol(actor, design.protocol_id);
    if (protocol.status !== 'approved') throw conflict('PROTOCOL_NOT_APPROVED', 'Review the linked protocol before preparing materials.');
    const stock = this.lab.inventory(actor, run.project_id);
    const candidates = this.store.db.prepare(`SELECT materials.data, jobs.data AS run_data FROM research_materials AS materials
      JOIN agent_runs AS jobs ON jobs.id=materials.run_id AND jobs.project_id=materials.project_id AND jobs.investigation_id=materials.investigation_id
      WHERE materials.project_id=? AND materials.investigation_id=? AND materials.design_id=? ORDER BY materials.rowid DESC`).all(run.project_id, id, design.id);
    let reused: RunPlan | null = null, experimentId: string | undefined;
    for (const candidate of candidates) {
      const priorRun = JSON.parse(candidate.run_data as string) as AgentRun;
      if (JSON.stringify([...priorRun.evidence_ids].sort()) !== JSON.stringify([...run.evidence_ids].sort())) continue;
      const plan = JSON.parse(candidate.data as string) as RunPlan;
      if (plan.project_id !== run.project_id || plan.protocol_id !== design.protocol_id || plan.protocol_version !== design.protocol_version || plan.specimen_count !== 8 || plan.fixed_controls !== 2 || plan.replicates_per_specimen !== 1) continue;
      const experiment = this.store.get<{ project_id: string; status: string }>('experiments', plan.experiment_id);
      if (!experiment || experiment.project_id !== run.project_id || experiment.status !== 'planned') continue;
      experimentId = plan.experiment_id;
      if (plan.approval_revision === protocol.approval_revision && plan.lines.every(line => stock.find(resource => resource.id === line.resource_id)?.revision === line.inventory_revision)) reused = plan;
      break;
    }
    // Retry preserves a physical experiment's identity; stock changes create a new preview snapshot only.
    const plan = reused ?? this.lab.preview(actor, { project_id: run.project_id, protocol_id: design.protocol_id, specimen_count: design.specimen_count, ...(experimentId ? { experiment_id: experimentId } : {}), experiment_name: 'Reviewed counterbalanced follow-up' });
    this.store.db.prepare('INSERT INTO research_materials (run_id,project_id,investigation_id,data,design_id) VALUES (?,?,?,?,?)').run(runId, run.project_id, id, JSON.stringify(plan), design.id); return plan;
  }
  private assertAnalysisRun(analysisId: string, runId: string) {
    if (!this.store.db.prepare('SELECT id FROM research_analyses WHERE id=? AND run_id=?').get(analysisId, runId)) throw notFound();
  }
  private assertCurrentEvidence(actor: Actor, id: string, ids: string[]) {
    const investigation = this.investigation(actor, id), evidence = this.all<ResearchEvidence>('research_evidence', investigation.project_id, id);
    const phase = evidence.some(item => item.phase === 'followup') ? 'followup' : 'initial';
    const current = [evidence.filter(item => item.phase === phase).at(-1)!.id];
    if (JSON.stringify(current) !== JSON.stringify([...ids].sort())) throw conflict('STALE_EVIDENCE', 'New results changed this investigation. Analyse the current evidence before reviewing a proposal.');
  }
  saveRecommendation(actor: Actor, id: string, runId: string, analysisId: string, materialPlan?: RunPlan | null, critique?: string): ResearchProposal {
    const run = this.getRun(actor, id, runId);
    const previous = this.all<ResearchProposal>('research_proposals', run.project_id, id).find(item => item.agent_run_id === runId); if (previous) return previous;
    if (run.status !== 'running') throw conflict('RUN_FINISHED', 'This investigation job has finished.');
    const analysis = this.linked<ResearchAnalysis>(actor, id, 'research_analyses', analysisId); this.assertAnalysisRun(analysis.id, run.id); this.assertCurrentEvidence(actor, id, analysis.evidence_ids);
    const investigation = this.investigation(actor, id), evidence = this.readEvidence(actor, id, analysis.evidence_ids), followup = evidence.some(item => item.phase === 'followup');
    let plan: RunPlan | null = null;
    if (materialPlan) {
      const stored = this.store.db.prepare('SELECT data FROM research_materials WHERE run_id=? AND project_id=? AND investigation_id=?').get(runId, run.project_id, id) as { data: string } | undefined;
      if (!stored || (JSON.parse(stored.data) as RunPlan).id !== materialPlan.id || followup) throw notFound();
      plan = JSON.parse(stored.data);
    }
    const previousRevisions = this.all<HypothesisRevision>('hypothesis_revisions', run.project_id, id), latest = previousRevisions.at(-1);
    const reason = latest ? `Previous conclusion: ${latest.next_direction} New analysis: ${analysis.output.summary}` : analysis.output.summary;
    const revision: HypothesisRevision = { id: randomUUID(), project_id: run.project_id, investigation_id: id, revision: previousRevisions.length + 1, analysis_id: analysis.id, evidence_ids: analysis.evidence_ids, hypotheses: [
      { id: 'sample-effect', title: 'A sample-associated effect', support: analysis.output.sample_support, supporting_evidence_ids: analysis.output.sample_support === 'provisionally_supported' ? analysis.evidence_ids : [], contradicting_evidence_ids: analysis.output.sample_support === 'weakened' ? analysis.evidence_ids : [], reason: analysis.output.summary },
      { id: 'order-artefact', title: 'A measurement-order-associated artefact', support: analysis.output.order_support, supporting_evidence_ids: analysis.output.order_support === 'provisionally_supported' ? analysis.evidence_ids : [], contradicting_evidence_ids: analysis.output.order_support === 'weakened' ? analysis.evidence_ids : [], reason: analysis.output.summary }
    ], next_direction: analysis.output.next_direction, reason_for_change: reason, created_at: now() };
    const value: ResearchProposal = { id: randomUUID(), project_id: run.project_id, investigation_id: id, agent_run_id: runId, analysis_id: analysis.id, hypothesis_revision_id: revision.id, evidence_ids: analysis.evidence_ids, design_id: investigation.design?.id ?? null, title: followup ? 'Updated research direction' : 'Counterbalanced follow-up', rationale: `${analysis.output.summary}${critique ? ` Review caveat: ${critique.slice(0, 2000)}` : ''}`, distinguishes: 'Separate sample-associated differences from measurement-order associations using the complete reviewed design.', next_direction: analysis.output.next_direction, status: followup ? 'direction_only' : !investigation.design ? 'needs_design' : plan?.status === 'SHORTAGE' ? 'blocked' : 'draft', experiment_id: plan?.experiment_id ?? null, plan_id: plan?.id ?? null, material_plan: plan, reviewed_by: null, reviewed_at: null, created_at: now() };
    this.store.transaction(() => { this.append('hypothesis_revisions', revision, runId); this.append('research_proposals', value, runId); }); return value;
  }
  reviewProposal(actor: Actor, id: string, proposalId: string, body: Record<string, unknown>): ResearchProposal {
    const proposal = this.linked<ResearchProposal>(actor, id, 'research_proposals', proposalId), investigation = this.investigation(actor, id);
    if (body.acknowledged !== true) throw invalid('Explicitly acknowledge scientific proposal review.');
    this.assertCurrentEvidence(actor, id, proposal.evidence_ids);
    if (proposal.status === 'direction_only') throw conflict('DIRECTION_ONLY', 'This research direction needs a new reviewed design; it is not a ready physical experiment.');
    if (!investigation.design || proposal.design_id !== investigation.design.id) throw conflict('DESIGN_REVIEW_REQUIRED', 'Review the current complete design and rerun the investigation.');
    const protocol = this.lab.protocol(actor, investigation.design.protocol_id);
    if (protocol.status !== 'approved') throw conflict('PROTOCOL_NOT_APPROVED', 'Review the linked protocol first.');
    let plan = proposal.material_plan;
    if (!plan || this.stale(actor, proposal)) plan = this.lab.preview(actor, { project_id: investigation.project_id, protocol_id: protocol.id, specimen_count: 8, ...(proposal.experiment_id ? { experiment_id: proposal.experiment_id } : {}), experiment_name: 'Reviewed counterbalanced follow-up' });
    const value: ResearchProposal = { ...proposal, status: plan.status === 'RESOURCE-SUFFICIENT' ? 'awaiting_results' : 'blocked', plan_id: plan.id, experiment_id: plan.experiment_id, material_plan: plan, reviewed_by: actor.id, reviewed_at: now(), readiness_stale: false };
    this.save('research_proposals', value); this.setStatus(investigation, value.status === 'awaiting_results' ? 'awaiting_results' : 'awaiting_review'); return value;
  }
}
