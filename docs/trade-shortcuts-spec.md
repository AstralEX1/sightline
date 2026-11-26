# Trade Shortcuts — Phone UI specification

See the [phone client](../app/src/phone/), [rule catalog](../server/src/registry.ts), and [example phone editor](../assets/phone-editor.png).

## 1. Product contract (phone side)

- The phone page sets things up: create, edit, turn on or off, delete shortcuts; read history; change settings. Nothing is edited on the lens.
- One shortcut = one scope + 1–10 conditions under one `and` / `or` + exactly one action with one parameter set (arch §1, §4).
- The phone page never trades. Every trading proposal is confirmed or dismissed on the lens (arch §9). `Notify` needs no confirmation.
- UI language: English. Settings identifies the fake exchange, Bybit Demo or Bybit Testnet. Live trading is always shown as Off.

## 2. Navigation

No tab bar. Hash routes, one page:

| Route | Screen | Canvas board |
|---|---|---|
| `#/` | Shortcuts (home): your shortcuts + templates | Main |
| `#/shortcut/new` | New Shortcut (empty editor) | NewShortcut |
| `#/shortcut/:id` | Shortcut Editor | Editor, ApplyB (Apply to open), Incompatible |
| `#/history` | History | History |
| `#/settings` | Settings | Settings |

Overlays (not routes): token menu, bottom sheets (numeric, close amount, target, condition type, action type, pickers, options, rename), title menu, discard dialog, toast, in-app banner.

- Home `+` → `#/shortcut/new`. Template tile → `#/shortcut/new?tpl=<id>` with a local editable copy. Shortcut tile → `#/shortcut/:id`.
- Editor back button, iOS edge swipe and Android back run the save-or-discard flow (§7.1). History and Settings back → `#/`.
- Status line on home → `#/settings`. History button on home → `#/history`; gear on History → `#/settings`.

## 3. Design tokens

### 3.1 Color

Light mode uses Paper `#F4F4F4`, white cards and Ink `#232323`. Dark mode uses Ink, `#2E2E2E` cards and Paper text. Primary controls use Ink with Paper text in light mode and Paper with Ink text in dark mode. Action-specific fills distinguish the logo-and-title tiles in both themes. The [stylesheet](../app/src/phone/phone.css) defines all semantic colors, contrast preferences and reduced-transparency overrides.

### 3.2 Typography, controls and motion

The app bundles the Inter variable font and Phosphor icons. Relative type sizes and safe-area insets adapt the phone layout. Light and dark schemes use the same action colors. The stylesheet defines press feedback, sheet transitions and reduced-motion behavior. [Styles and fonts](../app/src/phone/phone.css) · [Phone icons](../app/src/phone/icons.ts)

## 4. Components

Home has a History button, a New shortcut button, an account status link, saved tiles and the template library. Each tile shows the action logo and a title: a custom name when set, otherwise the action title. A saved tile has a switch; a template has a plus. The body of a saved tile opens its editor. Tapping a category heading toggles the grid and stores the preference on the device.

The editor uses editable tokens in a sentence, an Apply to disclosure, choice menus and bottom sheets. Numeric fields display units and bounds. The When/Do sentence uses menus for comparisons, single-choice sheets for metrics and actions, and a numeric sheet for quantities. Selecting a different metric clears incompatible units. An invalid choice leaves the rule editable and shows the validator’s reason beside the affected field. Sheets with pending edits use Cancel or Done.

## 5. Screens

### 5.1 Shortcuts

Saved shortcuts appear in creation order. The four template groups are Protect (4), Take profit (2), Market (4) and Orders (2). Enabling or pausing a saved rule sends its version and updates the switch. A failed request restores the prior state. Home refreshes every ten seconds while visible and retries every five seconds offline. The G2 indicator uses local bridge state. Server notification routing tracks client activity separately.

### 5.2 Shortcut editor

Apply to, When, Do and Options edit a local copy. Tap a number, comparator or action to change it. One operator joins all condition rows; a rule accepts up to ten. Validation is debounced by 250 ms and stale responses are ignored. A conflict on save reloads the version currently on the server.

### 5.3 Apply to

| Choice | Effect |
|---|---|
| All positions | Evaluate each eligible position, including future ones. |
| Positions by coin | Choose coins and Any, Long or Short. The rule can match future positions in that selection. |
| One position | Bind symbol, position index and epoch; reopening a position creates another target. |
| One symbol | Pick a tradable USDT perpetual. The picker combines recent symbols with the exchange list. |
| One order | Bind one order ID. |
| All orders | Evaluate eligible orders independently, including order-age and fill conditions. |

The editor filters these choices by action and existing conditions. The server checks compatibility when saving and enabling.

### 5.4 Condition and action tokens

Price change measures the move from the rule’s per-target baseline. Volume spike uses a candle window. Proximity to a stop requires a stop on the position. The catalog includes separate Open long and Open short actions. Each can carry up to five USDT sizes and five leverages. Add margin takes USDT or a percentage of the position margin.

