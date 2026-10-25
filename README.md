# LabFoundry

University wet-lab purchasing demo, built inside the actual OpenFoundry repository.

```sh
cd OpenFoundry
pnpm install --frozen-lockfile
cd ..
npm run dev
```

Open **http://127.0.0.1:5173/lab**.

Experiments, expiry-aware inventory, restock proposals, human approval, simulated payments, receipts and audit log. Data persists in this browser. No credentials required; AI drafting is optional.

Run `npm test`, `npm run check`, and `npm run build` from this directory.

See [demo walkthrough and limitations](OpenFoundry/DEMO.md). Payments and role selection are simulated; do not use for real spending or sensitive data.
