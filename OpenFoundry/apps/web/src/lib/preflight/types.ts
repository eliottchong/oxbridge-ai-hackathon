/** Shared browser/server contract. Decimal quantities are strings; never binary floats. */
export type Readiness = 'RESOURCE-SUFFICIENT' | 'SHORTAGE' | 'REVIEW-REQUIRED';
export type ProtocolRow = {
  id: string; resource_id: string | null; resource_name: string;
  per_reaction: string | null; unit: string | null;
  source_page: number; source_row: number; source_excerpt: string;
  needs_review: boolean; issues: string[];
};
export type ProtocolDraft = {
  id: string; project_id: string; protocol_id: string; version: string;
  title: string; file_hash: string; filename: string; supported_layout: boolean;
  extraction_method: 'supported-template' | 'openai';
  status: 'draft' | 'approved'; rows: ProtocolRow[];
  fixed_controls: number | null; replicates_per_specimen: number | null;
  overage_percent: string | null; issues: string[];
  source_text: string; created_at: string; created_by: string;
  reviewed_by?: string; reviewed_at?: string; approval_revision?: number;
  original_rows?: ProtocolRow[];
};
export type InventoryResource = {
  id: string; project_id: string; name: string; unit: 'uL';
  balance: string; reorder_threshold: string; revision: number;
  lots: { id: string; balance: string; expires: string | null }[];
};
export type PlanLine = {
  resource_id: string; resource_name: string; per_reaction: string; unit: 'uL';
  required: string; available: string; shortage: string; forecast_balance: string;
  reorder_threshold: string; conventional_low_stock: boolean;
  inventory_revision: number; source_page: number; source_excerpt: string;
  status: Readiness;
};
export type RunPlan = {
  id: string; project_id: string; experiment_id: string; protocol_id: string;
  protocol_version: string; approval_revision: number; specimen_count: number;
  replicates_per_specimen: number; fixed_controls: number; reactions: number;
  overage_percent: string; status: Readiness; issues: string[]; lines: PlanLine[];
  created_by: string; created_at: string; consumption_events_created: 0;
};
export type ActualLine = { resource_id: string; amount: string; unit: string; lot_id: string | null };
export type ConsumptionEvent = {
  id: string; project_id: string; experiment_id: string; plan_id: string;
  resource_id: string; resource_name: string; planned: string; actual: string;
  variance: string; unit: 'uL'; lot_id: string | null; issues: string[];
  actor_id: string; timestamp: string; justification: string;
};
export type Confirmation = {
  id: string; experiment_id: string; plan_id: string; actor_id: string;
  timestamp: string; events: ConsumptionEvent[]; replayed: boolean;
};
export type SessionInfo = {
  user: { id: string; name: string; role: string }; csrf_token: string;
  projects: { id: string; name: string; can_write: boolean }[];
  demo_mode: boolean;
};
