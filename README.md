# Trade Shortcuts · Rules for Bybit on Even G2

Trading rules you build on your phone, answered on your glasses.

A shortcut is one sentence: **apply to** one scope, **when** one or more conditions joined by one `and` / `or`, **do** exactly one action.
"All positions · when liquidation distance is below 5% or ROI is below −20% · close 50%."
The server watches Bybit every 2 seconds. When a shortcut fires it raises an alert and, for a trade, one exact proposal ("Close 50% · 0.025 BTC"). The proposal shows on the G2 lens with `Dismiss` first. Nothing reaches the exchange until you tap the action on the glasses.

Bybit **demo / testnet only**: the server refuses any other host at startup. A built-in demo exchange runs without keys.

## What it does

- **Phone (Even Hub app page)**: your shortcuts as tiles with an on/off switch, 25 templates, an editor that only offers compatible choices and marks the row that is not, a test alert, History with every alert's last status, Settings (Bybit key rights, notifications, Telegram, cooldown and expiry).
- **Lens**: positions with ROI and the one flag that matters (`liq 4.1%`, `no stop`); an alert names the position, the strongest reason and the exact command; Review before any Open or Increase; the real result from the exchange (Sent → Filled / Partly filled / Rejected / Unknown).
- **Voice**: any shortcut can carry a phrase. Tap the lens and say "protect all" or "lock profits": the shortcut raises its proposals at once; each still needs its own tap.
- **Telegram**: when the glasses are off, alerts go to a linked chat as plain text. Telegram can never confirm a trade.

14 conditions (price, price change, volume spike, funding, profit, loss, liquidation, stop and take-profit distance, missing stop, closed by stop / take profit / liquidation, order filled, partly filled, order open too long) × 9 actions (close, move stop, set stop, set take profit, add margin, open, increase, cancel order, notify), checked by three compatibility tables.

## Safety model

- Every exchange write is a proposal the user authorizes on the lens: `confirm(proposalId, idempotencyKey)`. A second tap, a resend or two taps at once return the same execution; the proposal is consumed before the first network call.
- Terms are resolved once (qty, stop price, margin) and never adjusted silently. A confirm rechecks fresh exchange state; if the terms changed, a new proposal replaces the old one (`NEW` on the lens) and the old tap does nothing.
- Unknown results (timeout, 5xx, Bybit 10000/10016) are never retried blindly; the position is blocked until Bybit settles it (orders, stops and cancels are looked up 30 s later). An unknown add margin has nothing to look up: it blocks only another add margin until the position closes, a Close still goes out.
- Stops only tighten and must sit behind the price; a close never exceeds one market order; Open needs the leverage you set; Add Margin needs isolated margin.
- Test alerts are simulated end to end and cannot reach the exchange adapter.
- Bybit keys, the OpenAI key and the Telegram bot token stay on the server. The phone stores its server access token in Even Hub storage, with local storage as a browser fallback. The exchange adapter supports demo/testnet trading only and exposes no transfers or withdrawals.

## Run the demo

Needs Node ≥ 22.18.

```bash
npm install
```

```bash
cp .env.example .env
```

Set `APP_TOKEN` in `.env` (16+ characters, e.g. `openssl rand -hex 16`). Leave `EXCHANGE=fake` for the demo exchange (BTC isolated long sliding toward liquidation, ETH short without a stop, SOL long in profit).

```bash
npm run server
```

```bash
npm run dev
```

```bash
npm run sim
```

Open http://localhost:5173 for the phone page (type the server token once in Settings › Connection, or set `VITE_APP_TOKEN` for local dev only). Add a template such as **Close Position · Near liquidation · half** or **Set Stop Loss · No stop loss**, switch it on, and watch the alert appear on the simulated lens. Tap the action to send it to the demo exchange; History shows the result.

`npm run screens` takes lens screenshots on demo data (Main, Detail, the next positions) into `screens/`, on its own ports and without Telegram, so a running server is not touched. It needs `VITE_APP_TOKEN` in `.env`.