### 5.5 Numeric sheets

Select a preset or enter a value in the displayed unit. Invalid inputs keep Done disabled. Close accepts 25%, 50%, 75%, 100% or a custom percentage. The server calculates a reduce-only market quantity.

### 5.6 New shortcut

The plus opens an empty editor. Back from an untouched editor creates nothing. Add validates and saves a complete rule switched off. On Home, enable the rule to start monitoring.

### 5.7 Options

Choose when the rule fires and its glasses/phone delivery settings. The trigger choices depend on the conditions and action. Open and Increase use Once. The editor uses five minutes for Repeat. The custom voice-phrase field is hidden.

### 5.8 Title menu

A saved shortcut’s title opens Rename, Duplicate, Test alert and Delete. An empty rename restores the action label. Duplicate creates a disabled copy without copying its unique command phrase. A Test alert exercises the simulated proposal path. Delete asks for confirmation.

### 5.9 Validation

Condition, scope and action issues stay beside the affected controls. Leaving with invalid changes prompts to discard them or keep editing. The server validates again when writing the rule.

### 5.10 Templates and drafts

The phone opens a template in a new editor. Leaving it untouched creates nothing. Add (or leaving after a valid change) saves a disabled rule. For **Price crosses a level**, choose the symbol and set the threshold first. Older disabled drafts and drafts created through the server’s create-by-template API can still appear on Home with a Draft label.

### 5.11 History

Rows are grouped by local day and show the action, time, target, reason and most recent status from the server. Open a row for the trigger, proposed terms, execution outcome and exchange readback when recorded. History loads 50 rows by default and fetches the next page as the end comes into view. The banner and History badge lead here. The empty state reads **No alerts yet**.

### 5.12 Settings

Bybit status, environment and permissions are read-only. Notifications controls delivery on the glasses and in the phone app. Timing controls the repeat cooldown (default 60 s), trade expiry (30 s) and other proposal expiry (60 s); each accepts 10–300 seconds. Under Connection, enter the server address and token. Under **Even G2**, **Send test to G2** waits for the user to tap **OK** on the lens. **On your glasses** contains Quiet mode, Gesture tips and Answer alerts by voice. Device storage keeps those preferences and the connection. **Lens now** previews the current lens text.

## 6. Text rules

### 6.1 Tile labels and numbers

`summary` and `doSummary` from the server describe the condition and action. Examples include **Price ±15%**, **ROI ≥ 20%**, **Close 50%** and **Add 25% margin**. A target tag can name the affected coin, order or side. The phone formats amounts with units and displays order quantities in base asset units. See [sentence rendering](../app/src/phone/sentence.ts).

## 7. Behavior

### 7.1 Draft and save

Back leaves an untouched editor immediately. A valid change saves on leaving. A new rule starts disabled; edits to a saved rule retain its enabled state. A failed network request keeps the editor open. A version conflict reloads the server’s rule.

### 7.2 Atomic edits
Every token change is one draft update followed by validate. Never reset a valid number into another unit, never delete a condition or the action as a side effect, never change the scope silently.

### 7.3 Choice filtering (v1 §7.4, kept)
Uses the matrices shipped in `GET /catalog` (arch §7); the server validates again on save.
- Condition type sheet: types compatible with the scope, the action and every existing condition (intersection across `or` branches). Static impossibilities are hidden.
- Action type sheet: only actions compatible with the scope and every condition. Apply to lists only scopes that hold the action and every condition, and the condition sheet only conditions that fit the scope, the action and the other conditions. Nothing incompatible is offered.
- Apply to options: §5.3.

### 7.4 Turning shortcuts on and off
Only from the home tile switch. Templates and new shortcuts start off. Turning on calls validate on the server; a rejection springs the switch back and opens the editor with the issues marked.

### 7.5 Polling and alerts
While the app is open: `GET /notifications?after=` every 5 s for the in-app banner; home refetches every 10 s online and every 5 s offline; the editor does not poll. No push in the MVP.

### 7.6 Offline
Server unreachable: home as in §5.1; the editor shows its last data read-only (tokens inert, back works without saving) and a toast `Server offline`.

## 8. Accessibility

Switches expose their checked state; category headings and disclosures expose their expanded state. Sheets retain focus, the router moves focus to the active screen, and validation errors use visible text. Verify text scaling, contrast, keyboard operation and reduced motion in both themes. Device screen-reader checks are tracked separately in the [UI test plan](ui-test-plan.md).

## 9. Implementation

[Router and notifications](../app/src/phone/index.ts) · [Home and templates](../app/src/phone/home.ts) · [Editor](../app/src/phone/editor.ts) · [Shared controls](../app/src/phone/ui.ts) · [Settings](../app/src/phone/settings.ts) · [History](../app/src/phone/history.ts) · [Typography and layout](../app/src/phone/phone.css)

## 10. Acceptance tests

The [phone and lens test plan](ui-test-plan.md) contains the manual scenarios. Automated checks for rule editing, sentence rendering and stored preferences run with `npm test`.
