# LabRelax verification

Engineering checks use temporary synthetic fixtures; teammate final SOP/inventory/ground truth are not substituted or claimed as tested.

- Backend unit/integration suites: calculator, parser, AI response validation, SQLite service and authentication.
- Type check: full Svelte/TypeScript diagnostics.
- Build: production Node adapter.
- HTTP smoke: `node scripts/smoke-backend.mjs` after building. Starts a separate production Node server and a disposable SQLite file, tests the real endpoints, then removes only its own temporary files. It never writes to the team's database.
- Browser QA: real production build, supported PDF upload, source evidence review, approval,8-specimen shortage (15µL Indicator B),6-specimen what-if, explicit edited actual-use confirmation, missing-lot issue and experiment continuity. Actual Indicator B130µL differs from planned132µL, resulting recorded stock20µL.

Screenshots `labrelax-preflight.png` and `labrelax-continuity.png` record this working engineering test flow, not real assay outcomes. No live OpenAI request has been verified without a provider key; AI response handling is covered with mocks and the browser shows supported-template mode.

## Agent payments addition

- Existing 139 backend checks plus 29 payment/HTTP checks pass (168 total cases). Payment tests use real generated signing keys and serialized SPL transactions, genuine SQLite persistence and mocked RPC settlement.
- Full Svelte/TypeScript check: zero errors/warnings. Production Node build passes. Offline frozen-lockfile installation passes, with optional native acceleration explicitly disabled.
- Wallet CLI generates a 64-byte secret-key file with mode `0600` and refuses to overwrite it. Disposable test key was deleted after this check.
- Production HTTP smoke: POST `/api/agent/run_workflow` without payment enablement returns HTTP 503 / `PAYMENTS_DISABLED`.
- Live read-only devnet RPC confirms genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` and six-decimal native devnet USDC. IPv4-first DNS resolved the initial Node connectivity timeout.
- No live payment has been submitted: a funded agent wallet and actual task recipient/amount/memo are still required. No Builder SDK was supplied; its concrete import/signer integration has not been verified. See `AGENT_PAYMENTS.md` for the shipped adapter and explicit integration contract.

## Research extension, 25 October 2026

- Full preflight plus research suites: **216 tests passed** across eight files.
- Full Svelte/TypeScript check: **zero errors, zero warnings**.
- Production Node build: passed.
- Original HTTP smoke: **35 checks passed**.
- Research production HTTP smoke: **55 checks passed**, including a real separate Node process, SQLite restart persistence, source provenance/scope, full reviewed design, changed conclusions and zero stock consumption.
- Production browser walkthrough: original CSV → actual confounding analysis → source protocol review → complete counterbalanced design → stock shortage → refreshed sufficient engineering baseline check → proposal review → synthetic later CSV → actual order-trend reanalysis and changed research direction.
- The browser test used `/tmp/labrelax-research-browser-qa.sqlite`; it did not reset or replace the team's workspace. Its explicitly reviewed engineering stock baseline was supplied only to that isolated test database, not saved as final team data.
- `labrelax-research-before.png` and `labrelax-research-after.png` show the actual browser flow. Sources and outputs are labelled synthetic. No physical experiment, general scientific validity, statistical significance or new discovery is claimed.
- Real function-calling transport, failures/aborts, strict allowlist and budgets are verified with mocked provider responses. A **live provider-backed run has not been verified** without a supplied API key. No-key mode is visibly **scripted walkthrough**, while deterministic analysis and material preflight execute against the actual supplied data.

## Guided fictional PCR presentation demo, 25 October 2026

- Full application suite: **261 tests passed** across twelve files, including sixteen PCR cases covering numerical summaries, alternative results, controls, zero target, evidence reuse, stale choices, idempotency and persistence.
- Svelte/TypeScript diagnostics: **zero errors and zero warnings**. Production Node build passed.
- Production HTTP checks: **46 PCR checks**, plus the existing **35 preflight** and **55 research** checks. All use disposable databases and leave the team's stock unchanged.
- PCR HTTP coverage includes exact served-PDF SHA-256, authentication/CSRF/project checks, initial evidence and real calculations, three experiment choices, recorded selection/evidence links, two follow-up cycles, changing recommendations, replay protection, restart persistence and unchanged inventory.
- Production browser walkthrough on an isolated database: input preview → completed analysis checks → initial interpretation → specificity choice and acknowledgment → fictional result preview → new analysis → revised direction and retained earlier interpretation. The analysis screen waits for the presenter to choose **View findings**, rather than introducing a fake delay.
- The original three-page PCR PDF is retained byte-for-byte as context. Every observation and extension experiment is explicitly fictional. The app uses declared arithmetic heuristics for this scenario and does not claim a live model, complete PCR protocol extraction, laboratory execution or material readiness.
- `pcr-demo-learning-loop.png` records the actual browser result and its before/after reasoning. Reusing an identical evidence file is explicitly identified as a replay, not an independent replicate.

## Combined research and payment merge

- Resolved shared configuration, npm scripts and documentation by retaining both research investigations and separately authorised devnet payments. Hosted startup keeps `.env` loading; the root test command includes both features.
- Combined suite: **245 tests passed across 11 files**. Full Svelte/TypeScript check: **zero errors and warnings**. Production Node build passed.
- Both production HTTP suites passed: **35 preflight checks plus 55 research checks**, using disposable databases and local servers.
- Live payment and live model-provider verification boundaries above still apply; merging does not enable payment credentials or submit transactions.
