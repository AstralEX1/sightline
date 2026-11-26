# Agent instructions for Trade Shortcuts

Trading rules built on a phone page and answered on Even Realities G2 glasses, for Bybit demo/testnet only. Product overview and safety model: `README.md`. Deeper context: `docs/handoff.md`.

## Run the demo

```bash
npm run demo
```

Needs Node.js 22.18+. It is long-running: start it in the background and do not wait for it to exit. It installs dependencies if `node_modules` is missing, starts a fresh in-memory paper account and a loopback proxy with a temporary credential, and opens the simulator.

| What | Where |
|---|---|
| Server (REST, `Authorization: Bearer $APP_TOKEN`) | `http://127.0.0.1:8788/api` |
| App (phone page and lens code, Vite) | `http://localhost:5173`, proxies `/api` to the server |
| Even Hub simulator, automation API | `http://127.0.0.1:9898` |

It is ready when the output shows `Trade Shortcuts demo is running`. If it stops with `Port … is in use`, an earlier run is still up: use that one or stop it.

## Check that it works without a human

Simulator automation (same calls as `scripts/screens.ts`):

```bash
curl -s http://127.0.0.1:9898/api/ping
curl -s -X POST http://127.0.0.1:9898/api/input -H 'content-type: application/json' -d '{"action":"down"}'  # up | down | click | double_click
curl -s http://127.0.0.1:9898/api/screenshot/glasses -o lens.png   # green on transparent, 576×288
curl -s http://127.0.0.1:9898/api/console                          # app console, look for level "error"
```

Leave about 800 ms between inputs (the lens ignores swipes closer than 700 ms) and a few seconds before a screenshot.

Paper demo state and History are available through the loopback Vite proxy at `http://localhost:5173/api/state` and `/api/history`.

Expected demo story: the lens lists BTC, ETH, SOL. About 30 s after the server starts, the **Near liquidation · half** shortcut raises a BTC alert with `Dismiss` first. The card stays open for 120 s and can recur while its condition holds. `down` then `click` confirms **Close 50%**, and the lens shows the fill. The trade then appears in `/api/history` and in History on the phone page.

The simulator needs a desktop session. On a headless box (CI, remote shell) run the checks below. For API checks use a configured fake server on its own port and authenticate requests, and say the lens was not shown.

## Checks before any commit

```bash
npm run typecheck && npm test && npm run build && npm run build:site
```

## Rules that hold everywhere

- When a blocker or decision can be resolved substantially faster or more reliably by asking Alex, ask before proceeding.
- If the repository is indexed in `.codegraph/`, use CodeGraph first to locate or understand code. Use `codegraph_explore` or `codegraph explore "<question>"`.
- Never point `BYBIT_BASE` at a live host. `server/src/bybit.ts` refuses it on purpose; keep that guard.
- Every exchange write goes through a proposal and `confirm` on the lens. Do not add a path that trades without lens authorization. A spoken yes can also confirm an eligible alert after the cancellable countdown. An Open with pending size or leverage choices requires manual selection.
- The rule catalog and validator (`server/src/registry.ts`, `server/src/validate.ts`) are shared by phone and server. Change them once.
- Keep real `.env` files and `server/data/` out of Git and release packages. Never commit, publish, log or expose credentials, private keys, seed phrases or tokens.
- Specs: `docs/shortcuts-architecture.md` (server), `docs/trade-shortcuts-spec.md` (phone), `docs/glasses-shortcuts.md` (lens), `docs/design.md`.
