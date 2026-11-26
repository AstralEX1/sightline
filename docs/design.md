# Interface design

## Even G2

The glasses show open positions and their ROI. A tap opens the selected position's details and one-hour chart. A rule that needs a decision opens a card with the position, the trigger, and the proposed action.

| Screen | What matters at a glance |
| --- | --- |
| Positions | Side, price, ROI, and a risk flag when relevant |
| Alert | The rule that fired, with **Dismiss** selected by default |
| Review | Quantity, notional, margin, leverage, and stop when applicable |
| Result | Exchange status and fill quantity when available |

The 576 × 288 monochrome display uses brightness to distinguish the main message from supporting details. The cursor identifies the current choice, and the gesture hint sits at the bottom. The alert text appears before the icon transfer, so the position and reason are readable throughout. [Even Hub design guidelines](https://hub.evenrealities.com/docs/build/design-guidelines)

See the [lens specification](glasses-shortcuts.md) for gestures and screen layouts. The [24 × 24 store icon source](../assets/even-hub-icon.svg) is a pixel-art version of the app mark.

## Phone

Each shortcut is a two-row **When / Do** tile. The tile color follows the action. Tapping the tile opens the editor. A separate switch enables or pauses the rule. Templates open as unsaved rules for the user to review and add.

The phone uses Inter, Phosphor icons and a neutral Even palette. The New shortcut button uses a translucent glass surface. [Phone specification](trade-shortcuts-spec.md) · [Stylesheet](../app/src/phone/phone.css) · [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
