# Trade Shortcuts on Even Hub

- **Package ID** `com.tradeshortcuts.g2`
- **Name** Trade Shortcuts
- **Tagline** Bybit alerts and confirmations on G2
- **Language** English
- **Suggested tags** Trading, Bybit, Alerts

## Description

Build a trading rule on your phone. When it triggers, Trade Shortcuts shows the position, the reason and the proposed action on your G2. Swipe to review, tap to confirm, and see the result on the lens and in phone History.

Start with a paper account, or connect a Trade Shortcuts server configured for Bybit Demo Trading or Testnet. The server keeps watching the rules, and the lens shows alerts while the app is open. Voice answers are optional and require transcription on the server.

## Assets and permissions

- [24 × 24 monochrome icon](../assets/even-hub-icon.png) and [grayscale cover](../assets/even-hub-cover.png).
- Simulator captures for the listing: [Position detail](../assets/lens-detail.jpg), [Liquidation alert](../assets/lens-alert.jpg) and [Paper fill](../assets/lens-fill.jpg).
- [Privacy policy](https://trade-shortcuts-pi.vercel.app/privacy.html) covers the server connection, local settings, account history, and optional G2 microphone and transcription. The two requested permissions are declared in [app.json](../app/app.json).

## Reviewer walkthrough

Use the [paper walkthrough](judge-testing.md#even-hub-beta). Provide the reviewer with access to the paper backend through an approved private channel. Check that the installed build is the intended version and that the account shows **Paper** or **Demo data** before confirming an action.

On G2 with the phone locked, verify launch from the glasses menu, the connection test, a paper alert and confirmation, and the result on G2 and in History. Leave the phone locked for five minutes and check that the lens still responds. Double tap on the root screen, confirm the system exit, and launch Conversate without restarting the glasses. Test interrupted voice separately against a paper server with transcription enabled.

Record the app and phone versions, G2 firmware, input device, and results before submitting a version for public review. [Even Hub QA guidelines](https://hub.evenrealities.com/docs/ship/app-submission)
