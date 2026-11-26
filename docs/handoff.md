# Trade Shortcuts handoff

## Current build

The phone editor, G2 client and Bybit adapter share one rule catalog. It has 13 conditions, 10 actions, six scopes and 12 templates in Protect, Take profit, Market and Orders. The two starter rules on a fresh server close half near liquidation and move a profitable position’s stop to entry. The menu also uses seeded rules for Protect all, Lock profits and Close.

The phone opens a template as an unsaved When/Do rule. Save it, then enable it on Home. On the lens, an actionable alert starts on Dismiss. For Open long or Open short with alternative sizes or leverages, the user picks the terms by hand and reviews the exact order. Other eligible cards support a spoken yes or no when transcription and voice answers are enabled. A yes starts a five-second cancellation window.

Settings in the Even app can send a connection check to the lens in the same session. The phone reports success after a tap on the TEST card. Quiet mode shows connection status and the nearest liquidation risk between alerts. History opens each record to show the proposed terms, execution outcome, and position readback when recorded. The landing page links directly to the beta installation steps.

## Running each version

| Target | Entry point | Account and storage |
|---|---|---|
| Desktop Even Hub simulator | `npm run demo` | Fake exchange, in-memory database, loopback proxy. No external service needed. |
| Persistent local server | `npm ci`, configure from `.env.example`, then `npm run server`, `npm run dev` and `npm run sim` in separate terminals | Fake by default. `EXCHANGE=bybit` selects Demo or Testnet. One account per process. SQLite file in `server/data/` per mode. |
| Browser sandbox and landing demo | `npm run sandbox` or `npm run build:site` | Real phone/lens code, local bridge, rule engine, FakeExchange and in-memory sql.js store. Switching scenarios resets the account. |
| Installed G2 app | `npm run pack -- https://your-backend.example` | The first HTTPS origin is the default server. Additional origins are allowlisted. Enter the access token under Settings → Connection. |

[Setup, QR preview and packaging](setup.md) · [Server and REST API](shortcuts-architecture.md) · [Phone](trade-shortcuts-spec.md) · [Lens](glasses-shortcuts.md) · [UI test plan](ui-test-plan.md) · [Deployment](deployment.md)

## Verification and release history

- The G2 connection check, Quiet mode, and History changes passed typecheck and all 593 automated tests. The app, landing page, and browser sandbox built successfully. The browser simulator confirmed the TEST card, opened the position list from Quiet mode, and recorded a simulated close from 0.050 to 0.025 BTC in History. Physical G2/R1 verification is pending.
- Working tree based on `f5a7e38`, including local server changes, 25 November 2026. With Node 22.23.4, typecheck and all 587 automated tests passed (zero skipped). The app, landing page, browser sandbox and a test `.ehpk` built in an isolated copy with a placeholder HTTPS origin.
- Even Hub lists `com.tradeshortcuts.g2` version `0.1.0` as Private on the beta channel (25 November). The working manifest now declares `0.1.1`. A byte comparison matched the portal download to the local submission package. Use the portal build record and package digest to identify this beta.
- Recorded on 24 November 2026 on Bybit testnet (XRPUSDT): open, duplicate `orderLinkId` refused (110072), set SL/TP each keeps the other, SL past mark rejected, limit order listed and cancelled, reduce-only half and oversize close (no flip), fills deduped by `execId`, add margin on isolated (110076 on cross, as expected). A real Telegram bot linked via `/start <code>` and delivered an alert.

## Open checks

Verify ROI against the Bybit app in the supported margin modes. The implementation uses `100 × unrealisedPnl / positionIM`. Physical G2/R1 input, chart readability and transfer time, background/resume, voice cancellation and installation against the intended server need device evidence. The earlier testnet and Telegram run covered the operations listed above.

The [Even Hub privacy draft](privacy.html) includes the public support contact. Before submitting it to Even Hub, fill in the hosted backend origins and the operator's retention and deletion process.
