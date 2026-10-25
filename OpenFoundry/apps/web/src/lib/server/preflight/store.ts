import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { InventoryResource } from '$lib/preflight/types';

export class LabStore {
  db: DatabaseSync;
  constructor(path = process.env.LABRELAX_DB_PATH || resolve('.data/labrelax.sqlite')) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS protocols (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL, source BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, experiment_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS confirmations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, experiment_id TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(project_id, actor_id, idempotency_key));
      CREATE TABLE IF NOT EXISTS consumption_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, experiment_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inventory_generations (project_id TEXT PRIMARY KEY, generation INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO inventory_generations VALUES ('demo-lab', 1);
      CREATE TRIGGER IF NOT EXISTS immutable_event_update BEFORE UPDATE ON consumption_events BEGIN SELECT RAISE(ABORT, 'Append-only events'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_event_delete BEFORE DELETE ON consumption_events BEGIN SELECT RAISE(ABORT, 'Append-only events'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_confirmation_update BEFORE UPDATE ON confirmations BEGIN SELECT RAISE(ABORT, 'Append-only confirmations'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_confirmation_delete BEFORE DELETE ON confirmations BEGIN SELECT RAISE(ABORT, 'Append-only confirmations'); END;`);
    const seeded: InventoryResource[] = [
      { id: 'buffer-a', project_id: 'demo-lab', name: 'Buffer A', unit: 'uL', balance: '700', reorder_threshold: '100', revision: 1, lots: [{ id: 'BUF-001', balance: '700', expires: null }] },
      { id: 'indicator-b', project_id: 'demo-lab', name: 'Indicator B', unit: 'uL', balance: '150', reorder_threshold: '100', revision: 1, lots: [{ id: 'IND-001', balance: '150', expires: null }] },
      { id: 'wash-c', project_id: 'demo-lab', name: 'Wash C', unit: 'uL', balance: '2000', reorder_threshold: '200', revision: 1, lots: [{ id: 'WASH-001', balance: '2000', expires: null }] }
    ];
    const insert = this.db.prepare('INSERT OR IGNORE INTO inventory (id, project_id, data) VALUES (?, ?, ?)');
    this.transaction(() => {
      if (!this.db.prepare("SELECT value FROM app_metadata WHERE key='baseline_initialised'").get()) {
        if (process.env.LABRELAX_SEED_DEMO !== 'false') for (const row of seeded) insert.run(row.id, row.project_id, JSON.stringify(row));
        this.db.prepare("INSERT INTO app_metadata VALUES ('baseline_initialised', 'true')").run();
      }
    });
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get<T>(table: 'inventory' | 'protocols' | 'experiments' | 'plans', id: string): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as T : undefined;
  }
  list<T>(table: 'inventory' | 'protocols' | 'experiments' | 'plans' | 'confirmations' | 'consumption_events', projectId: string, experimentId?: string): T[] {
    const rows = experimentId
      ? this.db.prepare(`SELECT data FROM ${table} WHERE project_id = ? AND experiment_id = ? ORDER BY rowid`).all(projectId, experimentId)
      : this.db.prepare(`SELECT data FROM ${table} WHERE project_id = ? ORDER BY rowid`).all(projectId);
    return rows.map(row => JSON.parse(row.data as string) as T);
  }
  put(table: 'inventory' | 'experiments' | 'plans', value: { id: string; project_id: string; experiment_id?: string }) {
    if (table === 'plans') this.db.prepare('INSERT INTO plans (id, project_id, experiment_id, data) VALUES (?, ?, ?, ?)').run(value.id, value.project_id, value.experiment_id!, JSON.stringify(value));
    else this.db.prepare(`INSERT INTO ${table} (id, project_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(value.id, value.project_id, JSON.stringify(value));
  }
  close() { this.db.close(); }
}
let singleton: LabStore | undefined;
export const getStore = () => singleton ??= new LabStore();
