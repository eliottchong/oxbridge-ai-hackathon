# LabRelax

**LabRelax turns yesterday’s results into tomorrow’s experiment.** A bounded research partner for the Oxbridge AI hackathon, built inside OpenFoundry’s SvelteKit application.

The presentation opens with a guided PCR investigation: explain the input, run transparent calculations, inspect interpretations, choose a fictional follow-up experiment, then introduce new fictional observations and reconsider the next step. The supplied PCR PDF is retained as source context; observations and extension experiments are explicitly invented for the demonstration.

The earlier microplate investigation remains available from **Open earlier microplate investigations**. It compares a sample-associated effect with a measurement-order explanation and connects a reviewed design to the existing material preflight.

The existing supported-PDF review, exact material preflight and separate actual-use confirmation remain available. Research analysis and planning never consume stock. All investigation records and append-only usage events persist in the same SQLite database.

## Run locally

Requires Node **22.13+** (Node 24 recommended) and pnpm 9+.

```sh
pnpm --dir OpenFoundry install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:5173/lab**. Local development starts an explicitly labelled shared synthetic demo session. Your teammate's final SOP and inventory are the intended demo inputs. The optional engineering SOP and initial stock are temporary test fixtures derived from the plan, not the team's final dataset.

```sh
pnpm test
pnpm check
pnpm build
```

## PCR presentation demo

Open **Investigation** to begin a fresh presentation. Add a research question, inspect the supplied PCR source and load the labelled fictional initial observations (or a compatible observation CSV). Continue through **Input → Analysis → Findings → Experiment options → New results**. Choose one of three different follow-ups, introduce its fictional result and repeat the analysis. Earlier rounds remain visible in the same investigation; starting a new presentation creates a separate record and never resets existing workspace data.

The fictional measurements are post-PCR band intensities in arbitrary units, not qPCR cycle values. Numerical summaries are calculated from the imported rows using declared illustrative heuristics. This demonstration does not establish biological validity, perform experiments or deduct stock. PCR material readiness is not asserted because matching inventory and complete template quantities have not been provided. No live model is required or claimed for this fictional scenario.

See [the PCR demo narrative, data assumptions and source](docs/PCR_DEMO.md).

## Earlier microplate research walkthrough

1. Open **Investigation** and save a research question.
2. Import the data owner’s initial CSV, or explicitly choose the separately labelled synthetic companion observations.
3. Press **Investigate**. The original blocked-order design leaves both explanations unresolved.
4. Review/link the supported SOP and the full eight-specimen, two-control counterbalanced design. Investigate again to prepare its exact material plan, then review the proposed experiment. A shortage retains the full design and stays blocked.
5. Add the synthetic follow-up (or matching reviewed result CSV). Reanalysis changes the next direction from testing the initial ambiguity to investigating the order trend, if the supplied observations support that conclusion.

With no provider key this is visibly a **scripted walkthrough**: real tools run on the supplied data in a fixed sequence. With `OPENAI_API_KEY`, a real bounded coordinator selects those allowlisted tools. Live provider mode has not been verified without a supplied key; its transport/error handling is tested with mocks. The app never performs a physical experiment.

The main-stage baseline must be supplied/reviewed by the data owner and cover the complete design. The existing temporary stock intentionally demonstrates a shortage; baseline import is not a receipt or replenishment feature.

See [research API and agent boundaries](docs/RESEARCH_IMPLEMENTATION.md) and [companion-data assumptions](docs/RESEARCH_COMPANION_DATA.md).

## Backend and data handoff

See [the backend contract](docs/BACKEND_HANDOFF.md) for endpoints, supported PDF layout, inventory import format, authentication, persistence and verification.

- Server API: `/api/lab/*`.
- Teammate inventory JSON: Inventory → Bring your own inventory → review → import. Import only replaces an initial baseline before any actual-use event.
- Protocol: upload the teammate's supported machine-readable PDF; all fields remain subject to researcher review.
- Optional AI: set `OPENAI_API_KEY` in `OpenFoundry/apps/web/.env`. With no key, extraction is honestly labelled **supported-template**. No scientific quantities are invented and no model performs stock arithmetic.
- Actual quantities are decimal strings in µL or mL. The calculator uses fixed-point integer arithmetic with no rounding.

## Hosted Node server

```sh
pnpm build
LABRELAX_DEMO_MODE=true LABRELAX_DB_PATH=/absolute/persistent/labrelax.sqlite ORIGIN=https://your-app.example PORT=3000 pnpm start
```

Use a persistent volume for SQLite and one Node application instance. Do not use ephemeral/serverless filesystem hosting for persistent stock. For a private workspace, set `LABRELAX_DEMO_MODE=false`, `LABRELAX_ACCESS_TOKEN` and `LABRELAX_SESSION_SECRET`; the application then requires the workspace token. `.env.example` documents configuration. Set `BODY_SIZE_LIMIT=3M` when serving the Node build so multipart uploads near the 2 MB file limit are accepted.

## Agentic devnet payments

Optional `run_workflow` payment API sends real **test-money USDC on Solana devnet**, includes the requested memo and returns `output.data.signature` only after confirmation and transaction verification. It requires a separately authorised, funded agent wallet and payment API token. Signed transactions are persisted before broadcast so task retries cannot create another payment. See [setup, task contract and Builder integration](docs/AGENT_PAYMENTS.md).

## Scope

A guided fictional PCR scenario plus the earlier supported synthetic SOP and bounded two-group, eight-specimen/two-control investigation. Analyses use declared descriptive heuristics; they do not establish statistical significance or causality. The PCR PDF is a fixed supplied reference, not a claim of general PDF understanding or an approved material allocation. No autonomous scientific discovery, live literature search, scientific validity certification, supplier orders or instrument execution. Payments are an explicitly enabled Solana devnet integration; no mainnet payments are supported. The restricted-project API is denied server-side; demo-mode access is intentionally shared and is not individual institutional authentication. Historical events preserve planned/actual quantities, authenticated session actor, source protocol, lot uncertainty and variance.

The OpenFoundry Apache-2.0 licence is retained in `OpenFoundry/LICENSE`. Upstream services remain reference source; this demonstrator uses its SvelteKit scaffold and a dedicated SQLite backend, with no requirement to run the Rust service stack.
