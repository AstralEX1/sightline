# Trade Shortcuts on Even Hub

**Bybit alerts and confirmations on G2**

| Listing field | Value |
| --- | --- |
| Name | Trade Shortcuts |
| Package ID | `com.tradeshortcuts.g2` |
| Version | 0.1.5 |
| Language | English |
| Suggested tags | Trading, Bybit, Alerts |

| Material | Link |
| --- | --- |
| Interactive demo | [Paper BTC liquidation scenario](https://trade-shortcuts-pi.vercel.app/sandbox/#liquidation) |
| Physical G2 | [Beta installation and testing](judge-testing.md) |
| Project site | [Trade Shortcuts](https://trade-shortcuts-pi.vercel.app/) |

## About this plugin

When a price reaches your target or a position gets close to liquidation, see the alert on your Even G2. Set the rule on your phone and choose how to respond on the glasses.

**Build a shortcut.** Pick a template or create your own rule. Get a price alert, set a stop loss or prepare to close part of a position.

**Check your positions.** The G2 lists each open position with its size, price, return and distance to liquidation. Tap a row for PnL, leverage and the last hour of prices.

**Review and respond.** See why the rule fired and the exact quantity or price of the proposed order. Swipe to choose and tap to confirm or dismiss. The result appears on G2 and in phone History.

**Get started.** Try the paper scenario in your browser or connect the plugin to a Trade Shortcuts server with a paper account, Bybit Demo Trading or Bybit Testnet. Alerts appear while the plugin is open on G2. Optional voice replies require server transcription.

## What’s new in 0.1.5

Improved recognition of spoken close requests from the position screen. Choose **Speak** and say “close” to open a proposal with **Dismiss** selected.

## Assets and permissions

- [24 × 24 monochrome icon](../assets/even-hub-icon.png) and [grayscale cover](../assets/even-hub-cover.png).
- [Privacy policy](https://trade-shortcuts-pi.vercel.app/privacy.html) covers the server connection, local settings, account history, and optional G2 microphone and transcription. The two requested permissions are declared in [app.json](../app/app.json).

## Reviewer walkthrough

Use the [paper walkthrough](judge-testing.md#even-hub-beta). Provide the reviewer with access to the paper backend through an approved private channel. Check that the installed build is the intended version and that the account shows **Paper** or **Demo data** before confirming an action.

On G2 with the phone locked, verify launch from the glasses menu, the connection test, a paper alert and confirmation, and the result on G2 and in History. Leave the phone locked for five minutes and check that the lens still responds. Double tap on the root screen, confirm the system exit, and launch Conversate without restarting the glasses. Test interrupted voice separately against a paper server with transcription enabled.

Record the app and phone versions, G2 firmware, input device, and results before submitting a version for public review. [Even Hub QA guidelines](https://hub.evenrealities.com/docs/ship/app-submission)

## App screenshots

Current screens from the [landing](https://trade-shortcuts-pi.vercel.app/). Lens frames are the gallery files. Phone frames are the shortcut list and the template list.

### G2

**Open positions**

![Bybit Demo list: BTC long, ETH short and SOL long, with price, return and distance to liquidation](../site/landing/img/hud/positions.png)

**Position detail**

![BTC long detail: 0.05 BTC at 10×, PnL −$10, liquidation distance and the last hour of price](../site/landing/img/hud/position-detail.png)

**Liquidation**

![BTC long 3.2% from liquidation, Close 50% of 0.025 BTC selected](../site/landing/img/hud/liq.png)

**Loss**

![BTC long ROI −18.2%, Add 100 USDT margin selected](../site/landing/img/hud/loss.png)

**Near the stop**

![XRP long 0.9% from its stop, Dismiss selected](../site/landing/img/hud/nearstop.png)

**Take profit**

![ETH short 0.8% from take profit, Close 50% of 0.6 ETH selected](../site/landing/img/hud/tp.png)

**Profit**

![ETH short ROI +31.4%, Move stop to entry at 3,412 selected](../site/landing/img/hud/profit.png)

**Price level**

![BTC crossed above 90,000, OK selected](../site/landing/img/hud/plevel.png)

**Price move**

![ETH long up 5.1% in 15 minutes, OK selected](../site/landing/img/cards/pchange.jpg)

**Order filled**

![SOL long filled at 182.40, Set take profit at 191.52 selected](../site/landing/img/hud/filled.png)

**Partial fill**

![BTC buy order 0.010 of 0.025 filled, Cancel the rest of 0.015 BTC selected](../site/landing/img/cards/partial.jpg)

**Protect all**

![SOL long, set stop at 178.75, proposal 1 of 3](../site/landing/img/cards/voice1.jpg)

![ETH short, set stop at 3,162, proposal 2 of 3](../site/landing/img/cards/voice2.jpg)

### Phone

| Shortcuts | Templates |
| --- | --- |
| [![Shortcut tiles: set stop, move stop, close position and notify, each with an on or off switch](../site/landing/img/app/home.jpg)](../site/landing/img/app/home.jpg) | [![Templates grouped under Protect, Take profit and Market](../site/landing/img/app/templates.jpg)](../site/landing/img/app/templates.jpg) |
