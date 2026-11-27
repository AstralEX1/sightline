# Trade Shortcuts on the G2 lens

The phone configures rules. The lens displays positions, alerts, proposal terms and execution results. [Phone specification](trade-shortcuts-spec.md) · [Design](design.md)

Simulator captures: [position detail](../assets/lens-detail.jpg) · [alert](../assets/lens-alert.jpg) · [fill](../assets/lens-fill.jpg).

Status: built in `app/src/view.ts` + `app/src/main.ts` (Main with `▶`, Detail with the hour's chart, Alert, Review, Result). Every line below was measured with `@evenrealities/pretext` and fits its box. Nothing here was tried on real glasses yet.

## 1. What each screen answers

The glasses start with a clear display between alerts. Tap to open positions and check connection or data freshness. Double-tap from the list to return to the clear display, or from the clear display to open the host exit dialog. Enable **Positions always on** under Settings → On your glasses to keep the position list visible. The browser Sandbox defaults to **Positions always on**. Proposals and results appear in both modes.

| Screen | The one question | Answer on the lens | Next |
|---|---|---|---|
| Clear | Has anything triggered? | empty display between alerts | tap to open positions, double tap to exit |
| Main | How are my positions? | header-less table: position, price, ROI, a flag only when in trouble | swipe, tap, double tap |
| Detail | How is this position doing? | coin and side big, leverage under; PnL as big; stop and liquidation distance; the last hour with entry and stop named on it | swipe, tap, double tap |
| Alert | What fired, and what will a tap do? | framed notification with an icon, choices below the frame | swipe, tap |
| Review | What exactly am I opening? | qty, notional, leverage, margin, stop | swipe, tap |
| Result | Did it happen? | the exchange's real status | nothing, or OK |

The contextual menu offers Protect all, Lock profits and Pause/Resume cards. Main and Detail offer Close position for the position in focus; Main also offers Close all. Speak is in that menu when voice is on: “close”, “закрой”, or “close btc” raises that position’s card, and “close all” raises one card per position. A tap on Detail does the same as Close position. Each close is a card to confirm, with Dismiss first. Speech still answers the current alert when enabled.

## 2. Flow

```text
Clear ──tap──▶ Main ──tap──▶ Detail ──swipe──▶ next position's Detail
  ▲             └─double tap──▶ Clear
 ▲              ├─tap──▶ close card, Dismiss first, then the same path as an alert
 ▲              └─double tap──▶ Main, cursor on the same position
Main ──rule fires──▶ Alert ──tap action──▶ Sent ──▶ Filled / Rejected / Unknown ──OK──▶ next Alert or Main
                      │  └─tap Dismiss / double tap──────────────────────────────────▶ next Alert or Main
                      ├─ Open / Increase: tap "Review…" ──▶ Review ──tap action──▶ Sent
                      │    Open with several sizes or leverages: Size page ──tap──▶ Leverage page ──tap──▶ Review
                      │    (a list of one is skipped; double tap goes back one page)
                      │                                      └─double tap──▶ back to Alert on Dismiss, proposal still pending
                      └─ time runs out / position or rule changed ──▶ Expired (Dismiss only)
```

- One alert at a time. Queue order: Close → Set or Move stop → Add margin → Cancel order. Within that first group, Critical precedes Normal; ties follow action order, then age. Then Set take profit → Notify → Open and Increase, oldest first within each action group. The frame shows the place: `1/2`.
- A rule that matches several positions raises one alert per position, each naming its own position.
- OR rules raise one alert; the second line shows the strongest reason (liquidation beats ROI).
- A new alert ignores taps for 1 s (`CARD_SETTLE_MS`), so a tap meant for the previous one cannot answer it. `Dismiss` is first and selected anyway.
- Proposal expiry uses the server’s timing settings (defaults 30 s for market trades and 60 s for protection). On an eligible alert the microphone listens for ten seconds. A spoken yes shows a separate five-second cancellation countdown; a gesture or recognized no stops it.
- Alerts only reach the lens while the plugin is open. Otherwise delivery follows the in-app notification settings; an alert that expired meanwhile goes to History, never to the lens.
- **Send test to G2** in phone Settings brings up a separate `TEST` card once trading cards are clear. Tap **OK** on the lens to acknowledge it. The connection check expires after 90 seconds.

## 3. Gestures

| Input | Main | Detail | Alert | Review | Result |
|---|---|---|---|---|---|
| Swipe (temple or R1) | move `▶`; past the 5th row, next page | next or previous position | move `>` | move `>` | nothing |
| Tap | open Detail of the `▶` position | close this position | do the `>` item | do the `>` item | OK |
| Double tap | host exit dialog | back to Main | Dismiss | back to Alert | OK |

Open long and Open short carry the sizes (USDT) and leverages the user set on the phone. With more than one of either, `Review…` opens a size page, then a leverage page, in the Review frame: the two option rows show two values of the list, swipe scrolls `>` through all of them, the hint ends with the place (`2/5`), and the leverage page shows the margin of the value under `>`. The tap on the last page sends the pick; the server answers with a new proposal and the lens shows its Review. A voice yes does not answer an Open with choices.

The hint is the last line, dim, lower case, and says what a tap does on the choice under `>`: `swipe: choose · tap: dismiss`, then `tap: confirm` (or `tap: review`) once `>` is on the action. `double tap: exit` on Main and `double tap: back` on Detail always show, offline too. With a position on the list the hint also keeps `tap, hold: menu` (Close position is the first item; the hold does not close by itself). On Detail it keeps `tap: close`. The other tips (`tap: details`, `tap, hold: menu` when the list is empty, `swipe: next position` on Detail) are optional: on for the first 3 launches, then off, unless the phone's Settings › Gesture tips switch says otherwise. Alerts, Review and results always keep their line. A `>` left on an action goes back to Dismiss after 8 s without a swipe (`CURSOR_IDLE_MS`). An alert that fires while Detail is open takes over the lens; after it, the lens goes back to Detail. Tap then hold opens the command menu. Swipes are gated to one per 700 ms (`SWIPE_GATE_MS`). Taps while sending are ignored.

## 4. Layouts

Absolute pixels on an 8 px grid, 16 px edge inset, 27 px a text line, 4 px padding, corner radius 4. Brightness `textColor`: 4 primary and selected, 3 ordinary text, 2 hints and supporting values. `capture` is the one input container.

```yaml
main:            # text 8, image 0; no frames
  - {name: top,    type: text, x: 16,  y: 16,  w: 544, h: 32,  brightness: 3, capture: true}  # "Bybit Demo · 3 positions" … "14:05"; 4 when it carries a problem
  - {name: cur,    type: text, x: 16,  y: 56,  w: 232, h: 144, brightness: 4}                 # selected row: "▶ BTC long" and the size at the right ("0.05")
  - {name: name,   type: text, x: 16,  y: 56,  w: 232, h: 144, brightness: 3}                 # the other rows, indented under the cursor column, size included
  - {name: price,  type: text, x: 248, y: 56,  w: 128, h: 144, brightness: 3}                 # 61,240.5, left-aligned, no currency
  - {name: loss,   type: text, x: 376, y: 56,  w: 104, h: 144, brightness: 4}                 # ▼ 4.2% ROI; losses brighter than gains
  - {name: gain,   type: text, x: 376, y: 56,  w: 104, h: 144, brightness: 2}                 # ▲ 24.0%
  - {name: flag,   type: text, x: 480, y: 56,  w: 80,  h: 144, brightness: 4}                 # only trouble: "liq 5.9%" under 10%
  - {name: hint,   type: text, x: 16,  y: 248, w: 544, h: 32,  brightness: 2}
detail:          # text 3, image 4 (the limit); after the ticker apps: one big line, plain numbers, a plain chart
  - {name: title,  type: image, x: 16,  y: 12,  w: 288, h: 44}                                 # "BTC long", bold, as big as fits (titlePng)
  - {name: lev,    type: text, x: 16,  y: 56,  w: 272, h: 32,  brightness: 3}                 # 0.05 BTC · 10×; takes the input
  - {name: pnl,    type: image, x: 320, y: 12,  w: 240, h: 44}                                 # "PNL: −$26", same bold as the title
  - {name: table,  type: text, x: 320, y: 56,  w: 240, h: 32,  brightness: 3}                 # stop −1.9% · liq −4.0% (distance from the mark); nothing for a missing stop
  - {name: chart0, type: image, x: 16,  y: 96,  w: 272, h: 144}                                # the hour; entry dotted, stop dashed, each named with its price; time of the last candle (chartPng)
  - {name: chart1, type: image, x: 288, y: 96,  w: 272, h: 144}
  - hint                                                                                          # tap: close · double tap: back, and 2/3 at the right
alert:           # text 6, image 1
  - {name: frame,  type: text, x: 16,  y: 16,  w: 544, h: 96,  border: 2, radius: 4, brightness: 3}  # the notification
  - {name: icon,   type: image, x: 32, y: 40,  w: 48,  h: 48}                                 # what fired; text says it too
  - {name: who,    type: text, x: 96,  y: 32,  w: 384, h: 32,  brightness: 4}                 # BTC long
  - {name: why,    type: text, x: 96,  y: 64,  w: 384, h: 32,  brightness: 3}                 # 3.2% to liquidation
  - {name: queue,  type: text, x: 480, y: 24,  w: 72,  h: 32,  brightness: 2}                 # 1/2, empty when alone
  - {name: opt1,   type: text, x: 16,  y: 136, w: 544, h: 32,  brightness: 4, capture: true} # "> Dismiss"
  - {name: opt2,   type: text, x: 16,  y: 168, w: 544, h: 32,  brightness: 3}                 # "   Close 50% · 0.025 BTC"
  - {name: hint,   type: text, x: 16,  y: 248, w: 544, h: 32,  brightness: 2}
review:          # text 5, image 1
  - {name: frame,  type: text, x: 16,  y: 16,  w: 544, h: 112, border: 2, radius: 4, brightness: 3}
  - {name: icon,   type: image, x: 32, y: 48,  w: 48,  h: 48}
  - {name: ask,    type: text, x: 96,  y: 24,  w: 456, h: 32,  brightness: 4}                 # Open BTC long?
  - {name: terms,  type: text, x: 96,  y: 56,  w: 456, h: 64,  brightness: 3}                 # 2 lines
  - {name: opt1,   type: text, x: 16,  y: 152, w: 544, h: 32,  brightness: 4, capture: true}
  - {name: opt2,   type: text, x: 16,  y: 184, w: 544, h: 32,  brightness: 3}
  - {name: hint,   type: text, x: 16,  y: 248, w: 544, h: 32,  brightness: 2}
```

- The only frame is the notification. Selection is `>` plus brightness 4; the other choice is one level dimmer (3). A swipe moves `>` with two text updates (content and `textColor`), no page rebuild.
- Screens with one choice (Expired, results) keep it in `opt1`; Sent has none.
- The icon is a 48 × 48 PNG (2 px stroke on the 24 grid, scaled ×2). It arrives after the text; a failed transfer leaves a complete alert.
- Detail, after even-g2-crypto-ticker and g2-kit's Kpi: coin and side big top left, size and leverage under it (`0.05 BTC · 10×`); PnL as big top right (`PNL: +$50`), the stop and liquidation distances from the mark under it. A missing stop says nothing. Under them the last hour as a plain line. Entry (dim, dotted) and stop (dashed) are named with their prices at the right, next to the bright last price; liquidation joins only within 1% of the last price. A level stretches the scale by up to 1.5 hour-ranges (or 1% of the price, if wider); past that it is pinned: its label with ↑ or ↓ at the edge and no line, so a far stop never flattens the hour. All chart labels share one precision taken from the scale; crowded labels stay centred on their lines. Distances in the text line keep two decimals under 1%. `−1h` and the last candle’s local time below. The last price on the chart can lag the mark used for the position distances. Take profit, ROI, the shortcuts count and the balance stay on the phone. The chart is read at most once a minute and sent last; if it fails, the independently rendered PnL and distance fields can still display. The title and PnL are pictures: if one fails the lens shows size and leverage without the coin, or no PnL, until the next draw. PnL is resent whenever its rounded text changes.
- Detail's PnL reads `PNL: +$…` for zero or gains and `PNL: −$…` for losses. Absolute values below 10 show tenths, values from 10 show whole units, and values from 10,000 use thousands (one decimal below 100k, whole thousands thereafter).
- Main sorts rows by liquidation distance, closest first. The selection (`▶`, brightness 4) moves with two text updates (cur and name), no rebuild, and follows the position, not the row number, when the order changes. The coin quantity sits at the right of the name (`0.05`, `81.3M` when the full number does not fit). More than 5 positions: pages of 4 plus a `▼ 1–4 of 7` row, swiped. A swipe on Detail changes the position by text updates too. Cells cut with `…` (`1000PEPE sh…`).

## 5. Alert examples

These examples illustrate trade proposals. Notify uses the same frame with a single `OK` and sends nothing. Protect all can generate a Set Stop Loss proposal. The icon names the condition; `opt2` names the action and its size.

| Condition | Icon | who | why | Action | `opt2` |
|---|---|---|---|---|---|
| Near liquidation | warning triangle | `BTC long` | `3.2% to liquidation` | Close Position | `Close 50% · 0.025 BTC` |
| Loss | trend down | `BTC long` | `ROI −18.2%` | Add Margin | `Add 100 USDT margin` |
| Profit | trend up | `ETH short` | `ROI +31.4%` | Move Stop Loss | `Move stop to entry · 3,412` |
| Near take profit | target | `ETH short` | `0.8% to take profit` | Close Position | `Close 50% · 0.6 ETH` |
| Price change | pulse | `ETH long` | `+5.1% in 15 min` | Increase Position | `Review add · 200 USDT` |
| Price level | bell | `BTC` | `Crossed above 90,000` | Open Position | `Review long · 500 USDT` |
| Full fill | check in circle | `SOL long` | `Order filled at 182.40` | Set Take Profit | `Set take profit · 191.52` |
| Partial fill | half-filled circle | `BTC buy order` | `0.010 of 0.025 filled` | Cancel Order | `Cancel the rest · 0.015 BTC` |

`opt1` is always `> Dismiss`. Open and Increase add exposure, so `opt2` opens Review, never the order:

| Review | ask | terms | `opt2` |
|---|---|---|---|
| Open | `Open BTC long?` | `0.0055 BTC · 500 USDT · 5×`, `Margin ≈ 100 USDT · stop 88,200` | `Open long · 0.0055 BTC` |
| Increase | `Add to ETH long?` | `0.06 ETH · 200 USDT`, `Stop 3,280 stays` | `Add · 0.06 ETH` |

For an Open with multiple configured sizes or leverages, Review first asks for size (USDT) and then leverage, skipping a single-option list. Choosing the last option sends `POST /api/proposals/:id/pick`, which creates a replacement proposal for the selected terms. Choosing is separate from confirming. Voice answers are disabled while options are pending. An eligible fixed-terms alert can take a spoken yes directly into its cancellable countdown.

Review hint: `swipe: choose · tap: dismiss · double tap: back`, `tap: confirm` once `>` is on the order.

## 6. After the tap, and other states

| State | Icon | why | Choice, hint |
|---|---|---|---|
| Sent | clock | `Sent · waiting for the fill` | none; `waiting for Bybit · double tap: hide`, taps ignored, double tap goes back (the server carries on) |
| Filled | check in circle | `Closed 0.025 BTC · avg 61,180` | `> OK`; back to Main in 5 s |
| Partly filled | half-filled circle | `Partly filled · 0.015 of 0.025 BTC` | `> OK` |
| Rejected | x in circle | `Rejected by Bybit`; the reason as a second line in the frame (`below 0.001 BTC`) | `> OK` |
| Unknown | question mark in circle | `No answer from Bybit yet` | `> OK`; the server reconciles, never retries |
| Expired | hourglass | `Expired · nothing sent` | `> Dismiss` |
| Unavailable | hourglass | `Bybit data is stale` | `> Dismiss` |
| Refreshed | same icon | queue shows `NEW`; size in `opt2` updated | the tap that saw the old size does nothing |
| Test alert | same icon | queue shows `TEST` | the tap ends in `Test only · nothing was sent` |
| Stale exchange data | — | Main top line bright: `Bybit data stale since 14:02 · retrying` | table stays, every column at brightness 2; clear mode stays blank |
| Server unreachable | — | Main top line bright: `No connection to your server · retrying` | table hidden, no alert drawn; clear mode stays blank |
| No positions | — | Main top line: `Bybit Demo · no open positions` | table empty |

The result follows the server execution. Stop, margin and cancel operations can report Applied, while orders progress through acknowledgement and fill states. `Sent` is never shown as `Filled`.

## 7. Words and symbols

- Positions read `BTC long`, `ETH short`: coin plus side.
- Table: no headers, no frames, values right-aligned, `▲`/`▼` before ROI. Prices carry no currency; amounts carry `USDT`; ROI is signed in alerts (`+31.4%`, true minus `−18.2%`).
- "stop" and "take profit" on the lens, never SL/TP.
- No capitals except `OK`. Hints lower case.
- Symbols the firmware font has: `· … → ≤ ≥ ≈ × − ━ ─ ▲ ▼ ● ○ ■ □ ▶ > ↗ ↘`. It has no `✓ ✗ ⚠`: those are icons, never text.
- Icons for `app/src/icons.ts` (24 grid, 2 px stroke, drawn at 48 px): warning triangle and bell and shield exist; new: trend up, trend down, shield crossed out, target, pulse, check in circle, half-filled circle, arrow up-right, clock, x in circle, question mark in circle, hourglass.

## 8. Differences from the original design canvas

1. `Dismiss` comes first and carries `>` when an alert opens; the spec mock has `> Confirm` selected. A stray tap must not trade.
2. The confirm item names its outcome (`Close 50% · 0.025 BTC`), not `Confirm`, so the tap confirms exactly what the lens shows.
3. Expiry appears as Expired. Voice confirmation has its own cancellation countdown.
4. Editing, enabling and test alerts are phone actions. The lens menu can request proposals and pause the display of cards for 15 minutes.

## 9. QA before calling it done

- [ ] Every string in §5 and §6 passes `pretext` at its box width with long tickers (`1000PEPE short`) and 6-digit prices.
- [ ] `>` sits on `Dismiss` after every new alert; a tap within 1 s of a new alert does nothing.
- [ ] A swipe moves `>` and swaps brightness 4/3 with text updates only.
- [ ] Double tap on an alert dismisses it; on Main it opens the host exit dialog.
- [ ] Two OR branches true at once: one alert. Two positions matching: two alerts, each named.
- [ ] An expired proposal turns the alert into Expired and removes the action.
- [ ] Duplicate tap, repeated poll or repeated fill: one order at most (idempotent proposal id).
- [ ] Server unreachable: no alert drawn; stale exchange data: top line says since when.
- [ ] The 48 px icon arrives after the text; a failed icon transfer leaves a complete alert.
- [ ] On real G2: readability over bright and dark backgrounds, redraw time vs `CARD_SETTLE_MS`, R1 swipe and tap.
