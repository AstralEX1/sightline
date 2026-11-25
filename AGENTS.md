# Trade Shortcuts: notes for AI agents

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

Expected demo story: the lens lists BTC, ETH, SOL. About 30 s after the server starts, the enabled shortcut **Near liquidation · half** raises a BTC alert with `Dismiss` first. `down` then `click` confirms **Close 50%**, and the lens shows the fill. The trade then appears in `/api/history` and in History on the phone page.

The simulator needs a desktop session. On a headless box (CI, remote shell) run the checks below and the `/api` calls against `npm run server` alone, and say the lens was not shown.

## Checks before any commit

```bash
npm run typecheck && npm test && npm run build
```

## Rules that hold everywhere

- Never point `BYBIT_BASE` at a live host. `server/src/bybit.ts` refuses it on purpose; keep that guard.
- Every exchange write goes through a proposal and `confirm` on the lens. Do not add a path that trades without lens authorization. A spoken yes can also confirm after the cancellable countdown when voice is enabled.
- The rule catalog and validator (`server/src/registry.ts`, `server/src/validate.ts`) are shared by phone and server. Change them once.
- Never commit `.env` or `server/data/`. Never print `APP_TOKEN` or exchange keys in logs or reports.
- Specs: `docs/shortcuts-architecture.md` (server), `docs/trade-shortcuts-spec.md` (phone), `docs/glasses-shortcuts.md` (lens), `docs/design.md`.
