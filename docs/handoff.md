# Trade Shortcuts handoff

## Current build

The phone editor, G2 client and Bybit adapter share one rule catalog. It has 13 conditions, 10 actions, six scopes and 12 templates in Protect, Take profit, Market and Orders. The two starter rules on a fresh server close half near liquidation and move a profitable position’s stop to entry. The menu also uses seeded rules for Protect all, Lock profits and Close.

The landing feed uses the brand green `#0b7a3b` for the emphasized words in each heading. Position screens are the current lens frames on the same photo background as the other alerts. Each alert section shows two lens cards. The landing does not show the phone History list.

The browser sandbox shows the glasses, the phone and the paper exchange on one stage. Playing a scenario dims the devices that are not the current step and flashes the shortcut's condition, then its action, on the phone. Eligible paper cards can be answered out loud: the browser recognizes yes or no, and a spoken yes still waits five seconds. Take half is the scenario that waits for the word. The other guided scenarios press Down and Click if nobody speaks. The sandbox does not call OpenAI.

The phone opens a template as an unsaved rule. Save it, then enable it on Home. On the lens, an actionable alert starts on Dismiss. For Open long or Open short with alternative sizes or leverages, the user picks the terms by hand and reviews the exact order. Other eligible cards support a spoken yes or no when transcription and voice answers are enabled. The microphone listens for ten seconds. A yes starts a five-second cancellation window.

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

- The sandbox answers eligible alerts by voice, and the glasses microphone listens for ten seconds. Typecheck passed and all 589 automated tests passed on 26 November 2026. The live browser microphone was not exercised.
- Version 0.1.5. Speak uses the server's close reading, and closing one position says "close position". Typecheck passed and all 586 automated tests passed on 26 November 2026.
- The position list and detail on the lens show the coin quantity (`0.05`, `1.2 ETH · 10×`). The landing gallery and position cards use those frames. The browser sandbox draws the same screen code.
- A missed paper alert no longer stays on Expired while the next card is already waiting, and it leaves the lens on its own after five seconds. A rounded close still says the rule's percent, with the smaller quantity in the note. Paper settings no longer describe a Bybit key, and spoken answers stay off when the server has no transcription. Voice commands are titled by their phrase. A browser tab that is not the simulator does not keep calling the glasses bridge or offer Send test to G2. The sandbox is three paper scenarios. Typecheck passed and all 586 automated tests passed on 26 November 2026.
- Typecheck and all 587 automated tests passed on 26 November 2026 after the sandbox playback highlight, and again after bringing main's voice cancellation and privacy page onto this branch. The landing price-level cards were refreshed in the same change.
- The G2 connection check, Quiet mode, and History changes passed typecheck and all 593 automated tests. The app, landing page, and browser sandbox built successfully. The browser simulator confirmed the TEST card, opened the position list from Quiet mode, and recorded a simulated close from 0.050 to 0.025 BTC in History. Physical G2/R1 verification is pending.
- Working tree based on `f5a7e38`, including local server changes, 25 November 2026. With Node 22.23.4, typecheck and all 587 automated tests passed (zero skipped). The app, landing page, browser sandbox and a test `.ehpk` built in an isolated copy with a placeholder HTTPS origin.
- Even Hub beta is `com.tradeshortcuts.g2` version `0.1.5` (26 November). It defaults to the hosted paper demo and also allowlists the private Bybit Testnet server. A tap on a position, or Speak then “close”, raises a close card that still starts on Dismiss. Package SHA-256 `aa05f2b4fc4193dbb4c964f651b86273deff55302175a58d620e2f1ef924ae17`. [Judge testing guide](judge-testing.md)
- The hosted API on the VPS serves the current server. Demo returns `Demo data` and the Bybit service returns `Bybit testnet`. Rollback copy of the previous sources: `/opt/trade-shortcuts/bak-20261126-1140`. Earlier databases: `/opt/trade-shortcuts/bak-20261126-0724`.
- Recorded on 24 November 2026 on Bybit testnet (XRPUSDT): open, duplicate `orderLinkId` refused (110072), set SL/TP each keeps the other, SL past mark rejected, limit order listed and cancelled, reduce-only half and oversize close (no flip), fills deduped by `execId`, add margin on isolated (110076 on cross, as expected).

- The hackathon paper demo starts with the BTC half-close rule only. Its card expires after 120 seconds and can recur while the rule matches. The official desktop simulator confirmed 0.025 BTC once from 0.050 BTC and showed a single fill in History. A separate run with a synthetic lost confirmation reply recovered the execution by a read-only request. The app, landing, and sandbox built successfully and 589 automated tests passed.

## Open checks

Verify ROI against the Bybit app in the supported margin modes. The implementation uses `100 × unrealisedPnl / positionIM`. Physical G2/R1 input, chart readability and transfer time, background/resume, voice cancellation and installation against the intended server need device evidence. The earlier testnet run covered the operations listed above.

The [Even Hub privacy policy](https://trade-shortcuts-pi.vercel.app/privacy.html) describes the Beta backends and the app permissions. [Store assets and reviewer walkthrough](store-listing.md)
