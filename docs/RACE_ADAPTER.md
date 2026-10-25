# LabRelax race adapter

This branch adds the ASRP/1 interface to commit `0192bfe`. It does not change protocol parsing, lab permissions, calculations or the consumption ledger.

- `GET /agent-studio/v1/health` requires `Authorization: Bearer <AGENT_STUDIO_VERIFIER_TOKEN>` and returns the ASRP ready envelope.
- `POST /agent-studio/v1/tasks` requires the same token. Malformed requests return 400. `respond` and `use_tools` tasks run through Google Gemini 3.5 Flash-Lite using server-side `GEMINI_API_KEY`. Output echoes the nonce and identifies the actual model. Missing configuration, quota exhaustion and provider errors return explicit error envelopes; there is no paid-provider fallback.
- The token is read only from the server environment; never put it in source or browser configuration.

## Isolated hackathon deployment

The scoring instance runs from `/Users/yee/Documents/labrelax-race`, independently of the builder's `/Users/yee/Documents/oxbridge-ai-hackathon` checkout and port 5173.

It uses port 5180 and its own SQLite database under the user's private configuration directory. Only temporary synthetic demonstration data is seeded. This is an explicitly shared demo workspace, not a deployment of private lab data.

Build the web app normally, then run Node 22.13+ (24 recommended):

```sh
node --env-file=/absolute/private/path/race.env build/index.js
```

The environment file needs `AGENT_STUDIO_VERIFIER_TOKEN`, a random `LABRELAX_SESSION_SECRET`, `LABRELAX_DEMO_MODE=true`, `LABRELAX_DB_PATH` pointing at an isolated database, `HOST=127.0.0.1`, `PORT=5180`, `BODY_SIZE_LIMIT=3M`, and `ORIGIN` set to the public HTTPS tunnel URL. Do not reuse the builder's database.

Add `GEMINI_API_KEY` for model verification. The scoring environment keeps the previously saved OpenAI credential under `UNUSED_OPENAI_API_KEY` so the existing lab parser cannot accidentally invoke OpenAI. This branch adds Gemini to the verifier adapter; it does not claim the builder's separate research coordinator has been migrated to Gemini.

Use a Google AI Studio project on Free Tier for no-cost model requests. The selected model has free-tier text input/output, subject to eligibility and quota; the adapter does not enable billing or invoke paid grounding/search. `RACE_USAGE_LOG` optionally points at a private JSONL log containing model name, timestamp and token usage only. No prompts, credentials or tool results are logged.

For `use_tools`, Gemini chooses the provided function and arguments. The server makes the actual POST request with the challenge bearer token, gives the returned data back to Gemini, and reports the observed tool results. The challenge token is never sent to Gemini. Tool URLs require HTTPS and default to the organiser's domain; a server-side `RACE_TOOL_HOSTS` allowlist can name a separately documented organiser service. Redirects, payment/order operations, excess calls and excess execution time are rejected. Transient tool 503s receive bounded retries within the same call budget.

Run the official Cloudflare Tunnel client to expose only this instance:

```sh
cloudflared tunnel --url http://127.0.0.1:5180 --protocol http2 --no-autoupdate
```

On the event network, Cloudflare's port 7844 TLS connection timed out. The working deployment instead uses localhost.run's documented SSH tunnel:

```sh
ssh -T -o ServerAliveInterval=20 -o ExitOnForwardFailure=yes -R 80:127.0.0.1:5180 nokey@localhost.run
```

The organiser's connection test successfully reached the authenticated health endpoint and identified LabRelax. The initial free domain expired during the event and was replaced. Read `~/.config/agent-studio-tokenmaxxers/race-public-url.txt` for the latest manually registered URL and `race-ssh-tunnel.log` for any newer tunnel registration events. Direct HTTPS access from the event network timed out, so local browser reachability may differ from external verifier reachability.

The tunnel URL is temporary: the laptop must remain awake and connected and both processes must remain running. A restarted tunnel may get a new URL, requiring a project URL update and connection check. A persistent hosted deployment is still needed after the hackathon. Local process IDs and runtime settings are kept outside Git under `~/.config/agent-studio-tokenmaxxers/`.

## Validation

148 tests across preflight and race adapter, clean Svelte type checks, production build, and HTTP checks for missing/wrong/correct bearer tokens, malformed tasks and real `/lab` rendering. New tests cover model metadata, model-selected tool execution, challenge-token separation, preserved provider signatures, transient retries, call budgets, origin restrictions, quota errors and timeouts. Live Gemini connectivity has also been checked. Only the platform's actual race verification establishes milestone points.

Do not final-submit while the team is still developing. No automatic scientific decisions or lab payments are added to the product workflow.

## Optional fifth scoring milestone: devnet payment

The user subsequently requested completion of the remaining payment milestone to reach 5/6, keeping final submission unlocked. The authenticated `run_workflow` handler is a separate scoring-only executor. Gemini extracts the requested recipient, exact decimal amount and memo. Deterministic code requires these to occur in the request, validates the task budget, and signs only on Solana devnet using Circle's official test-USDC mint. The RPC URL and devnet genesis hash are fixed in code; changing an environment variable cannot switch to mainnet.

This handler needs explicit `RACE_DEVNET_PAYMENTS=true`, `RACE_WALLET_FILE`, `RACE_WALLET_ADDRESS`, and `RACE_PAYMENT_DB_PATH`, all server-side. It reuses the existing team devnet wallet without replacing its key or touching the completed optional puzzle records. The wallet needs test USDC from Circle faucet and test SOL for fees/account rent.

Limits: at most one test USDC per task and two test USDC cumulatively, further restricted by the supplied task limit. Recipient token-account creation, USDC transfer and exact memo share one transaction. Every transaction is simulated. A separate SQLite journal reserves the nonce and records the locally computed signature **before** broadcast. Replayed requests reuse a confirmed signature; unresolved signatures never trigger a new transfer. The private key is read only by local signing code, never sent to Gemini, RPC, browser or Git.

The lab inventory database and actual-use ledger remain separate. This scoring feature does not enable procurement, real-money transfers or laboratory payments.

## Live verification, 25 October 2026

- AI feature working: passed on the second attempt at 17:06 UTC, +200 points. The first attempt reached an expired tunnel and failed before model execution.
- Agent uses tools: passed on the second attempt at 17:09 UTC, +300 points, score 100, receipt `349FD16F`. The platform confirmed both record lookups, the exchange-rate call, the computed total and agreement between reported and recorded results. The first tool attempt recorded the real calls but lacked the required structured result; the final adapter fixes that envelope.
- Team total after these verifications: 1,050 points, including the earlier 550.
- Key remains in private server configuration outside Git. No billing upgrade or paid OpenAI fallback was enabled. Google account billing-tier status must remain Free Tier for no-cost requests.
- Public URL registered for these passes: https://4ddd145c3fc9a0.lhr.life . Free tunnel domains rotate; this is not a permanent deployment.
- Automatic monitoring remains paused at the user's request. No payment milestone was attempted, and no final submission was made.
