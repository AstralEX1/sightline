# Trade Shortcuts submission brief

Heads Up · **Track 03 · Exchanges & Stocks** · **Bybit V5 + Even Realities G2**

| Material | Link |
| --- | --- |
| Public source and setup | [GitHub](https://github.com/AstralEX1/trade-shortcuts) |
| Interactive demo | [Paper BTC liquidation scenario](https://trade-shortcuts-pi.vercel.app/sandbox/#liquidation) |
| Physical G2 | [Beta installation and testing](judge-testing.md) |
| Simulator clip | [27-second paper close](../assets/demo.mp4) |
| Project site | [Trade Shortcuts](https://trade-shortcuts-pi.vercel.app/) |

## Problem and approach

A Bybit derivatives trader can miss a position approaching liquidation while their phone is in their pocket. They set a threshold and an action on the phone. The G2 shows why the rule fired and the exact order size so the trader can dismiss or confirm it with a gesture. The glasses show the outcome and the phone records it in History.

The Bybit integration reads positions and submits confirmed orders in Demo Trading or Testnet. The judge walkthrough uses paper positions and needs no exchange account or funds. Trade Shortcuts holds no user funds.

## Requested API improvements

- **Even Hub SDK** could report when an update finishes rendering on the glasses so input and redraws can be paced without fixed delays.
- **Bybit V5** could expose the ROI shown in the Bybit app, including after isolated margin changes.
- **Bybit V5** could provide a client request ID and status lookup for isolated-margin adjustments so a timed-out write can be reconciled safely.

## App screenshots

| Phone | Simulated G2 |
| --- | --- |
| [Templates](../site/landing/img/app/templates.jpg) · [Rule editor](../assets/phone-editor.png) · [History](../assets/phone-history.png) | [Position detail](../assets/lens-detail.jpg) · [Liquidation alert](../assets/lens-alert.jpg) · [Paper fill](../assets/lens-fill.jpg) |

[Hackathon contribution and credits](../README.md#what-existed-before-november-23-2026) · [Official event](https://dorahacks.io/hackathon/even-realities/detail)
