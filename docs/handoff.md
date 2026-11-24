# Sightline: handoff

## Purpose
Bybit Shortcuts on Even Realities G2: the user builds rules on the phone page (one scope, conditions under one `and`/`or`, exactly one action); the server polls Bybit, raises alerts and exact trade proposals; every trade needs a tap on the glasses. Bybit **demo/testnet only**; a built-in demo exchange is the default. Overview and demo steps: `README.md`.

## Sources of truth
- Server, rule model, API: `docs/shortcuts-architecture.md` (§15 lists the product decisions: no Funding → Trading transfer, no daily loss limit or per-action cap, strict Set SL, voice phrases on shortcuts, phone delivery = in-app + Telegram).
- Phone page: `docs/bybit-shortcuts-spec.md` v2 and its canvas.
- Lens: `docs/glasses-shortcuts.md` and its canvas. `docs/design.md` for the G2 design rules.

## Architecture
See the table in `README.md`. In short: `registry.ts` + `validate.ts` (one catalog and validator for phone and server), `engine.ts` (pure evaluator and trigger policies), `session.ts` (poll → facts → engine → alerts/proposals, lens state), `proposals.ts` (resolve and guard terms), `execute.ts` (confirm, serialize, submit once, reconcile), `store.ts` (`node:sqlite`, `server/data/<fake|bybit>.db`, git-ignored), `notify.ts` (lens / app / Telegram), `bybit.ts` + `fake-exchange.ts`, `http.ts`. The phone page is `app/src/phone/`; the lens is `app/src/view.ts` + `app/src/main.ts`.

## Commands
```
cp .env.example .env     # APP_TOKEN (16+ chars): openssl rand -hex 16
npm install
npm run server           # API on 127.0.0.1:8787
npm run dev              # phone page and lens app on :5173
npm run sim              # glasses simulator
npm run qr               # QR to load on real glasses (same Wi-Fi)
npm run typecheck && npm test && npm run build
```
Needs Node >= 22.18 (runs `.ts` directly; `node:sqlite` prints an ExperimentalWarning on Node 22). CI: `.github/workflows/test.yml`.

## Current state
Server: every endpoint of architecture §10, tested end to end against `FakeExchange` (duplicate and concurrent taps, ambiguous submits, supersede, expiry, simulated proposals, voice, hysteresis, crossings across a gap, kline warm-up, order fills, reconciliation). Phone page and lens built against it and checked in the browser and the Even Hub simulator. Not tried yet: Bybit demo mutations and ROI parity with the Bybit app, real glasses, a real Telegram bot.

## Limitations
- Testnet/demo only by design; do not point `BYBIT_BASE` at a live host.
- Known limits are `shortcut:` comments in the code (first page of open orders, Bybit's default stop trigger when the stop order is not listed, a 60 s block after an unknown result, history paging by millisecond, and others).
- `VITE_APP_TOKEN` is dev only: never set it for a build you share.
- Voice audio goes to OpenAI only after a tap.
- The packaged app has no Vite proxy: put the server's https origin in `app/app.json` before `npm run pack`.

## Next steps
Run every mutation on Bybit Demo and compare ROI with the Bybit app (architecture §13 step 4); try real glasses (redraw time vs `CARD_SETTLE_MS`, R1 input); link a real Telegram bot; WebSocket fills when polling turns out too slow.
