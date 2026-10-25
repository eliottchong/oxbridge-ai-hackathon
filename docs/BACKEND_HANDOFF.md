# LabRelax backend handoff

This implements the supplied LabRelay protocol-preflight plan under the requested LabRelax name. The final SOP, inventory and independent ground truth belong to the teammate's data workstream. Files in `static/fixtures/` are explicitly temporary engineering fixtures only.

## API

Base: `/api/lab`. All quantities are decimal **strings**. Projects other than the provisioned `demo-lab` receive a generic 404, without names, counts or documents.

| Method | Path | Input / result |
|---|---|---|
| GET | `/session` | Returns user, allowed projects, CSRF token and demo flag. Local development can issue a shared demo session; hosted mode requires explicit configuration. |
| POST | `/session` | `{access_token}` exchanges configured workspace credential for an HttpOnly signed session. |
| GET | `/inventory?project_id=demo-lab` | `{resources}` with canonical uL balances, thresholds, revisions and lots. |
| POST | `/inventory/import` | `{project_id, confirmed:true, source_name, resources}` reviewed initial baseline; disallowed after consumption exists. |
| POST | `/protocols/parse` | Multipart `project_id`, `file`; supported PDF ≤2MB. Returns unapproved draft with hash, extracted source text and per-row page/excerpt. |
| GET | `/protocols/{id}/source` | Authenticated original PDF bytes, not a public document URL. |
| POST | `/protocols/{id}/approve` | `{rows, fixed_controls, replicates_per_specimen, overage_percent, acknowledged:true}`; source retained and reviewer inferred from session. |
| POST | `/run-plans/preview` | `{project_id, protocol_id: draft.id, specimen_count, experiment_id? , experiment_name?}`. Returns exact required/available/shortage/forecast and stock revisions. Saves plan, never consumption. |
| POST | `/experiments/{id}/consumption/confirm` | `{plan_id,idempotency_key,confirmed:true,actuals:[{resource_id,amount,unit,lot_id}],justification}`. Rechecks stock/revisions inside transaction, appends events once. |
| GET | `/experiments?project_id=demo-lab` | Project-visible run summaries. |
| GET | `/experiments/{id}/continuity` | Protocol, original/reviewed values, plans, confirmations, actual-use events and unresolved lot/expiry issues. |

All authenticated POSTs require the matching `Origin` and `X-CSRF-Token` from `/session`. Session creation uses a same-origin POST. Cookies are HttpOnly, SameSite Strict, signed and expire after eight hours. HTTPS cookies are Secure. Actor IDs and membership are server-derived; client roles/actor fields confer no permission. There is one provisioned demo project membership, not a general multi-user directory.

Errors: `{error:{code,message,details?}}` with 400 invalid input, 401 auth, 403 CSRF/origin, generic 404 for unavailable/restricted objects, 409 stale/idempotency/stock conflicts, 413 size, 422 unresolved protocol, 502 AI provider failure.

## Inventory JSON from the data teammate

```json
{
  "resources": [
    {
      "id": "buffer-a",
      "name": "Buffer A",
      "balance": "700",
      "unit": "uL",
      "reorder_threshold": "100",
      "lots": [{"id": "BUF-001", "balance": "700", "expires": null}]
    }
  ]
}
```

The file contains **all** baseline resources: IDs `buffer-a`, `indicator-b`, `wash-c` for the agreed protocol. Units may be `uL`, `µL`, `μL`, `mL`. Amounts/thresholds/lot balances must be strings, never JSON numeric quantities. Empty lots means unknown; expiry null means unrecorded. Known lot balances cannot exceed total stock. Final source data and expected values should be independently checked by the teammate. The backend never loads `ground_truth.json`.

Import validates first, then atomically replaces the initial stock register. All previews become stale via monotonically increasing revisions. Imports are audit-recorded. Baseline replacement is locked after actual consumption, so it cannot erase the usage ledger. There is no receipt/replenishment workflow in this scope.

## Supported PDF layout contract

Text-based PDF with the following identifiable labels and a pipe-delimited reagent table. Quantities, controls, replicates, overage and version are read from source, not filled from expected answers. Layout changes need parser adaptation and tests; arbitrary PDFs/scans are explicitly unsupported.

```text
Synthetic Microplate Readout SOP v1.0
Supported layout: LABRELAY-PREFLIGHT-1
Protocol ID: SYN-MICROPLATE-001
Version: 1.0
SYNTHETIC DEMO - benign placeholder reagents only.
Sample count means test specimens, excluding controls.
Replicates per specimen: 1
Fixed controls: 2
Preparation overage: 10%
Resource | Per reaction | Unit
Buffer A | 60 | uL
Indicator B | 15 | uL
Wash C | 100 | uL
Notes:
Researcher approval is required before planning.
Preparation overage does not imply actual consumption.
Recorded inventory is not a measurement of physical stock.
```

Numbers above illustrate the agreed plan; **the teammate supplies the final PDF and ground truth**. Unexpected footnotes, contradictory assumptions, unknown units/resources and embedded instructions force review. A scanned/image-only PDF produces an unsupported result. Documents are data, never authority to approve or mutate stock.

## Arithmetic and actual consumption

`reactions = specimens × replicates + fixed_controls`

`required = per_reaction × reactions × (1 + overage_percent/100)`

Canonical µL precision is six decimal places, using BigInt fixed point. Inputs needing rounding are refused. No mass-to-volume conversion. Duplicate mapped resource rows aggregate before stock comparison.

Preview quantities are preparation estimates. Confirmation takes separately reviewed actual quantities; deviations require justification. An idempotency key replay returns the same confirmation without more consumption; reusing the key for different content gives409. Stock and lot rechecks, all deductions, experiment completion and append-only events occur in one SQLite transaction. Competing stale plans fail. An unknown lot stays explicitly unresolved; its resource's remaining lot allocations are cleared because per-bottle balances can no longer be vouched for. Aggregate stock remains conserved and event provenance is retained.

## Persistence, AI and hosting

- `LABRELAX_DB_PATH` selects the SQLite file; local default `.data/labrelax.sqlite` under the process working directory. Baseline is seeded only on first creation; restart never resets stock or reintroduces removed resources.
- `LABRELAX_SEED_DEMO=false` creates an empty initial register for team imports. Existing files retain their data.
- Node22.13+ required for `node:sqlite` (Node24 recommended). Hosted Node adapter requires persistent disk, one application instance, `ORIGIN` and `BODY_SIZE_LIMIT=3M` for uploads.
- Local development demo access defaults on. Production defaults off; either explicitly enable the shared synthetic demo, or configure workspace access token and a long random session secret. This is hackathon workspace authentication, not institutional SSO.
- Optional real OpenAI transcription uses server-side `OPENAI_API_KEY`, optional `OPENAI_MODEL` (default `gpt-4o-mini`), strict structured output, no model tools, no provider response storage requested,20s timeout. Every model value and source excerpt is compared with deterministic source extraction. Disagreement blocks review; provider errors are sanitised. No configured key means supported-template mode, visibly labelled in UI. Real model verification needs a supplied key; test coverage uses mocked responses.

## Verification

From repository root: `pnpm test`, `pnpm check`, `pnpm build`. Backend tests cover arithmetic, unit conversions, source PDF extraction, uncertainty, injection, pure previews, provenance, project permissions, atomic rollback, double-submit, stale competing plans, safe baseline replacement and SQLite persistence. Browser verification exercises the same API; static success screens are not used. Never present fixture results as general extraction accuracy or measured real-world assay outcomes.
