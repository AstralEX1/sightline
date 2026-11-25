# Sightline: design

## The idea
Your trading rules, in your line of sight. The glasses stay quiet while you are fine. When one of your rules needs you, it asks one question, and one tap answers it.

## Three states
| State | The lens shows | You do |
|---|---|---|
| Calm | `Bybit Demo · 3 positions` and the clock, then your positions with `>`, the most endangered on top; tap opens Detail | nothing, or tap |
| Ask | what happened, what a tap costs, `Dismiss` first / the action by name | swipe, tap |
| Done | `Closed 0.025 BTC · avg 61,180`, then `OK` | tap OK, or wait |

## Principles, and where they live
1. **Quiet by default.** Gesture hints show for 10 s after launch, then leave (`HINT_MS`, `app/src/main.ts`). Main shows positions and a flag only when something is wrong (`liq …%`, `no stop`); there is no dollar day-PnL on the lens.
2. **One question at a time, the safe answer first.** `Dismiss` is item 0, because the firmware highlights item 0 on every rebuild. The other choice names its outcome ("Add 100 USDT margin to BTC"), never "Yes".
3. **Say what it costs.** Detail shows unrealized PnL as a big dotted numeral; a stop action names the price you confirm. Before fees and slippage.
4. **Your rules, not advice.** The alert's `why` is the condition you wrote. Nothing reaches the exchange without a tap.
5. **The same words everywhere.** "BTC long" on rows and cards, "stop" (never "SL"), "Lock profits" in the menu and as the voice phrase.
6. **It just works.** Demo data out of the box. Rules save on every change; there is no Save button. The server row folds away once connected and opens itself when something is wrong.
7. **No silent failures, no false comfort.** Offline or unauthorised: the card is not drawn, so a tap cannot go nowhere. A request that may have reached the exchange says "check Bybit", never "not sent".

## How it looks
- **Brightness is the hierarchy.** The lens has one font and no sizes, so the main line is drawn at full brightness and what supports it lower (`textColor` 2): liquidation distances, stops unless one is missing, the rule line, the quiet line, the hints. A warning or news is never dim (`dim` in `screen()`).
- **A card is a notification.** A rounded frame, quieter than its text (`borderColor` 4), holds the icon, who and why. No countdown on the lens; expiry becomes the Expired state. The choices sit under it.
- **One icon set, two surfaces.** `app/src/icons.ts` keeps SVG paths on a 24-unit grid: the phone draws them as SVG, the lens gets the same paths as a PNG drawn on a canvas. Warning triangle for liquidation, shield for a stop, lock for a stop at entry, bell for a price alert, microphone for something you said. The phone's rule rows wear the same icons as the cards they raise.
- **An icon is decoration.** It arrives after the card's text (an image costs 0.5 to 2 s over BLE) and a failed transfer is ignored: every card says everything in words.

## How the words are written
Sentence case. Verbs first on actions and menus (16 characters max). Numbers carry their unit. Plain words over trader shorthand. The ellipsis is one character (…). A lens line fits 540 px: the tests measure it with the firmware font (`@evenrealities/pretext`).

The phone page follows `docs/bybit-shortcuts-spec.md` §3: Linear's palette and Inter, laid out like Apple Shortcuts (a tile filled in the action's color with a white glyph; templates as plain cards). It borrows no iOS chrome such as blurred bars.

## The 30-second demo
1. Put the glasses on: `Bybit Demo · 3 positions`, BTC on top with `liq …%`, ETH with `no stop`.
2. Tap BTC: Detail with big PnL, size, liquidation, stop. Double tap back.
3. A near-liquidation shortcut fires: the who line blinks, `> Dismiss`, swipe to `Close 50% · 0.025 BTC`, tap. Sent → Filled.
4. Tap then long press for the menu, `Protect all`: one card per position without a stop.
5. On the phone: change the liquidation distance to 5%. Saved, no button. The next card follows the new rule.
