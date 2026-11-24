# Sightline: handoff

## Purpose
A trading session on Even Realities G2 glasses: day PnL, open positions, and one-tap YES / NO cards raised by rules the user sets (daily loss limit, liquidation distance, stop loss, lock profit, price alerts). Voice shortcuts are optional. Exchange: Bybit **testnet/demo only**; a built-in fake exchange is the default.

## Architecture
- `server/` (Node, no framework): holds the exchange keys and the rules.
  - `src/main.ts` entry: reads env, picks the exchange, polls every 2 s, serves the HTTP API.
  - `src/rules.ts` pure rule engine (`evaluate`, `shortcutCards`, `voiceCards`).
  - `src/session.ts` ticks the exchange, keeps cards, toasts and fired-rule state.
  - `src/http.ts` the `/api/*` routes, bearer-token guarded. `src/config.ts` validates and stores user config (`server/data/config.json`, git-ignored).
  - `src/bybit.ts` signed Bybit client; `assertTestnet` refuses non-testnet hosts. `src/fake-exchange.ts` demo data. `src/stt.ts` speech to text via OpenAI (only when `OPENAI_API_KEY` is set).
- `app/` (Vite + Even Hub SDK): the glasses app and the phone page. `src/view.ts` builds the 5-row screen, `src/main.ts` wires the SDK, `src/alerts.ts` and `src/shortcuts.ts` parse the settings text. `src/storage.ts` keeps the server address and token in the Even bridge's storage (the WebView's localStorage is wiped on restart; the browser copy is only a fallback). `src/lifecycle.ts` handles the exit dialogue's inverted foreground events and the firmware's duplicate ones. `app.json` is the Even Hub manifest.

## Design
Why the screens look and read the way they do, and the 30-second demo: `docs/design.md`.

## Commands
```
cp .env.example .env     # set APP_TOKEN (16+ chars): openssl rand -hex 16
npm install
npm run server           # API on 127.0.0.1:8787
npm run dev              # app on :5173
npm run sim              # glasses simulator
npm run qr               # QR to load on real glasses (same Wi-Fi)
npm run typecheck && npm test && npm run build
```
Needs Node >= 22.18 (runs `.ts` directly). CI: `.github/workflows/test.yml` runs typecheck, tests and build.

## Tests
`npm test`: 154 tests under `server/test` and `app/test`, all passing when this was written, as were `npm run typecheck`, `npm run build` and `npm run pack`.

## Current state
Version 0.1.0. Works end to end against the fake exchange; the Bybit path targets testnet. Not verified on real glasses by this handoff.

## Limitations
- Testnet/demo only by design; do not point `BYBIT_BASE` at a live host.
- Shortcuts are marked in the code with `shortcut:` comments (for example the character-width line budget in `app/src/view.ts` and the toast flood limit in `server/src/session.ts`).
- `VITE_APP_TOKEN` is dev only: never set it for a build you share.
- Voice audio goes to OpenAI only after a tap.
- Double tap: with a card pending it answers "Not now"; on the calm screen it opens the host's exit dialogue (Even Hub review requires that on the root page). The storage and exit-dialogue behaviour follow community notes (nickustinov/even-g2-notes, measured on SDK 0.0.13) and are not verified on real glasses with SDK 0.0.16.

## Next steps
Measure redraw time on real glasses and tune the fixed value in `app/src/main.ts`; try the Bybit testnet path with real testnet keys; package with `npm run pack` (`*.ehpk` is git-ignored). Before that, put the https origin of your server in `app/app.json` (permissions, network, whitelist): the phone cannot reach `localhost`, and the packaged app has no Vite proxy, so it calls the server address typed on the phone page directly. The server already answers CORS.