For QR preview on G2, pair the glasses and update their firmware. Sign in to Even Hub with the same account as the phone app, then restart the phone app to get Developer Mode. Keep the phone and laptop on the same Wi-Fi. Start Vite with `npm run dev -- --host`, then run `npm run qr` on macOS and scan from the Even app. Keep `VITE_APP_TOKEN` empty for LAN preview and enter the server token under Settings › Connection. [Even Hub hardware setup](https://hub.evenrealities.com/docs/get-started/quickstart/hardware)

Bybit demo or testnet: set `EXCHANGE=bybit`, `BYBIT_BASE`, `BYBIT_API_KEY`, `BYBIT_API_SECRET`. Voice: `OPENAI_API_KEY`. Telegram: `TELEGRAM_BOT_TOKEN`, then Settings › Telegram › Connect.

To build an installable package, run `npm run pack -- https://your-backend.example` with the HTTPS origin that serves your `/api`. Packaging sets the default backend and allowlists that exact origin. After installation, enter the server token under Settings › Connection.

## Architecture

One Node process, no framework, built-in `node:sqlite`, REST polling (`docs/shortcuts-architecture.md`).

| File | Role |
|---|---|
| `server/src/registry.ts` | rule model, condition and action catalog, the three compatibility tables, templates, voice seeds |
| `server/src/validate.ts` | the one validator for create, edit, enable and the editor (structured issues pointing at a row) |
| `server/src/engine.ts` | pure four-valued evaluator (TRUE / FALSE / UNKNOWN / NOT APPLICABLE), trigger policies with hysteresis, price windows warmed from 1-minute candles |
| `server/src/session.ts` | the 2 s poll → per-target facts, position epochs, alerts and proposals, the lens state |
| `server/src/proposals.ts` | resolves an action to one exact command and guards it; the words the lens and History print |
| `server/src/execute.ts` | confirm, per-position serialization, submit once, reconcile from fills and positions |
| `server/src/store.ts` | SQLite: shortcuts with immutable versions, trigger and target state, alerts, proposals, executions, outbox, audit log |
| `server/src/notify.ts` | delivery to lens, phone app and Telegram (`getUpdates` linking, no webhook) |
| `server/src/bybit.ts` · `fake-exchange.ts` | signed Bybit V5 client (testnet/demo guard, rate-limit resend with the same `orderLinkId`) and its deterministic twin |
| `server/src/http.ts` | the `/api` routes behind a bearer token |
| `app/src/phone/` | the phone page |
| `app/src/view.ts` · `main.ts` | the lens screens and the Even Hub SDK wiring |

## Checks

```bash
npm run typecheck && npm test && npm run build
```

Specs: `docs/shortcuts-architecture.md` (server), `docs/trade-shortcuts-spec.md` (phone), `docs/glasses-shortcuts.md` (lens), `docs/design.md`.

## For agents picking this up

Start with `docs/handoff.md`: purpose, sources of truth, commands, current state and next steps. Rules that hold everywhere:

- Never point `BYBIT_BASE` at a live host; `config.ts` refuses it on purpose, keep that guard.
- Every exchange write goes through a proposal and `confirm` on the lens; do not add a path that trades without that tap (Telegram and test alerts included).
- The rule catalog and validator (`registry.ts`, `validate.ts`) are shared by phone and server; change them once, not in two places.
- Run `npm run typecheck && npm test && npm run build` before you commit. Never commit `.env` or `server/data/`.

## Known limits

- Tried against the demo exchange and the simulator; every mutation ran on Bybit testnet and a real Telegram bot delivered an alert; ROI parity with the Bybit app and real glasses still need a run.
- One account per server; REST polling (WebSockets are the planned upgrade when fills arrive too late).
- Every other known limit is a `shortcut:` comment in the code.

Trade Shortcuts never gives advice. Every alert comes from a rule you wrote.
