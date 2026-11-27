# Interface design

## Even G2

The glasses show open positions and their ROI. A tap opens the selected position's details and one-hour chart. On that screen a tap asks to close the position. The list closes the row under ▶ from the menu (tap and hold, then Close position), or by voice after Speak. A rule that needs a decision opens a card with the position, the trigger, and the proposed action. Closing does too, and the card starts on Dismiss.

| Screen | What matters at a glance |
| --- | --- |
| Positions | Side, price, ROI, and a risk flag when relevant |
| Alert | The rule that fired, with **Dismiss** selected by default |
| Review | Quantity, notional, margin, leverage, and stop when applicable |
| Result | Exchange status and fill quantity when available |

The 576 × 288 monochrome display uses brightness to distinguish the main message from supporting details. The cursor identifies the current choice, and the gesture hint sits at the bottom. The alert text appears before the icon transfer, so the position and reason are readable throughout. [Even Hub design guidelines](https://hub.evenrealities.com/docs/build/design-guidelines)

See the [lens specification](glasses-shortcuts.md) for gestures and screen layouts. The [24 × 24 store icon](../assets/even-hub-icon.png) comes from the [pixel-art source](../assets/even-hub-icon.svg).

## Phone

Each shortcut tile shows an action icon and title. Templates use their scenario names. New rules use the action name by default. Tapping a tile opens the editor. A separate switch enables or pauses a saved rule.

The bottom navigation keeps Shortcuts, History and Settings within reach and restores their scroll positions. The editor saves via **Add shortcut** or **Save changes**. An alert banner opens its History row, which updates as the server records a response on Even G2 and any exchange outcome. [Phone specification](trade-shortcuts-spec.md) · [Stylesheet](../app/src/phone/phone.css) · [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
