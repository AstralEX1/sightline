# Trade Shortcuts: design

## The idea
Set the rule. Tap the trade. The glasses stay quiet while you are fine. When one of your rules needs you, it asks one question, and one tap answers it.

## Three states
| State | The lens shows | You do |
|---|---|---|
| Calm | `Bybit Demo · 3 positions` and the clock, then your positions with `▶`, the most endangered on top; tap opens Detail | nothing, or tap |
| Ask | what happened, what a tap costs, `Dismiss` first / the action by name | swipe, tap |
| Done | `Closed 0.025 BTC · avg 61,180`, then `OK` | tap OK, or wait |

## Principles, and where they live
1. **Quiet by default.** Extra navigation tips default on while the stored launch count is below three. Settings → Gesture tips overrides that default. Exit and Back remain visible. Main shows positions and a flag only when something is wrong (`liq …%`); there is no dollar day-PnL on the lens.
2. **One question at a time, the safe answer first.** `Dismiss` is item 0, because the firmware highlights item 0 on every rebuild. The other choice names its outcome ("Add 100 USDT margin to BTC"), never "Yes".
3. **Say what it costs.** Detail shows unrealized PnL next to the coin; a stop action names the price you confirm. Before fees and slippage.
4. **Your rules, not advice.** The alert's `why` is the condition you wrote. Nothing reaches the exchange without a tap.
5. **The same words everywhere.** "BTC long" on rows and cards, "stop" (never "SL"), "Lock profits" in the menu and as the voice phrase.
6. **It just works.** Demo data out of the box. The editor keeps a local copy. Leaving saves valid changes against the version that was opened. Invalid edits open the discard dialog. The server row folds away once connected and opens itself when something is wrong.
7. **No silent failures, no false comfort.** Offline or unauthorised: the card is not drawn, so a tap cannot go nowhere. A request that may have reached the exchange says "check Bybit", never "not sent".

## How it looks
- **Brightness is the hierarchy.** The lens has one font and no sizes, so the main line is drawn at full brightness and what supports it lower (`textColor` 2): liquidation distances, stops unless one is missing, the rule line, the quiet line, the hints. A warning or news is never dim (`dim` in `screen()`).
- **A card is a notification.** A rounded frame, quieter than its text (`borderColor` 11 of 15, brightness 3 of 4), holds the icon, who and why. No countdown on the lens; expiry becomes the Expired state. The choices sit under it.
- **Icons.** The phone uses Phosphor (MIT) in `app/src/phone/icons.ts`: Fill for action glyphs, always white on the action's color (templates too), Bold for navigation and controls. The lens keeps its own 24-unit set in `app/src/icons.ts`, drawn as a PNG on a canvas: warning triangle for liquidation, shield for a stop, lock for a stop at entry, bell for a price alert, microphone for something you said.
- **An icon is decoration.** It arrives after the card's text (an image costs 0.5 to 2 s over BLE) and a failed transfer is ignored: every card says everything in words.

## How the words are written
Sentence case. Verbs first on actions and menus (16 characters max). Numbers carry their unit. Plain words over trader shorthand. The ellipsis is one character (…). A lens line fits 540 px: the tests measure it with the firmware font (`@evenrealities/pretext`).

The phone page takes its colors from `brand/README.md` (Even greys, Bybit orange `#FFB11A` as a fill with Ink text on it) and Inter, and follows Apple HIG laid out like Apple Shortcuts (a tile filled in the action's color that reads When and the trigger over Do and the action, both in one size, with a toggle: a white track and a knob in the tile's color when on; templates the same with a + in the toggle's place; grouped white cards on a Paper page). It borrows no iOS chrome such as blurred bars. A template opens as an unsaved shortcut with Add; a sheet with edits closes only by Cancel or Done.

## The 30-second demo
1. Put the glasses on: `Bybit Demo · 3 positions`, BTC on top with `liq …%`.
2. Tap BTC: Detail with big PnL, size, liquidation, stop. Double tap back.
3. A near-liquidation shortcut fires: the who line blinks, `> Dismiss`, swipe to `Close 50% · 0.025 BTC`, tap. Sent → Filled.
4. Tap then long press for the menu, `Protect all`: one card per position without a stop.
5. On the phone: change the liquidation distance to 5%. Return to Shortcuts to save. The next card follows the new rule.
