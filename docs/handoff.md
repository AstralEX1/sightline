# Trade Shortcuts handoff

## Current build

The phone editor, G2 client and Bybit adapter share one rule catalog. It has 13 conditions, 10 actions, six scopes and 12 templates in Protect, Take profit, Market and Orders. The two starter rules on a fresh server close half near liquidation and move a profitable position’s stop to entry. The menu also uses seeded rules for Protect all, Lock profits and Close.

The landing feed uses the brand green `#0b7a3b` for the emphasized words in each heading. Position screens are the current lens frames on the same photo background as the other alerts. Each alert section shows two lens cards. The landing does not show the phone History list.

The browser sandbox keeps all four scenario tabs and shows the templates in the phone preview. Its guided flow uses glasses gestures without voice input. The spotlight travels between the phone, market and glasses, and an amber frame marks a position before it changes and stays briefly afterward. When a demo ends, the stage notes clear and the practice prompt remains. The phone editor keeps its Add shortcut action visible while the fields scroll. The sandbox does not call OpenAI.

The phone opens a template as an unsaved rule. Save it, then enable it on Home. On the lens, an actionable alert starts on Dismiss. For Open long or Open short with alternative sizes or leverages, the user picks the terms by hand and reviews the exact order. Other eligible cards support a spoken yes or no when transcription and voice answers are enabled. The microphone listens for ten seconds. A yes starts a five-second cancellation window.

Settings in the Even app can send a connection check to the lens in the same session. The phone reports success after a tap on the TEST card. On G2, Positions always on is off by default: the lens is blank between alerts and a tap opens positions. The browser Sandbox defaults this setting on. History opens each record to show the proposed terms, execution outcome, and position readback when recorded. The landing page links directly to the beta installation steps.

## Running each version

| Target | Entry point | Account and storage |
|---|---|---|
| Desktop Even Hub simulator | `npm run demo` | Fake exchange, in-memory database, loopback proxy. No external service needed. |
| Persistent local server | `npm ci`, configure from `.env.example`, then `npm run server`, `npm run dev` and `npm run sim` in separate terminals | Fake by default. `EXCHANGE=bybit` selects Demo or Testnet. One account per process. SQLite file in `server/data/` per mode. |
| Browser sandbox and landing demo | `npm run sandbox` or `npm run build:site` | Real phone/lens code, local bridge, rule engine, FakeExchange and in-memory sql.js store. Switching scenarios resets the account. |
| Installed G2 app | `npm run pack -- https://your-backend.example` | The first HTTPS origin is the default server. Additional origins are allowlisted. Enter the access token under Settings → Connection. |

[Setup, QR preview and packaging](setup.md) · [Server and REST API](shortcuts-architecture.md) · [Phone](trade-shortcuts-spec.md) · [Lens](glasses-shortcuts.md) · [UI test plan](ui-test-plan.md) · [Deployment](deployment.md)

## Verification and release history

- Current Sandbox guided alerts use the simulated glasses gestures: Down → Click for trade actions, Click for Notify. Sandbox does not request microphone access. All four scenario tabs are visible, the spotlight moves between screens, and position changes receive an amber pre-change highlight held for 0.5 seconds after the change. The practice prompt replaces the stage notes when a demo finishes.
- 27 November 2026, Sandbox UI follow-up: `git diff --check` passed. Automated tests and live browser/device walkthroughs were not run in this pass.

- Notify completes the sandbox walkthrough after OK. Manual steps follow the alert state, and Play acknowledges the rendered card when the scenario action is Notify. The scenario test covers acknowledgement on the paper exchange.

