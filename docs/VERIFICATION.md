# LabRelax verification

Engineering checks use temporary synthetic fixtures; teammate final SOP/inventory/ground truth are not substituted or claimed as tested.

- Backend unit/integration suites: calculator, parser, AI response validation, SQLite service and authentication.
- Type check: full Svelte/TypeScript diagnostics.
- Build: production Node adapter.
- HTTP smoke: `node scripts/smoke-backend.mjs` after building. Starts a separate production Node server and a disposable SQLite file, tests the real endpoints, then removes only its own temporary files. It never writes to the team's database.
- Browser QA: real production build, supported PDF upload, source evidence review, approval,8-specimen shortage (15µL Indicator B),6-specimen what-if, explicit edited actual-use confirmation, missing-lot issue and experiment continuity. Actual Indicator B130µL differs from planned132µL, resulting recorded stock20µL.

Screenshots `labrelax-preflight.png` and `labrelax-continuity.png` record this working engineering test flow, not real assay outcomes. No live OpenAI request has been verified without a provider key; AI response handling is covered with mocks and the browser shows supported-template mode.
