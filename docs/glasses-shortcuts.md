# Bybit Shortcuts on the G2 lens

Lens side of `bybit-shortcuts-spec.md` (§1, §8.3, §10). Shortcuts are created, edited, turned on and off only in the phone app; the lens shows open positions and answers the shortcuts that fire. Built on Sightline's card (`app/src/main.ts` `CARD`, `docs/design.md`) and the G2 UI rules (8 px grid, three brightness levels, one focus marker, hint line last).

Screens drawn at 576 × 288: https://claude.ai/artifact/1n89NY12383wwVqdkFS1Pr. Page Flow holds the chosen design (main screen, every alert, review and result); page Position detail holds the detail screen (top row; the row below is the earlier, overloaded version); the other pages keep rejected variants. Switch on the `guides` tweak to see the container boxes.

Status: built in `app/src/view.ts` + `app/src/main.ts` (Main with `>`, Detail with dotted PnL, Alert, Review, Result). Every line below was measured with `@evenrealities/pretext` and fits its box. Nothing here was tried on real glasses yet.

## 1. What each screen answers

| Screen | The one question | Answer on the lens | Next |
|---|---|---|---|
| Main | How are my positions? | header-less table: position, price, ROI, a flag only when in trouble | swipe, tap |
| Detail | How is this position doing? | big PnL, then size, liquidation, stop, take profit; alerts count and balance in one line | swipe, double tap |
| Alert | What fired, and what will a tap do? | framed notification with an icon, choices below the frame | swipe, tap |
| Review | What exactly am I opening? | qty, notional, leverage, margin, stop | swipe, tap |
| Result | Did it happen? | the exchange's real status | nothing, or OK |

The lens never edits or pauses shortcuts: that is the phone app's job (spec §2). Detail only counts the ones that are on for a position. No menu on the lens.

## 2. Flow

```text
Main ──tap──▶ Detail ──swipe──▶ next position's Detail
 ▲              └─double tap──▶ Main, cursor on the same position
Main ──rule fires──▶ Alert ──tap action──▶ Sent ──▶ Filled / Rejected / Unknown ──OK──▶ next Alert or Main
                      │  └─tap Dismiss / double tap──────────────────────────────────▶ next Alert or Main
                      ├─ Open / Increase: tap "Review…" ──▶ Review ──tap action──▶ Sent
                      │                                      └─double tap──▶ back to Alert
                      └─ time runs out / position or rule changed ──▶ Expired (Dismiss only)
```

- One alert at a time. Queue order (spec §8.3): Close, Set or Move stop, Add margin, Cancel order first, critical before the rest; then Set take profit; then Notify; Open and Increase last. Oldest first within a group. The frame shows the place: `1/2`.
- A rule that matches several positions raises one alert per position, each naming its own position.
- OR rules raise one alert; the second line shows the strongest reason (liquidation beats ROI).
- A new alert ignores taps for 1 s (`CARD_SETTLE_MS`), so a tap meant for the previous one cannot answer it. `Dismiss` is first and selected anyway.
- The lens shows no countdown. The server still expires a proposal (30 s for market orders, 60 s for stops, margin and cancel) and the alert turns into Expired.
- Alerts only reach the lens while the plugin is open. Otherwise the server sends a phone notification (spec §10); an alert that expired meanwhile goes to History, never to the lens.

## 3. Gestures

| Input | Main | Detail | Alert | Review | Result |
|---|---|---|---|---|---|
| Swipe (temple or R1) | move `>`; past the 5th row, next page | next or previous position | move `>` | move `>` | nothing |
| Tap | open Detail of the `>` position | nothing | do the `>` item | do the `>` item | OK |
| Double tap | host exit dialog | back to Main | Dismiss | back to Alert | OK |

The hint is the last line, dim, lower case: `swipe: choose · tap: confirm`, on Main `swipe: choose · tap: details · double tap: exit · tap, hold: menu`. On Main it shows for 10 s after launch (`HINT_MS`), then leaves. An alert that fires while Detail is open takes over the lens; after it, the lens goes back to Detail. Speak is on the menu (not a Main tap). Swipes are gated to one per 700 ms (`SWIPE_GATE_MS`). Taps while sending are ignored.

## 4. Layouts

Absolute pixels on an 8 px grid, 16 px edge inset, 27 px a text line, 4 px padding, corner radius 4. Brightness `textColor`: 4 primary and selected, 3 ordinary text, 2 hints and supporting values. `capture` is the one input container.

