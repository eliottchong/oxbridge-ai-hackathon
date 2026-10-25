# LabRelax research-loop implementation

Implements the user-approved `LABRELAX_RESEARCH_LOOP_HANDOFF.md`. This extends the existing transactional preflight; the data owner's SOP/inventory/independent ground truth remain untouched. Synthetic result companions are separately named and documented.

## Working flow

Goal → imported observations → competing explanations → deterministic analysis → reviewed complete design → existing material preflight → separate researcher proposal review → later observation import → revised hypotheses and next direction.

The initial groups occupy disjoint measurement-order ranges. The additive model is algebraically full rank but interpreting its adjusted coefficients depends on unverified linear assumptions; the system reports allocation confounding and leaves both explanations unresolved. A counterbalanced follow-up can support an order association, a sample association, both signals, or neither. The recommendation changes with the supplied results.

No physical experiment is performed by the application. Importing historical or synthetic results neither confirms actual use nor deducts stock. The final research direction has no new physical material plan; another design requires separate review.

## API contract

All routes use the existing signed session, matching Origin and CSRF checks. Every object is scoped to the authorised project and investigation. Base `/api/lab`.

| Method | Route | Input/result |
|---|---|---|
| GET | `/protocols?project_id=demo-lab` | Existing permitted protocol drafts/approved versions; no re-upload required. |
| GET | `/investigations?project_id=demo-lab` | Project-scoped investigation list. |
| POST | `/investigations` | `{project_id,title,goal,protocol_id?}` → investigation. |
| GET | `/investigations/{id}` | Investigation, original evidence, analyses, hypothesis revisions, proposals and job steps. |
| POST | `/investigations/{id}/evidence` | `{phase,kind,filename,csv,protocol_version,note?,experiment_id?}` → immutable imported source. |
| GET | `/investigations/{id}/evidence/{evidenceId}/source` | Authorised original CSV download. |
| POST | `/investigations/{id}/design/review` | `{protocol_id,acknowledged:true,rationale?,assignments?}` → reviewed manifest. |
| POST | `/investigations/{id}/runs` | `{idempotency_key}` → persisted job202, processed asynchronously. |
| GET | `/investigations/{id}/runs/{runId}` | Running/completed/failed state, completed tools, summary/error. |
| POST | `/investigations/{id}/proposals/{proposalId}/review` | `{acknowledged:true}` → reviewed proposal with fresh material check if required. |

CSV header: `run_id,specimen_id,sample_group,measurement_order,signal,is_control`. The supported investigation requires eight specimens, groups A and B with four specimens each, and two controls labelled CONTROL. This prevents silently comparing different group identities across the original and follow-up runs. The follow-up must match every reviewed assignment, including order. Protocol version and optional historical experiment links are checked. The UI accepts files up to60KiB to leave room for JSON metadata in the64KiB request limit. Controls remain source evidence and counts; they are excluded from specimen inference and no unspecified QC limits are invented.

## Evidence and scientific memory

The additive research migration reuses SQLite without replacing stock or ledger tables. It persists investigations, evidence, analyses, hypothesis revisions, proposals, jobs and cached material previews. Source content, SHA-256, original CSV rows, importer and import time are retained. Analysis records link input IDs/hash, tool/version, parameters, numeric output and limitations. Revisions retain qualitative support and supporting/contradicting evidence IDs with reasons for change. Earlier analyses remain visible after a new result.

Initial imported observations can lack a historical experiment link; this remains explicit. A linked experiment must belong to a proposal in the same investigation. Existing experiment `completed` still means actual consumption was confirmed, independently of scientific results.

Changing stock marks old material readiness stale. New observations make prior scientific proposals historical; server-side review refuses them until current evidence is analysed. The full design is never reduced to work around a shortage. Repeated job keys replay their job. New-key retries after partial preparation reuse the same valid plan, or refresh a stale stock snapshot for the same planned experiment; cache matches require the exact evidence, design, protocol and full counts. Completed physical experiments and different evidence/designs are not reused.

## Bounded coordinator

Provider configuration follows the existing server-side pattern: `OPENAI_API_KEY`, optional `OPENAI_RESEARCH_MODEL` falling back to `OPENAI_MODEL` then `gpt-4o-mini`. The implementation follows [official OpenAI function-calling documentation](https://developers.openai.com/api/docs/guides/function-calling).

The real provider can select only:

1. `read_evidence`: permitted current observations, up to four prior interpretations, optional linked experiment history.
2. `analyse_results`: actual deterministic group/order calculations; no generated code.
3. `inspect_design`: scientist-reviewed full manifest and approved source protocol.
4. `check_materials`: actual existing `LabService.preview()`, preserving all eight specimens/two controls.
5. `save_recommendation`: records the tool-grounded hypothesis revision, draft proposal and bounded critique.

The tool pipeline enforces evidence-first dependencies. It allows at most six distinct tool executions, seven provider turns and60seconds; each network request has a bounded timeout, strict tool schemas, bounded output and `store:false`. Repeated completed tools return recorded outputs instead of executing mutations again. Uploaded text cannot grant tool permissions. A provider failure is visible and never silently presented as a successful offline agent. Interrupted persisted jobs expire after70seconds, preserving completed outputs for inspection/retry.

Without a key, the same five tools execute in a fixed **scripted walkthrough**, visibly labelled. The actual analysis and stock checks still run on imported data. No live provider result has been claimed from mocked provider tests.

The coordinator has no tool to approve protocols/designs, confirm consumption, alter stock, order supplies, send messages or operate instruments. Scientist actions remain separate authenticated endpoints. Its qualitative conclusions derive from the actual analysis output; it cannot substitute invented probabilities or a fixed preferred result.

## Verification

`pnpm test` from repository root includes both preflight and research tests. `pnpm check` and `pnpm build` validate the integrated application. After building, `node scripts/smoke-backend.mjs` checks the original transactional APIs and `node scripts/smoke-research.mjs` checks the new research loop using separate production servers and disposable databases. No team data is reset by those scripts.

The research HTTP smoke covers original confounding, complete-design preparation, source downloads/scope, proposal review, later order-trend interpretation, a no-signal counterexample, no inventory deductions and restart persistence. Unit suites additionally cover provider errors/aborts, invalid tools/arguments, source rows, design-count failures, stale readiness, idempotency/retries and project restrictions.
