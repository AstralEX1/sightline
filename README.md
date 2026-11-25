# Trade Shortcuts · Rules for Bybit on Even G2

Trading rules you build on your phone, answered on your glasses.

## Heads Up hackathon demo

**Track:** Exchanges & Stocks · Bybit. A Bybit derivatives trader away from the phone can miss a position approaching liquidation. Trade Shortcuts shows which position crossed the trader’s own threshold, how much a proposed action would change it, and whether the exchange filled it. [Short submission description](docs/dorahacks.md)

- **Open in a browser:** [Interactive paper sandbox](https://trade-shortcuts-pi.vercel.app/sandbox/) · [Project site](https://trade-shortcuts-pi.vercel.app/).
- **Watch:** [27-second G2 demo clip](showcase/lens-alert-tap.mp4). A Bybit Demo BTC position triggers a liquidation-distance alert. Swipe to **Close 50%**, tap, and see the fill on the lens.
- **Try it:** [Run the demo](#run-the-demo) with the Even Hub simulator and the built-in paper exchange. You can try the phone and lens flow without G2 hardware or an exchange account.
- **See the screens:** [Phone rule editor](showcase/09-phone-editor.png) · [Lens alert](showcase/03-lens-alert-liquidation.jpg) · [Execution result](showcase/06-lens-closed.jpg) · [Phone history](showcase/10-phone-history.png).

## What existed before November 23

The team brought no pre-existing application code into the hackathon. The project history starts on November 24, 2026. The hackathon commits introduce the phone rule editor, rule engine, Bybit V5 adapter, deterministic paper exchange, proposal and confirmation flow, and G2 screens. The [first project commit](https://github.com/AstralEX1/trade-shortcuts/commit/5aee0bd) and subsequent commits show the build sequence.

We used the existing Even Hub SDK, Pretext, simulator and CLI, Bybit V5, Node.js, SQLite, TypeScript and Vite. Optional integrations use OpenAI transcription and the Telegram Bot API. The PNG and wear-state helpers and simulator capture workflow draw on [Market Glimpse](https://github.com/adamtorgerson/market-glimpse). The upstream repository does not currently list a project license. The phone UI uses [Inter](https://rsms.me/inter/) and [Phosphor Icons](https://phosphoricons.com/). The separate browser sandbox uses sql.js and [credited stock footage](site/sandbox/public/media/CREDITS.md).

## How it works

A shortcut is one sentence: **apply to** one scope, **when** one or more conditions joined by one `and` / `or`, **do** exactly one action.
"All positions · when liquidation distance is below 5% or ROI is below −20% · close 50%."
The server watches Bybit every 2 seconds. When a shortcut fires it raises an alert and, for a trade, one exact proposal ("Close 50% · 0.025 BTC"). The proposal shows on the G2 lens with `Dismiss` first. Tap the action to confirm. With voice answers enabled and transcription configured, a spoken “yes” also authorizes the proposal after a five-second cancellation window.

Bybit **demo / testnet only**: the server refuses any other host at startup. A built-in demo exchange runs without keys.

## What it does

- **Phone (Even Hub app page)**: your shortcuts as tiles with an on/off switch, 25 templates, an editor that only offers compatible choices and marks the row that is not, a test alert, History with every alert's last status, Settings (Bybit key rights, notifications, Telegram, cooldown and expiry).
- **Lens**: positions with ROI and the one flag that matters (`liq 4.1%`, `no stop`); an alert names the position, the strongest reason and the exact command; Review before any Open or Increase; the real result from the exchange (Sent → Filled / Partly filled / Rejected / Unknown).
- **Voice**: the G2 mic listens briefly when an actionable alert appears and voice answers are enabled. The server sends the audio to OpenAI for transcription. A “no” dismisses the alert. During the countdown after “yes”, a gesture or a spoken “no” cancels. The paper demo runs with voice off.
- **Telegram**: when the glasses are off, alerts go to a linked chat as plain text. Telegram can never confirm a trade.

14 conditions (price, price change, volume spike, funding, profit, loss, liquidation, stop and take-profit distance, missing stop, closed by stop / take profit / liquidation, order filled, partly filled, order open too long) × 9 actions (close, move stop, set stop, set take profit, add margin, open, increase, cancel order, notify), checked by three compatibility tables.

## Safety model

- Every exchange write is a proposal the user authorizes on the lens: `confirm(proposalId, idempotencyKey)`. A second tap, a resend or two taps at once return the same execution; the proposal is consumed before the first network call.
- Terms are resolved once (qty, stop price, margin) and never adjusted silently. A confirm rechecks fresh exchange state; if the terms changed, a new proposal replaces the old one (`NEW` on the lens) and the old tap does nothing.
- Unknown results (timeout, 5xx, Bybit 10000/10016) are never retried blindly; the position is blocked until Bybit settles it (orders, stops and cancels are looked up 30 s later). An unknown add margin has nothing to look up: it blocks only another add margin until the position closes, a Close still goes out.
- Stops only tighten and must sit behind the price; a close never exceeds one market order; Open needs the leverage you set; Add Margin needs isolated margin.
- Test alerts are simulated end to end and cannot reach the exchange adapter.
- Trade Shortcuts holds no user funds and provides no financial advice. Bybit keys, the OpenAI key and the Telegram bot token stay on the server. The phone stores its server access token in Even Hub storage, with local storage as a browser fallback. The exchange adapter supports demo/testnet trading only and exposes no transfers or withdrawals.

## Run the demo

One command, from nothing to the simulator. Needs [Node.js 22.18+](https://nodejs.org) and git; macOS, Linux or Windows.

```bash
git clone https://github.com/AstralEX1/trade-shortcuts.git && cd trade-shortcuts && npm run demo
```

`npm run demo` installs the locked dependencies and starts a fresh in-memory paper account with BTC, ETH and SOL positions. It needs a desktop session and free local ports 5173, 8788 and 9898. The phone page connects automatically through the local proxy. Bybit, voice transcription and Telegram are disabled for this run. Ctrl+C stops the demo and discards its paper history.

Two windows open: **Browser** is the phone page, **Glasses Display** is the G2 lens (Up, Down, Click, Double Click stand in for the touchpad).

1. The lens lists the demo positions.
2. About 30 seconds after start, the **Near liquidation · half** shortcut raises a BTC alert on the lens. If another alert is showing, Click **Dismiss** first.
3. Press **Down** to reach **Close 50%** and **Click** to confirm. The lens shows the fill.
4. On the phone page, open **History** (clock icon) for the paper trade.

For a persistent account or optional integrations, run the services separately: `npm ci`, `cp .env.example .env`, set `APP_TOKEN` (16+ characters, e.g. `openssl rand -hex 16`), then `npm run server`, `npm run dev`, `npm run sim` in three terminals, in that order. Enter the token on the phone page under **Settings → Connection**, or set `VITE_APP_TOKEN` to the same value.

`npm run screens` takes lens screenshots on demo data (Main, Detail, the next positions) into `screens/`, on its own ports and without Telegram, so a running server is not touched. It needs `VITE_APP_TOKEN` in `.env`.

For QR preview on G2, pair the glasses and update their firmware. Sign in to Even Hub with the same account as the phone app, then restart the phone app to get Developer Mode. Keep the phone and laptop on the same Wi-Fi. Start Vite with `npm run dev -- --host`, then run `npm run qr` on macOS and scan from the Even app. Keep `VITE_APP_TOKEN` empty for LAN preview and enter the server token under Settings › Connection. [Even Hub hardware setup](https://hub.evenrealities.com/docs/get-started/quickstart/hardware)

Bybit demo or testnet: set `EXCHANGE=bybit`, `BYBIT_BASE`, `BYBIT_API_KEY`, `BYBIT_API_SECRET`. Voice: `OPENAI_API_KEY`. Telegram: `TELEGRAM_BOT_TOKEN`, then Settings › Telegram › Connect.

To build an installable package, run `npm run pack -- https://your-backend.example` with the HTTPS origin that serves your `/api`. Packaging sets the default backend and allowlists that exact origin. Pass more origins after it (for example a demo server and a Bybit testnet server) to allowlist them too; the first stays the default. After installation, enter the server token under Settings › Connection.

## Website and interactive sandbox

The [site directory](site/) contains the landing page and browser demo. The sandbox runs the app, rule engine and paper positions in the browser. For the official Even Hub simulator, use `npm run demo` above.

From the repository root, run `npm ci` and `npm run build:site`. The static site is ready to serve from `site/landing/`, including the generated `sandbox/` route. For example, run `python3 -m http.server 8080 --bind 127.0.0.1 --directory site/landing` and open http://localhost:8080. To develop the sandbox, use `npm run sandbox`.

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

Read [`AGENTS.md`](AGENTS.md): how to run and check the demo without a human, and the rules that hold everywhere.

## Known limits

- The judging flow uses paper data in the Even Hub simulator. Earlier Bybit testnet and Telegram checks are recorded in [the handoff](docs/handoff.md). Physical G2 behavior and ROI parity with the Bybit app still need verification.
- One account per server; REST polling (WebSockets are the planned upgrade when fills arrive too late).
- Every other known limit is a `shortcut:` comment in the code.

Trade Shortcuts never gives advice. Every alert comes from a rule you wrote.