- The sandbox treats a spoken answer as a short command. The first final yes, no, or close is kept, a quiet mic cannot confirm, and “йес” or “da” still count. Typecheck passed and the sandbox voice tests passed on 27 November 2026. The live browser microphone was not exercised.
- Play no longer shifts the sandbox. A notify alert stores its action, and a simulated Notify card does not block the real one. Typecheck passed and all 593 automated tests passed on 26 November 2026. The app, landing page, and browser sandbox built.
- The sandbox answers eligible alerts by voice, and the glasses microphone listens for ten seconds. Typecheck passed and all 589 automated tests passed on 26 November 2026. The live browser microphone was not exercised.
- Version 0.1.5. Speak uses the server's close reading, and closing one position says "close position". Typecheck passed and all 586 automated tests passed on 26 November 2026.
- The position list and detail on the lens show the coin quantity (`0.05`, `1.2 ETH · 10×`). The landing gallery and position cards use those frames. The browser sandbox draws the same screen code.
- A missed paper alert no longer stays on Expired while the next card is already waiting, and it leaves the lens on its own after five seconds. A rounded close still says the rule's percent, with the smaller quantity in the note. Paper settings no longer describe a Bybit key, and spoken answers stay off when the server has no transcription. Voice commands are titled by their phrase. A browser tab that is not the simulator does not keep calling the glasses bridge or offer Send test to G2. The sandbox is three paper scenarios. Typecheck passed and all 586 automated tests passed on 26 November 2026.
- Typecheck and all 587 automated tests passed on 26 November 2026 after the sandbox playback highlight, and again after bringing main's voice cancellation and privacy page onto this branch. The landing price-level cards were refreshed in the same change.
- The G2 connection check, Quiet mode, and History changes passed typecheck and all 593 automated tests. The app, landing page, and browser sandbox built successfully. The browser simulator confirmed the TEST card, opened the position list from Quiet mode, and recorded a simulated close from 0.050 to 0.025 BTC in History. Physical G2/R1 verification is pending.
- Working tree based on `f5a7e38`, including local server changes, 25 November 2026. With Node 22.23.4, typecheck and all 587 automated tests passed (zero skipped). The app, landing page, browser sandbox and a test `.ehpk` built in an isolated copy with a placeholder HTTPS origin.
- Before the 0.1.6 release, Even Hub Beta `com.tradeshortcuts.g2` was version `0.1.5` (26 November). It defaults to the hosted paper demo and also allowlists the private Bybit Testnet server. A tap on a position, or Speak then “close”, raises a close card that still starts on Dismiss. Package SHA-256 `aa05f2b4fc4193dbb4c964f651b86273deff55302175a58d620e2f1ef924ae17`. [Judge testing guide](judge-testing.md)
- The hosted API on the VPS serves the current server. Demo returns `Demo data` and the Bybit service returns `Bybit testnet`. Rollback copy of the previous sources: `/opt/trade-shortcuts/bak-20261126-1140`. Earlier databases: `/opt/trade-shortcuts/bak-20261126-0724`.
- Recorded on 24 November 2026 on Bybit testnet (XRPUSDT): open, duplicate `orderLinkId` refused (110072), set SL/TP each keeps the other, SL past mark rejected, limit order listed and cancelled, reduce-only half and oversize close (no flip), fills deduped by `execId`, add margin on isolated (110076 on cross, as expected).

- The hackathon paper demo starts with the BTC half-close rule only. Its card expires after 120 seconds and can recur while the rule matches. The official desktop simulator confirmed 0.025 BTC once from 0.050 BTC and showed a single fill in History. A separate run with a synthetic lost confirmation reply recovered the execution by a read-only request. The app, landing, and sandbox built successfully and 589 automated tests passed.
- Positions always on now defaults off in G2 and on in Sandbox. Typecheck, all 602 automated tests, and app and Sandbox builds passed on 27 November 2026. The browser bridge check covered the blank default, tap to open, alert display, saved setting and Sandbox default.

## G2 startup and speech fixes for 0.1.6

The lens retries startup on reconnect or foreground entry, including a connection event during a failed first page creation. Speak interprets close commands, and a spoken answer stays tied to the alert that started its recording. Closing the system menu keeps recording open. Hiding the WebView, losing the device, or exiting still cancels voice. Phone banners page by timestamp and alert ID, with phone delivery filtered before the server applies its limit.

Typecheck passed; all 603 automated tests passed. SDK bridge fixtures verified the startup race, reconnect recovery, Speak during a system-menu transition, and alert-bound voice answers. The app, landing, sandbox and 0.1.6 package built successfully. Physical G2/R1 checks remain: reconnect, Speak, cancelling a spoken confirmation, microphone permission denial, and the five-minute lock check.

## Open checks

Verify ROI against the Bybit app in the supported margin modes. The implementation uses `100 × unrealisedPnl / positionIM`. Physical G2/R1 input, chart readability and transfer time, background/resume, voice cancellation and installation against the intended server need device evidence. The earlier testnet run covered the operations listed above.

The [Even Hub privacy policy](https://trade-shortcuts-pi.vercel.app/privacy.html) describes the Beta backends and the app permissions. [Store assets and reviewer walkthrough](store-listing.md)