```yaml
main:            # text 8, image 0; no frames
  - {name: top,    type: text, x: 16,  y: 16,  w: 544, h: 32,  brightness: 3, capture: true}  # "Bybit Demo · 4 positions" … "14:05"; 4 when it carries a problem
  - {name: cursor, type: text, x: 16,  y: 56,  w: 144, h: 144, brightness: 4}                 # only the `>` row: "> BTC long"
  - {name: name,   type: text, x: 16,  y: 56,  w: 144, h: 144, brightness: 3}                 # the other rows, indented under the cursor column
  - {name: price,  type: text, x: 160, y: 56,  w: 128, h: 144, brightness: 3}                 # 61,240.5, right-aligned, no currency
  - {name: loss,   type: text, x: 288, y: 56,  w: 104, h: 144, brightness: 4}                 # ▼ 4.2% ROI; losses brighter than gains
  - {name: gain,   type: text, x: 288, y: 56,  w: 104, h: 144, brightness: 3}                 # ▲ 24.0%
  - {name: flag,   type: text, x: 392, y: 56,  w: 168, h: 144, brightness: 4}                 # only trouble: "liq 5.9%" under 10%, "no stop"
  - {name: hint,   type: text, x: 16,  y: 248, w: 544, h: 32,  brightness: 2}
detail:          # text 7, image 1; the Weather layout: short table left, one big number right
  - {name: top,    type: text, x: 16,  y: 16,  w: 544, h: 32,  brightness: 3, capture: true}  # "BTC long · 15×" … "1/4"
  - {name: table,  type: text, x: 16,  y: 64,  w: 272, h: 112, brightness: 3}                 # 0.050 BTC / liq 57,623 / stop 59,600 / tp 64,500
  - {name: loud,   type: text, x: 16,  y: 64,  w: 272, h: 112, brightness: 4}                 # "× no stop" on its row, brighter
  - {name: label,  type: text, x: 320, y: 64,  w: 240, h: 32,  brightness: 2}                 # PnL
  - {name: big,    type: image, x: 320, y: 96, w: 240, h: 56}                                 # dotted ▼8.60 (numeralPng, 7 px pitch)
  - {name: unit,   type: text, x: 320, y: 152, w: 240, h: 32,  brightness: 2}                 # USDT · ROI −4.2%
  - {name: info,   type: text, x: 16,  y: 208, w: 544, h: 32,  brightness: 2}                 # 3 alerts on · balance 2,140 USDT
  - {name: hint,   type: text, x: 16,  y: 248, w: 544, h: 32,  brightness: 2}                 # swipe: next position · double tap: back
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
- Screens with one choice (Notify, Expired, results) keep it in `opt1`; Sent has none.
- The icon is a 48 × 48 PNG (2 px stroke on the 24 grid, scaled ×2). It arrives after the text; a failed transfer leaves a complete alert.
- Detail follows Weather: the one number that matters, unrealized PnL, is big dotted digits on the right with `PnL` above and `USDT · ROI −4.2%` below. The table on the left has at most four rows: size, liquidation price, stop (`× no stop` bright when missing), take profit (row left out when none). One dim line under it: how many shortcuts are on for the position and the balance. Leverage is in the top line. Entry price, stop and take-profit costs, shortcut names, margin mode and funding stay on the phone.
- The big number needs `▲` and `.` added to `DOTS` in `app/src/icons.ts` (it has `▼`, `△` and `,`). Cents up to 99.99; whole numbers from 100 (`▼1,235`, 238 px); `k` from 10,000. The image is sent only when the rounded value changes.
- Main sorts rows by liquidation distance, closest first. The cursor moves with two text updates (cursor and name), no rebuild. More than 5 positions: pages of 4 plus a `1–4 of 7` row, swiped. Cells cut with `…` (`1000PEPE sh…`).

## 5. Every alert

Ten alerts cover all ten conditions and all nine actions. The icon names the condition; `opt2` names the action and its size.

| Condition | Icon | who | why | Action | `opt2` |
|---|---|---|---|---|---|
| Near liquidation | warning triangle | `BTC long` | `3.2% to liquidation` | Close Position | `Close 50% · 0.025 BTC` |
| Loss | trend down | `BTC long` | `ROI −18.2%` | Add Margin | `Add 100 USDT margin` |
| Stop missing | shield crossed out | `SOL long` | `No stop` | Set Stop Loss | `Set stop · 178.75` |
| Near stop | shield | `XRP long` | `0.9% to stop` | Notify | none: `> Dismiss` only |
| Profit | trend up | `ETH short` | `ROI +31.4%` | Move Stop Loss | `Move stop to entry · 3,412` |
| Near take profit | target | `ETH short` | `0.8% to take profit` | Close Position | `Close 50% · 0.6 ETH` |
| Price change | pulse | `ETH long` | `+5.1% in 15 min` | Increase Position | `Review add · 200 USDT` |
| Price level | bell | `BTC` | `Crossed above 90,000` | Open Position | `Review long · 500 USDT` |
| Full fill | check in circle | `SOL long` | `Order filled at 182.40` | Set Take Profit | `Set take profit · 191.52` |
| Partial fill | half-filled circle | `BTC buy order` | `0.010 of 0.025 filled` | Cancel Order | `Cancel the rest · 0.015 BTC` |

`opt1` is always `> Dismiss`. Open and Increase add exposure, so `opt2` opens Review, never the order (spec §10):

| Review | ask | terms | `opt2` |
|---|---|---|---|
| Open | `Open BTC long?` | `0.0055 BTC · 500 USDT · 5×`, `Margin ≈ 100 USDT · stop 88,200` | `Open long · 0.0055 BTC` |
| Increase | `Add to ETH long?` | `0.06 ETH · 200 USDT`, `Stop 3,280 stays` | `Add · 0.06 ETH` |

Review hint: `swipe: choose · tap: confirm · double tap: back`.

## 6. After the tap, and other states

| State | Icon | why | Choice, hint |
|---|---|---|---|
| Sent | clock | `Sent · waiting for the fill` | none; `waiting for Bybit…`, taps ignored |
| Filled | check in circle | `Closed 0.025 BTC · avg 61,180` | `> OK`; back to Main in 5 s |
| Partly filled | half-filled circle | `Partly filled · 0.015 of 0.025 BTC` | `> OK` |
| Rejected | x in circle | `Rejected: below 0.001 BTC` (Bybit's reason) | `> OK` |
| Unknown | question mark in circle | `No answer from Bybit yet` | `> OK`; the server reconciles, never retries |
| Expired | hourglass | `Expired · nothing sent` | `> Dismiss` |
| Unavailable | hourglass | `Bybit data is stale` | `> Dismiss` |
| Refreshed | same icon | queue shows `NEW`; size in `opt2` updated | the tap that saw the old size does nothing |
| Test alert | same icon | queue shows `TEST` | the tap ends in `Test only · nothing was sent` |
| Stale exchange data | — | Main top line bright: `Bybit data stale since 14:02 · retrying` | table stays, every column at brightness 2 |
| Server unreachable | — | Main top line bright: `No connection to your server · retrying` | table hidden, no alert drawn |
| No positions | — | Main top line: `Bybit Demo · no open positions` | table empty |

Results come from order and execution updates only. `Sent` is never shown as `Filled` (spec §8.3, T22).

## 7. Words and symbols

- Positions read `BTC long`, `ETH short`: coin plus side.
- Table: no headers, no frames, values right-aligned, `▲`/`▼` before ROI. Prices carry no currency; amounts carry `USDT`; ROI is signed in alerts (`+31.4%`, true minus `−18.2%`).
- "stop" and "take profit" on the lens, never SL/TP.
- No capitals except `OK`. Hints lower case.
- Symbols the firmware font has: `· … → ≤ ≥ ≈ × − ━ ─ ▲ ▼ ● ○ ■ □ ▶ > ↗ ↘`. It has no `✓ ✗ ⚠`: those are icons, never text.
- Icons for `app/src/icons.ts` (24 grid, 2 px stroke, drawn at 48 px): warning triangle and bell and shield exist; new: trend up, trend down, shield crossed out, target, pulse, check in circle, half-filled circle, arrow up-right, clock, x in circle, question mark in circle, hourglass.

## 8. Where this departs from spec §10

1. `Dismiss` comes first and carries `>` when an alert opens; the spec mock has `> Confirm` selected. A stray tap must not trade.
2. The confirm item names its outcome (`Close 50% · 0.025 BTC`), not `Confirm`, so the tap confirms exactly what the lens shows.
3. No countdown on the lens; expiry shows as the Expired state.
4. Editing, enable/disable and test alerts stay phone-only. The lens still has a contextual menu for `Protect all`, `Lock profits`, `Pause 15 min` and `Speak` (architecture voice seeds).

## 9. QA before calling it done

- [ ] Every string in §5 and §6 passes `pretext` at its box width with long tickers (`1000PEPE short`) and 6-digit prices.
- [ ] `>` sits on `Dismiss` after every new alert; a tap within 1 s of a new alert does nothing.
- [ ] A swipe moves `>` and swaps brightness 4/3 with text updates only.
- [ ] Double tap on an alert dismisses it; on Main it opens the host exit dialog.
- [ ] Two OR branches true at once: one alert. Two positions matching: two alerts, each named.
- [ ] An expired proposal turns the alert into Expired and removes the action.
- [ ] Duplicate tap, duplicate WebSocket event: one order at most (idempotent proposal id).
- [ ] Server unreachable: no alert drawn; stale exchange data: top line says since when.
- [ ] The 48 px icon arrives after the text; a failed icon transfer leaves a complete alert.
- [ ] On real G2: readability over bright and dark backgrounds, redraw time vs `CARD_SETTLE_MS`, R1 swipe and tap.
