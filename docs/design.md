# Sightline: design

## The idea
Your trading rules, in your line of sight. The glasses stay quiet while you are fine. When one of your rules needs you, it asks one question, and one tap answers it.

## Three states
| State | The lens shows | You do |
|---|---|---|
| Calm | `Today +$124.50`, then your positions, the most endangered on top | nothing |
| Ask | what happened, what a tap costs, `Not now` / the action by name | swipe, tap |
| Done | `Done: Set BTC stop at 59,600` | nothing |

## Principles, and where they live
1. **Quiet by default.** Gesture hints show for 10 s after launch, then leave (`HINT_MS`, `app/src/main.ts`). The loss meter appears only once you are losing and says what is left, not the limit (`today()`, `app/src/view.ts`).
2. **One question at a time, the safe answer first.** `Not now` is item 0, because the firmware highlights item 0 on every rebuild. The other choice names its outcome ("Add $100 margin to BTC"), never "Yes".
3. **Say what it costs.** Every stop card shows the result if the stop fills (`if stopped: -$120.00`). Before fees and slippage.
4. **Your rules, not advice.** Under each card: which of your rules raised it. Nothing reaches the exchange without a tap.
5. **The same words everywhere.** "BTC long" on rows and cards, "stop" (never "SL"), "Lock profits" in the menu and as the voice phrase, "cap" for the per-tap limit.
6. **It just works.** Demo data out of the box. Rules save on every change; there is no Save button. The server row folds away once connected and opens itself when something is wrong.
7. **No silent failures, no false comfort.** Offline or unauthorised: the card is not drawn, so a tap cannot go nowhere. A request that may have reached the exchange says "Check the exchange", never "not sent".

## How it looks
- **Brightness is the hierarchy.** The lens has one font and no sizes, so the main line is drawn at full brightness and what supports it lower (`textColor` 2): liquidation distances, stops unless one is missing, the rule line, the quiet line, the hints. A warning or news is never dim (`dim` in `screen()`).
- **A card is a notification.** A rounded frame, quieter than its text (`borderColor` 4), holds the icon, the title, the detail and a bar of the time the card still waits, measured on the server clock. The choices sit under it.
- **One icon set, two surfaces.** `app/src/icons.ts` keeps SVG paths on a 24-unit grid: the phone draws them as SVG, the lens gets the same paths as a PNG drawn on a canvas. Warning triangle for liquidation, shield for a stop, lock for a stop at entry, bell for a price alert, microphone for something you said. The phone's rule rows wear the same icons as the cards they raise.
- **An icon is decoration.** It arrives after the card's text (an image costs 0.5 to 2 s over BLE) and a failed transfer is ignored: every card says everything in words.

## How the words are written
Sentence case. Verbs first on actions and menus (16 characters max). Numbers carry their unit. Plain words over trader shorthand. The ellipsis is one character (…). A lens line fits 540 px: the tests measure it with the firmware font (`@evenrealities/pretext`).

The phone page lives inside the Even app, so it uses the Even design tokens rather than imitating iOS: being native to the host is the point.

## The 30-second demo
1. Put the glasses on: `Today -$40.00`, three positions, BTC on top and sliding toward liquidation.
2. The title blinks: `BTC long · 2.9% from liquidation`, `Liquidation at 59,500 · PnL -$34.00`.
3. Swipe to `Add $100 margin to BTC`, tap. `Done: Add $100 margin to BTC`. The row's liquidation distance grows.
4. Tap then long press for the menu, `Protect all`: one card per position without a stop, each with its worst case.
5. On the phone: change "Warn me 3% before liquidation" to 5. Saved, no button. The next card follows the new rule.
