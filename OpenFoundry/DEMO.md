# LabFoundry demo

Local interactive wet-lab procurement demo, extending OpenFoundry's SvelteKit frontend. Run from this repository:

```sh
pnpm install --frozen-lockfile
pnpm --filter @open-foundry/web dev --host 127.0.0.1
```

Open http://127.0.0.1:5173/lab. Demo is self-contained: no Rust services, database, login or API key required. Node 20+ and pnpm 9+ required. If pnpm 11 blocks esbuild install scripts, allow only esbuild through `pnpm approve-builds`, then retry.

## Two-minute walkthrough

1. Overview: inspect available budget, three pending purchases, and expiry-risk stock.
2. Run stock check twice. Proposals stay deduplicated; model calls stay at zero.
3. Review pipette tips. Approve, simulate payment, then confirm simulated receipt. Budget moves from available to committed to spent; stock updates at receipt.
4. Review another order and simulate payment failure. Reserved budget returns.
5. Inventory: expired master mix is excluded; eligible expiring stock is allocated first.
6. Experiments: add an experiment and see demand change. Complete only once materials are received; cancellation removes demand.
7. Switch demo role to Researcher to see purchasing actions disabled.
8. Export the audit log or reset demo with the header reset button.

## AI drafts (optional)

Configure `OPENAI_API_KEY` in `apps/web/.env`, optionally `OPENAI_MODEL` (default `gpt-4o-mini`), then restart the server. Never commit the key. The assistant makes one server-side Responses API call using strict structured output and a 20-second timeout. It only drafts experiments; stock decisions and purchasing remain deterministic. No model call occurs until Draft experiment is pressed. Missing credentials or malformed output produce an error and form fallback.

## Honest limits

- Fictional wet lab, fixed demo date 25 October 2026, supplier prices illustrative and inclusive of tax/delivery. Dataset example URL is a placeholder.
- Payments, delivery and role switching are simulated. No actual supplier integration or university finance connection.
- State lives in browser localStorage. Role controls demonstrate workflow, **not security**. Single-browser demo; concurrent tabs/users are unsupported. Do not store real lab or personal data.
- One lab-wide GBP budget; no project-level ledger yet. Approval rechecks current demand and remaining funds.
- Receipt assumes full delivery and a 180-day shelf life. Completion records planned resource quantities as actual consumption. No instrument execution or scientific protocol generation.
- Stock checks run on relevant local changes and manual request, not a background scheduler. Dataset links only; no file uploads.
- Before a real pilot: move state/transitions to transactional PostgreSQL, enforce authenticated server-side lab roles, implement provider idempotency and reconciliation, add actual consumption/receipt editing and authenticated AI quotas.

## Checks

```sh
pnpm --filter @open-foundry/web exec vitest run src/lib/lab/model.test.ts
pnpm --filter @open-foundry/web check
pnpm --filter @open-foundry/web build
```

Upstream OpenFoundry is Apache-2.0 licensed; its LICENSE is retained.
