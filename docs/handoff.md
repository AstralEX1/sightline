# Trade Shortcuts: handoff

## Purpose
Trade Shortcuts on Even Realities G2: the user builds rules on the phone page (one scope, conditions under one `and`/`or`, exactly one action); the server polls Bybit, raises alerts and exact trade proposals; every trade needs lens authorization by touch or a spoken yes with a cancellation countdown. Bybit **demo/testnet only**; a built-in demo exchange is the default. Overview and demo steps: `README.md`.

## Sources of truth
- Server, rule model, API: `docs/shortcuts-architecture.md` (§15 lists the product decisions: no Funding → Trading transfer, no daily loss limit or per-action cap, strict Set SL, voice phrases on shortcuts, phone delivery = in-app + Telegram).
- Phone page: `docs/trade-shortcuts-spec.md` v2.1 and its canvas.
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
npm run dev -- --host    # instead of plain dev for QR preview, with VITE_APP_TOKEN empty
npm run qr               # scan from Developer Mode, on the same Wi-Fi (macOS)
npm run typecheck && npm test && npm run build
```
Needs Node >= 22.18 (runs `.ts` directly; `node:sqlite` prints an ExperimentalWarning on Node 22). CI: `.github/workflows/test.yml`.

## Current state
Server: every endpoint of architecture §10, tested end to end against `FakeExchange` (duplicate and concurrent taps, ambiguous submits, supersede, expiry, simulated proposals, voice, hysteresis, crossings across a gap, kline warm-up, order fills, reconciliation). Phone page and lens built against it and checked in the browser and the Even Hub simulator. Lens Main has row `▶` + Detail (Weather layout, dotted PnL via `numeralPng`); Speak is on the menu. See the dated testnet and Telegram results below. ROI parity and physical glasses checks are pending.

## Limitations
- Testnet/demo only by design; do not point `BYBIT_BASE` at a live host.
- Known limits are `shortcut:` comments in the code (first page of open orders, Bybit's default stop trigger when the stop order is not listed, an unknown add margin blocking further add margin on its position until it closes (orders, stops and cancels settle from Bybit 30 s after the unknown result), history paging by millisecond, and others).
- `VITE_APP_TOKEN` is dev only: never set it for a build you share.
- With voice answers enabled and transcription configured, an actionable alert can open the mic automatically.
- Package with `npm run pack -- https://your-backend.example`. The origin becomes the default backend and the manifest's network whitelist entry.

## Next steps
The hackathon release includes the updated lens layout and position chart, the phone shortcut editor, and the landing page and simulator captures in `showcase/`. Release checks on 25 Nov 2026: `npm run typecheck`, `npm test` (555 passing), `npm --prefix site/landing run build`, and `npm run pack` with a test HTTPS origin. For a device build, pack again with the reachable backend origin. The physical G2/R1 checks are still pending.

Done 24 Nov 2026 on Bybit testnet (XRPUSDT): open, duplicate `orderLinkId` refused (110072), set SL/TP each keeps the other, SL past mark rejected, limit order listed and cancelled, reduce-only half and oversize close (no flip), fills deduped by `execId`, add margin on isolated (110076 on cross, as expected). A real Telegram bot linked via `/start <code>` and delivered an alert. Left: compare ROI with the Bybit app (ours is `unrealisedPnl / positionIM`; after an isolated add-margin `positionIM` grows by the added amount, so ROI halves, while entry value / leverage stays put; check which one the app shows); try real glasses (Detail numeral transfer, redraw time vs `CARD_SETTLE_MS`, R1 input); WebSocket fills when polling turns out too slow.
