# Agentic USDC payments — Solana devnet

`POST /api/agent/run_workflow` accepts a bounded payment task and returns the real, confirmed transaction signature at `output.data.signature`. It submits native Circle devnet USDC, includes the exact UTF-8 memo in the same transaction, and creates the recipient associated token account if needed. The existing protocol-preflight APIs remain available.

## Setup

Requires Node 22.13+ and persistent SQLite storage (same single-instance deployment as the lab backend).

```sh
pnpm --dir OpenFoundry install --frozen-lockfile
pnpm payments:wallet
```

Wallet generation creates `.wallets/devnet-agent.json` with permissions `0600`, refuses to overwrite an existing file, and prints its public address, absolute keypair path and a newly generated API token. Keep the private key and payment API token private. `.wallets/` is ignored by Git. Use a dedicated devnet wallet; never point this at a real-money wallet.

Fund the printed agent address with **devnet SOL** from [Solana Faucet](https://faucet.solana.com) and **USDC on Solana Devnet** from [Circle Faucet](https://faucet.circle.com). SOL also pays rent if the recipient needs a token account. This implementation uses Circle's devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, six decimals.

Set these in `OpenFoundry/apps/web/.env` (never commit this file):

```dotenv
LABRELAX_PAYMENTS_ENABLED=true
LABRELAX_PAYMENTS_API_TOKEN=<generated-token-of-at-least-32-characters>
LABRELAX_SOLANA_KEYPAIR_PATH=<absolute-path-to-devnet-agent.json>
LABRELAX_SOLANA_RPC_URL=https://api.devnet.solana.com
```

Start with `pnpm dev`, or use the existing hosted Node deployment instructions. The payment agent token is separate from researcher cookies and workspace credentials. Demo sessions cannot authorise payments. A custom RPC must use HTTPS and return Solana devnet's genesis hash; mainnet and testnet are blocked before signing or broadcasting.

If this machine's IPv6 routing causes Node RPC requests to time out, start with `NODE_OPTIONS=--dns-result-order=ipv4first pnpm dev` (or the same option for the hosted Node process). IPv4-first resolved the observed read-only RPC timeout during verification. This changes DNS preference only; the devnet genesis check remains mandatory.

## Task contract

The calling agent extracts the exact recipient, decimal USDC amount and memo from its trusted task instructions and invokes this tool. Register [the function-tool schema](agent-payment-tool.json) with a tool-calling runtime and have its executor POST the function arguments to `/api/agent/run_workflow`. No LLM decides amounts or modifies the memo inside the payment service. Use a stable task ID from the workflow runtime.

```json
{
  "type": "run_workflow",
  "taskId": "original-workflow-task-id",
  "instructions": {
    "network": "solana-devnet",
    "to": "<requested-recipient-wallet-address>",
    "amountUsdc": "0.01",
    "memo": "<exact requested memo>"
  }
}
```

`instructions` may also be a JSON-encoded string containing the same object. Ambiguous natural language must be resolved by the calling agent before invoking the tool; the service never guesses missing payment parameters. Amount must be a positive decimal **string**, at most six decimal places; floating-point numbers and rounding are rejected. Memo is preserved without trimming and may contain up to 512 UTF-8 bytes. The recipient is a wallet owner address, not a pre-derived token account. No arbitrary mint or network is accepted.

Save that task to `task.json`, then run:

```sh
pnpm payments:run /absolute/path/to/task.json
```

The CLI loads the payment API token from `OpenFoundry/apps/web/.env`, sends the task to `http://127.0.0.1:5173/api/agent/run_workflow`, and prints only the JSON response on success. Set `LABRELAX_PAYMENTS_BASE_URL` for a hosted server. HTTP is allowed only for loopback; hosted servers require HTTPS. Alternatively, POST the task JSON with `Content-Type: application/json` and `Authorization: Bearer <payment-token>`.

Success:

```json
{"output":{"data":{"signature":"<actual-confirmed-base58-signature>"}}}
```

The runtime should copy `response.output.data` into the task's `output.data` if it manages the outer output envelope itself. Inspect the signature at `https://explorer.solana.com/tx/<signature>?cluster=devnet`.

## Confirmation and retry behavior

1. Validate task and exact amount; enforce devnet using RPC genesis identity; check sender USDC and SOL (fees plus recipient rent).
2. Build and sign one transaction containing recipient ATA creation, the exact memo, and a six-decimal `TransferChecked`.
3. Save the signature, signed bytes and blockhash expiry in SQLite **before** broadcasting.
4. Wait for `confirmed`/`finalized` status, reject chain errors, and read the transaction to verify mint, sender, recipient token account, amount and memo.
5. Return the signature only after successful verification. A duplicate completed task returns the same signature without another transfer.

An interrupted or ambiguous submission retains its signed transaction. Retry the **same task ID and instructions** to reconcile or resend those exact bytes. The service never signs a replacement once a task has signed bytes. Changing recipient, amount, memo or wallet under an existing task ID returns `409 TASK_CONFLICT`. Concurrent unsigned preparations use a durable lease; an expired unsigned lease may be recovered, but its former holder cannot persist or broadcast after losing ownership.

`503 PAYMENT_PENDING` means retry the same task later. `409 PAYMENT_EXPIRED` or `422 TRANSACTION_FAILED` needs reconciliation of the saved signature before a genuinely new payment is authorised. Do not make a new task ID merely to retry. Unfunded or other failures **before signing** can safely retry the same task after correcting configuration/funding. A pending/error response never masquerades as success and contains no fake signature.

## Builder integration

No Builder SDK, package name, import path or signer API was supplied in the source repository. This ships a working server-side Solana implementation (`payUsdc` in `solana.ts`) rather than a placeholder import. If Builder owns the agent signer and offers `payUsdc(signer, { to, amountUsdc, memo })`, use this task contract as the structured tool input and map its real confirmed signature to the required output envelope. Before replacing the bundled helper, preserve the durable-before-broadcast lifecycle; an opaque helper without signing/persistence hooks cannot inherit this service's retry guarantees.

## Checks and honest verification boundary

`pnpm test`, `pnpm check`, `pnpm build`.

Automated tests use generated disposable signing keys and mocked RPC responses. They inspect real serialized signed SPL transactions, exact amounts/memo bytes, devnet restrictions, rent checks, chain verification, bearer authorization, persistent retries and database restart behavior. They do not prove devnet settlement. End-to-end acceptance requires a funded devnet agent wallet and the actual task's recipient, amount and memo, then checking the returned signature on chain. No real task payment is fabricated or automatically submitted by the test suite.

References: [SPL TransferChecked](https://solana-labs.github.io/solana-program-library/token/js/functions/createTransferCheckedInstruction.html), [Solana confirmation](https://solana.com/docs/advanced/confirmation), [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).
