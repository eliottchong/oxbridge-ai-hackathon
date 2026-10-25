import type { RunPlan } from '../preflight/types';

export type EvidenceKind = 'synthetic_observation' | 'imported_measurement' | 'simulation_output' | 'reviewed_note' | 'literature_excerpt';
export type ResultRow = { run_id: string; specimen_id: string; sample_group: string; measurement_order: number; signal: number; is_control: boolean; source_row: number };
export type DesignManifest = {
  id: string; title: string; protocol_id: string; protocol_version: string;
  specimen_count: number; fixed_controls: number; replicates_per_specimen: number;
  assignments: { specimen_id: string; sample_group: string; measurement_order: number; is_control: boolean }[];
  reviewed_by: string; reviewed_at: string; rationale: string;
};
export type Investigation = {
  id: string; project_id: string; title: string; goal: string;
  status: 'awaiting_evidence' | 'ready' | 'running' | 'awaiting_review' | 'awaiting_results' | 'updated' | 'failed';
  protocol_id: string | null; design: DesignManifest | null;
  created_by: string; created_at: string; updated_at: string;
};
export type ResearchEvidence = {
  id: string; project_id: string; investigation_id: string; phase: 'initial' | 'followup';
  kind: EvidenceKind; filename: string; content_hash: string; original_content: string;
  rows: ResultRow[]; note: string; protocol_version: string; experiment_id: string | null;
  imported_by: string; imported_at: string;
};
export type Support = 'unresolved' | 'weakened' | 'provisionally_supported';
export type AnalysisOutput = {
  row_count: number; specimen_count: number; control_count: number; groups: string[];
  group_means: { group: string; n: number; mean: number; order_min: number; order_max: number; order_mean: number }[];
  raw_group_contrast: number | null; adjusted_group_contrast: number | null;
  order_slope: number | null; order_correlation: number | null;
  rank_deficient: boolean; order_confounded: boolean; counterbalanced: boolean;
  classification: 'confounded' | 'order_trend' | 'sample_effect' | 'both_signals' | 'no_clear_signal' | 'insufficient';
  sample_support: Support; order_support: Support;
  summary: string; next_direction: string; limitations: string[];
  parameters: { relative_signal_threshold: number; absolute_tolerance: number };
};
export type ResearchAnalysis = {
  id: string; project_id: string; investigation_id: string; evidence_ids: string[];
  evidence_hashes: string[]; tool: string; tool_version: string; output: AnalysisOutput;
  created_at: string; created_by: string;
};
export type HypothesisRevision = {
  id: string; project_id: string; investigation_id: string; revision: number; analysis_id: string;
  evidence_ids: string[]; hypotheses: { id: 'sample-effect' | 'order-artefact'; title: string; support: Support; supporting_evidence_ids: string[]; contradicting_evidence_ids: string[]; reason: string }[];
  next_direction: string; reason_for_change: string; created_at: string;
};
export type ResearchProposal = {
  id: string; project_id: string; investigation_id: string; agent_run_id: string;
  analysis_id: string; hypothesis_revision_id: string; evidence_ids: string[]; design_id: string | null;
  title: string; rationale: string; distinguishes: string; next_direction: string;
  status: 'needs_design' | 'draft' | 'reviewed' | 'blocked' | 'awaiting_results' | 'direction_only';
  experiment_id: string | null; plan_id: string | null; material_plan: RunPlan | null;
  reviewed_by: string | null; reviewed_at: string | null; created_at: string;
  readiness_stale?: boolean;
};
export type AgentStep = { id: string; tool: string; label: string; status: 'completed' | 'failed'; input: unknown; output: unknown; started_at: string; completed_at: string };
export type AgentRun = {
  id: string; project_id: string; investigation_id: string; idempotency_key: string;
  mode: 'scripted_walkthrough' | 'live_agent'; status: 'running' | 'completed' | 'failed';
  evidence_ids: string[]; steps: AgentStep[]; summary: string | null; error: string | null;
  created_at: string; completed_at: string | null; created_by: string;
};
export type InvestigationDetail = {
  investigation: Investigation; evidence: ResearchEvidence[]; analyses: ResearchAnalysis[];
  revisions: HypothesisRevision[]; proposals: ResearchProposal[]; runs: AgentRun[];
};
