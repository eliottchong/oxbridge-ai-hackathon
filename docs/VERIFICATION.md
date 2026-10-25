# LabRelax verification

Engineering checks use temporary synthetic fixtures; teammate final SOP/inventory/ground truth are not substituted or claimed as tested.

- Backend unit/integration suites: calculator, parser, AI response validation, SQLite service and authentication.
- Type check: full Svelte/TypeScript diagnostics.
- Build: production Node adapter.
- HTTP smoke: `node scripts/smoke-backend.mjs` after building. Starts a separate production Node server and a disposable SQLite file, tests the real endpoints, then removes only its own temporary files. It never writes to the team's database.
- Browser QA: real production build, supported PDF upload, source evidence review, approval,8-specimen shortage (15µL Indicator B),6-specimen what-if, explicit edited actual-use confirmation, missing-lot issue and experiment continuity. Actual Indicator B130µL differs from planned132µL, resulting recorded stock20µL.

Screenshots `labrelax-preflight.png` and `labrelax-continuity.png` record this working engineering test flow, not real assay outcomes. No live OpenAI request has been verified without a provider key; AI response handling is covered with mocks and the browser shows supported-template mode.

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
