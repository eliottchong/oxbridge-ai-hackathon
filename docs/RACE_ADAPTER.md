# LabRelax race adapter

This branch adds the ASRP/1 interface to commit `0192bfe`. It does not change protocol parsing, lab permissions, calculations or the consumption ledger.

- `GET /agent-studio/v1/health` requires `Authorization: Bearer <AGENT_STUDIO_VERIFIER_TOKEN>` and returns the ASRP ready envelope.
- `POST /agent-studio/v1/tasks` requires the same token. Malformed requests return 400. Valid requests currently return 503 because a real model/tool adapter has not been configured. Do not claim AI or tool verification on this branch yet.
- The token is read only from the server environment; never put it in source or browser configuration.

## Isolated hackathon deployment

The scoring instance runs from `/Users/yee/Documents/labrelax-race`, independently of the builder's `/Users/yee/Documents/oxbridge-ai-hackathon` checkout and port 5173.

It uses port 5180 and its own SQLite database under the user's private configuration directory. Only temporary synthetic demonstration data is seeded. This is an explicitly shared demo workspace, not a deployment of private lab data.

Build the web app normally, then run Node 22.13+ (24 recommended):

```sh
node --env-file=/absolute/private/path/race.env build/index.js
```

The environment file needs `AGENT_STUDIO_VERIFIER_TOKEN`, a random `LABRELAX_SESSION_SECRET`, `LABRELAX_DEMO_MODE=true`, `LABRELAX_DB_PATH` pointing at an isolated database, `HOST=127.0.0.1`, `PORT=5180`, `BODY_SIZE_LIMIT=3M`, and `ORIGIN` set to the public HTTPS tunnel URL. Do not reuse the builder's database.

Run the official Cloudflare Tunnel client to expose only this instance:

```sh
cloudflared tunnel --url http://127.0.0.1:5180 --protocol http2 --no-autoupdate
```

The tunnel URL is temporary: the laptop must remain awake and connected and both processes must remain running. A restarted tunnel may get a new URL, requiring a project URL update and connection check. A persistent hosted deployment is still needed after the hackathon.

## Validation

Authentication unit test, Svelte type checks, production build, and HTTP checks for missing/wrong/correct bearer tokens, malformed tasks, honest unconfigured-model response and real `/lab` rendering. Then use the platform's Test connection and actual race verification before reporting points.

Do not final-submit while the team is still developing. No payments or automatic scientific decisions are added by this adapter.
