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
