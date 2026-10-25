# LabRelax

Protocol-to-inventory preflight for the Oxbridge AI hackathon, built inside OpenFoundry's SvelteKit application.

Upload a supported text PDF, review the source-linked reagent table and assumptions, calculate run-specific material demand, and separately confirm actual consumption. Planning never consumes stock. Inventory and append-only usage events persist in SQLite on the server.

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

## Scope

One supported synthetic SOP layout. No arbitrary document understanding, scientific validity certification, supplier orders, instrument execution or payments. The restricted-project API is denied server-side; demo-mode access is intentionally shared and is not individual institutional authentication. Historical events preserve planned/actual quantities, authenticated session actor, source protocol, lot uncertainty and variance.

The OpenFoundry Apache-2.0 licence is retained in `OpenFoundry/LICENSE`. Upstream services remain reference source; this demonstrator uses its SvelteKit scaffold and a dedicated SQLite backend, with no requirement to run the Rust service stack.
