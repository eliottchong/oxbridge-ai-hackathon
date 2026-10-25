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

Public URL at setup: https://6abc4a4f92f65e.lhr.life . The organiser's connection test successfully reached the authenticated health endpoint and identified LabRelax. Direct HTTPS access from the event network timed out, so local browser reachability may differ from external verifier reachability.

The tunnel URL is temporary: the laptop must remain awake and connected and both processes must remain running. A restarted tunnel may get a new URL, requiring a project URL update and connection check. A persistent hosted deployment is still needed after the hackathon. Local process IDs and runtime settings are kept outside Git under `~/.config/agent-studio-tokenmaxxers/`.

## Validation

148 tests across preflight and race adapter, clean Svelte type checks, production build, and HTTP checks for missing/wrong/correct bearer tokens, malformed tasks and real `/lab` rendering. New tests cover model metadata, model-selected tool execution, challenge-token separation, preserved provider signatures, transient retries, call budgets, origin restrictions, quota errors and timeouts. Live Gemini connectivity has also been checked. Only the platform's actual race verification establishes milestone points.

Do not final-submit while the team is still developing. No payments or automatic scientific decisions are added by this adapter.
