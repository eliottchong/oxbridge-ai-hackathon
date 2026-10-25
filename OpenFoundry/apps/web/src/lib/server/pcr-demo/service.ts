import { createHash, randomUUID } from 'node:crypto';
import type { PCRDemoDetail, PCRInvestigation, PCRRound, PCRScenario, PCRSelection } from '$lib/pcr-demo/types';
import { requireProject, type Actor } from '../preflight/auth';
import { ApiError, invalid, notFound } from '../preflight/errors';
import { LabStore } from '../preflight/store';
import { analysePCR, parsePCRCsv, THRESHOLDS } from './analysis';
const SOURCE_HASH = 'a5cda7064aba2db5449a195c8112779b4f8173593fc67c2d51096cf5f4c5feaf';
const now = () => new Date().toISOString();
const text = (value: unknown, label: string, max = 200): string => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(`${label} is required (maximum ${max} characters).`); return value.trim(); };
const conflict = (code: string, message: string) => new ApiError(409, code, message);
export class PCRDemoService {
  constructor(public store: LabStore) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS pcr_demo_investigations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pcr_demo_requests (project_id TEXT NOT NULL, actor_id TEXT NOT NULL, operation TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, investigation_id TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(project_id,actor_id,operation,request_key));`);
  }
  scenario(actor: Actor): PCRScenario {
    requireProject(actor, 'demo-lab');
    return { title: 'PCR: turn an uncertain result into the next research question', question: 'Which fictional follow-up should we explore to improve the interpretability of this PCR signal?', mode: 'fictional_scenario', source_filename: 'PCR_protocol.pdf', source_sha256: SOURCE_HASH, source_url: '/pcr-demo/PCR_protocol.pdf', initial_fixture_url: '/pcr-demo/initial.csv', notice: 'Fictional presentation scenario with real arithmetic. The source PDF is protocol context, not evidence of these results. No laboratory action is executed.', thresholds: THRESHOLDS, options: [ { id: 'specificity', title: 'Explore signal specificity', fixture_url: '/pcr-demo/specificity.csv' }, { id: 'consistency', title: 'Explore result consistency', fixture_url: '/pcr-demo/consistency.csv' }, { id: 'independent-repeat', title: 'Run an independent repeat', fixture_url: '/pcr-demo/independent-repeat.csv' } ] };
  }
  private investigation(actor: Actor, id: string): PCRInvestigation {
    const row = this.store.db.prepare('SELECT data FROM pcr_demo_investigations WHERE id=?').get(id) as { data: string } | undefined;
    if (!row) throw notFound(); const item = JSON.parse(row.data) as PCRInvestigation; requireProject(actor, item.project_id); return item;
  }
  list(actor: Actor, project: unknown): PCRInvestigation[] { requireProject(actor, project); return this.store.db.prepare('SELECT data FROM pcr_demo_investigations WHERE project_id=? ORDER BY rowid DESC').all(project).map(row => JSON.parse(row.data as string)); }
  detail(actor: Actor, id: string): PCRDemoDetail { return this.view(this.investigation(actor, id)); }
  private view(item: PCRInvestigation): PCRDemoDetail { return { investigation: item, rounds: item.rounds, current_round: item.rounds.at(-1)! }; }
  private save(item: PCRInvestigation): PCRDemoDetail { item.updated_at = now(); this.store.db.prepare('UPDATE pcr_demo_investigations SET data=? WHERE id=? AND project_id=?').run(JSON.stringify(item), item.id, item.project_id); return this.view(item); }
  private round(body: Record<string, unknown>, number: number, selectionId: string | null): PCRRound {
    if (body.fictional !== true) throw invalid('Acknowledge that these are fictional demonstration observations.');
    text(body.csv, 'CSV content', 65536);
    const csv = body.csv as string, filename = text(body.filename, 'CSV filename');
    if (!filename.toLowerCase().endsWith('.csv')) throw invalid('Use a CSV filename.');
    return { id: randomUUID(), number, parent_selection_id: selectionId, created_at: now(), filename, content_hash: createHash('sha256').update(csv).digest('hex'), csv, rows: parsePCRCsv(csv), analysis: null, selection: null };
  }
  private replay(actor: Actor, project: string, operation: string, body: Record<string, unknown>, fn: () => PCRDemoDetail): PCRDemoDetail {
    const key = body.idempotency_key === undefined ? null : text(body.idempotency_key, 'Idempotency key', 128);
    const hash = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'idempotency_key').sort(([a],[b]) => a.localeCompare(b))))).digest('hex');
    return this.store.transaction(() => {
      if (key) {
        const old = this.store.db.prepare('SELECT request_hash,response FROM pcr_demo_requests WHERE project_id=? AND actor_id=? AND operation=? AND request_key=?').get(project, actor.id, operation, key) as { request_hash: string; response: string } | undefined;
        if (old) { if (old.request_hash !== hash) throw conflict('IDEMPOTENCY_CONFLICT', 'This request key was used with different input.'); return JSON.parse(old.response); }
      }
      const result = fn();
      if (key) this.store.db.prepare('INSERT INTO pcr_demo_requests VALUES (?,?,?,?,?,?,?)').run(project, actor.id, operation, key, hash, result.investigation.id, JSON.stringify(result));
      return result;
    });
  }
  create(actor: Actor, body: Record<string, unknown>): PCRDemoDetail {
    requireProject(actor, body.project_id, true);
    if (body.source_sha256 !== undefined && body.source_sha256 !== SOURCE_HASH || body.source_filename !== undefined && body.source_filename !== 'PCR_protocol.pdf') throw invalid('This demonstration supports only the supplied PCR_protocol.pdf source.');
    return this.replay(actor, body.project_id, 'create', body, () => {
      const item: PCRInvestigation = { id: randomUUID(), project_id: body.project_id as string, title: text(body.title, 'Title'), question: text(body.question, 'Research question', 4000), mode: 'fictional_scenario', source_filename: 'PCR_protocol.pdf', source_sha256: SOURCE_HASH, created_at: now(), updated_at: now(), created_by: actor.id, rounds: [this.round(body, 1, null)] };
      this.store.db.prepare('INSERT INTO pcr_demo_investigations VALUES (?,?,?)').run(item.id, item.project_id, JSON.stringify(item)); return this.view(item);
    });
  }
  analyse(actor: Actor, id: string): PCRDemoDetail {
    this.investigation(actor, id);
    return this.store.transaction(() => {
      const item = this.investigation(actor, id), round = item.rounds.at(-1)!;
      if (!round.analysis) {
        round.analysis = analysePCR(round.rows, round.id, round.content_hash, item.rounds.at(-2)?.analysis ?? undefined);
        if (item.rounds.slice(0, -1).some(previous => previous.content_hash === round.content_hash)) {
          const notice = 'This observation file repeats an earlier evidence hash. Replaying fictional results is not an independent replicate or additional evidence.';
          round.analysis.limitations.unshift(notice);
          round.analysis.why_changed = `${notice} ${round.analysis.why_changed ?? ''}`.trim();
        }
        return this.save(item);
      }
      return this.view(item);
    });
  }
  select(actor: Actor, id: string, body: Record<string, unknown>): PCRDemoDetail {
    const scoped = this.investigation(actor, id);
    return this.replay(actor, scoped.project_id, `select:${id}`, body, () => {
      const item = this.investigation(actor, id), round = item.rounds.at(-1)!;
      if (!round.analysis) throw conflict('ANALYSIS_REQUIRED', 'Analyse this evidence before selecting a proposed experiment.');
      if (body.round_id !== round.id || body.analysis_id !== round.analysis.id) throw conflict('STALE_SELECTION', 'The evidence snapshot changed. Review the current analysis before selecting.');
      if (body.acknowledged !== true) throw invalid('Acknowledge that this selects a fictional experiment and does not execute laboratory work.');
      const option = round.analysis.options.find(option => option.id === body.option_id); if (!option) throw invalid('Choose one of the current experiment options.');
      if (round.selection) { if (round.selection.option_id === option.id) return this.view(item); throw conflict('SELECTION_EXISTS', 'This round already has a selected experiment. Create a fresh investigation to demonstrate another branch.'); }
      const selection: PCRSelection = { id: randomUUID(), option_id: option.id, title: option.title, round_id: round.id, analysis_id: round.analysis.id, evidence_hash: round.content_hash, selected_at: now(), selected_by: actor.id, status: 'selected' };
      round.selection = selection; return this.save(item);
    });
  }
  addResult(actor: Actor, id: string, body: Record<string, unknown>): PCRDemoDetail {
    const scoped = this.investigation(actor, id);
    return this.replay(actor, scoped.project_id, `results:${id}`, body, () => {
      const item = this.investigation(actor, id), round = item.rounds.at(-1)!;
      if (!round.selection || round.selection.id !== body.selection_id) throw conflict('STALE_SELECTION', 'Select an experiment in the current round and link the new results to that selection.');
      if (item.rounds.length >= 20) throw conflict('ROUND_LIMIT', 'This presentation investigation supports up to 20 rounds. Start a fresh investigation.');
      const next = this.round(body, round.number + 1, round.selection.id);
      round.selection.status = 'results_added'; item.rounds.push(next); return this.save(item);
    });
  }
}
