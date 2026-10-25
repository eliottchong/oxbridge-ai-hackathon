import type { LabStore } from '../preflight/store';
/** Additive migration: existing inventory and append-only consumption are preserved. */
export function migrateResearch(store: LabStore) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS investigations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research_evidence (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, investigation_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research_analyses (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, investigation_id TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hypothesis_revisions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, investigation_id TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research_proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, investigation_id TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, investigation_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(project_id,investigation_id,idempotency_key));
    CREATE TABLE IF NOT EXISTS research_materials (run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, investigation_id TEXT NOT NULL, data TEXT NOT NULL, design_id TEXT);
    CREATE INDEX IF NOT EXISTS research_evidence_scope ON research_evidence(project_id,investigation_id);
    CREATE INDEX IF NOT EXISTS research_proposal_scope ON research_proposals(project_id,investigation_id);
  `);
  // Older research databases have cached plans without a design snapshot.
  const columns = store.db.prepare('PRAGMA table_info(research_materials)').all();
  if (!columns.some(column => column.name === 'design_id')) store.db.exec('ALTER TABLE research_materials ADD COLUMN design_id TEXT');
}
