# Trade Shortcuts — Phone UI specification

**Version 2.1 · 25 November 2026** · replaces v1.0 (`~/Downloads/bybit-shortcuts-spec.md`)
**Audience:** the engineer building the phone page in `app/` (vanilla TypeScript, HTML/CSS, Vite, Even Hub WebView).
**Status:** coded in `app/src/phone/` and checked in desktop Chrome at phone size. Every color pair below was checked for contrast; nothing was tried on a device.

Design canvas: https://claude.ai/artifact/QkfLzCX64QKfdKRV6N2BUA (boards named in each section).

---

## 0. Sources and precedence

| Topic | Source of truth |
|---|---|
| Phone screens, tokens, components, copy, interactions | **this document**, then the canvas |
| Rule model, condition and action registry, compatibility matrices, `validate()`, engine, proposals, API, the templates as data | `docs/shortcuts-architecture.md` (§ numbers below as "arch §n") |
| Lens screens, lens gestures | `docs/glasses-shortcuts.md` and its canvas |

Where the canvas and this document differ, this document wins: it records decisions made after drawing. The product name is **Trade Shortcuts**. Brand assets and the target visual system are maintained in `brand/README.md`. The current phone implementation and the brand migration are distinct stages. The G2 boards on the phone canvas are outdated; build the lens from `glasses-shortcuts.md`.

v1 section map (other docs still cite v1 numbers):

| v1 | Now |
|---|---|
| §1 Product contract | §1 here, arch §1 |
| §2–3 Mobile IA, Apple UI | §2–§5 here |
| §4–7 Scope, conditions, actions, matrices | arch §4–§7 |
| §7.4 Choice filtering | §7.3 here, arch §7 |
| §8 Evaluation, lifecycle, confirmation | arch §8–§9 |
| §9 Templates | arch §12 (data), §5.1 here (UI) |
| §10 Glasses UX | `glasses-shortcuts.md` |
| §11 Data contract, API | arch §4, §10–§11 |
| §12 Acceptance tests | §10 here (phone), arch §13 (server) |

## 1. Product contract (phone side)

- The phone page sets things up: create, edit, turn on or off, delete shortcuts; read history; change settings. Nothing is edited on the lens.
- One shortcut = one scope + 1–10 conditions under one `and` / `or` + exactly one action with one parameter set (arch §1, §4).
- The phone page never trades. Every trading proposal is confirmed or dismissed on the lens (arch §9). `Notify` needs no confirmation.
- UI language: English. Bybit Demo or the fake exchange only; live trading is a server switch, shown read-only.

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

- Home `+` → `#/shortcut/new`. Template tile → creates a disabled draft (§5.1) → `#/shortcut/:id`. Shortcut tile → `#/shortcut/:id`.
- Editor back button, iOS edge swipe and Android back run the save-or-discard flow (§7.1). History and Settings back → `#/`.
- Status line on home → `#/settings`. History button on home → `#/history`; gear on History → `#/settings`.

## 3. Design tokens

Linear-style branding: Magic Blue accent, Mercury White ground, Nordic Gray ink, Inter. No Linear logo or name anywhere. Replace the `:root` block in `app/index.html` with these custom properties.

### 3.1 Color

Dark values are drawn for the home screen only (board HomeDark); the contrast column covers both.

| Token | Light | Dark | Use | Contrast |
|---|---|---|---|---|
| `--bg` | `#F4F5F8` | `#0F1011` | page | — |
| `--surface` | `#FFFFFF` | `#1A1B1E` | cards, list groups, sheets, menus | — |
| `--border` | `#E4E5E9` | `#2A2C31` | 1 px inset outline of cards; separators | decorative |
| `--text` | `#222326` | `#F7F8F8` | primary text | 14.4 / 17.9 |
| `--text-2` | `#6B6F76` | `#8A8F98` | secondary text, chevrons, remove glyph | 4.63 on bg, 5.05 on surface / 5.3 |
| `--accent` | `#5E6AD2` | `#7C85E8` | filled controls: `+` button, row switch on, New chip | white on it 4.7 |
| `--accent-text` | `#4B55C3` | `#9BA2F5` | links, values, `Add condition`, checkmarks | 6.2 / 7.28 |
| `--token-bg` | `#EEEFFC` | `#262A4D` | token fill; token text is `--accent-text` | 5.43 / 5.84 |
| `--error` | `#C93434` | `#F07878` | incompatible row text and marker | on `--error-bg` 4.57 / 5.43 |
| `--error-bg` | `#FDECEC` | `#3A2024` | incompatible token fill | — |
| `--success` | `#4CB782` | `#4CB782` | status dot, always beside a word | decorative |
| `--chip` | `#ECEDF0` | `#2A2C31` | remove circle, segmented and search fills; glyph `--text-2` | glyph 4.31 |
| `--scrim` | `rgba(0,0,0,.35)` | `rgba(0,0,0,.55)` | behind sheets | — |
| `--menu-scrim` | `rgba(34,35,38,.06)` | `rgba(0,0,0,.3)` | behind token menu | — |
| `--chip-neutral` | `#8A8F98` | same | fill of chips without an action (Apply to, When, empty Do) | white glyph 3.25 |
| `--switch-off` | `#D5D6DB` | `#3A3B40` | row switch track off | — |

Action fills use solid colors sampled from Apple Shortcuts screenshots. The fills stay the same in both themes. Tiles and chips use `--c` for the fill. Shortcut tiles use white labels and glyphs over a shaded gradient. Chips use `#0C0C0C` glyphs.

| Token | Value | Actions |
|---|---|---|
| `--act-grow` | `#4CC961` | Open Position, Increase Position |
| `--act-close` | `#F56472` | Close Position |
| `--act-stop` | `#B17DDF` | Move Stop Loss, Set Stop Loss, Set Take Profit |
| `--act-margin` | `#228FF7` | Add Margin |
| `--act-cancel` | `#F3AE54` | Cancel Order |
| `--act-notify` | `#4BC7DB` | Notify |

### 3.2 Typography

Font: **Inter** variable (SIL OFL), latin subset bundled as `app/src/phone/fonts/InterVariable.woff2` with `@font-face` in `phone.css` (Vite emits it next to the build, so relative paths work in the `.ehpk`); no Google Fonts at runtime (the WebView may be offline). Stack: `Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif`. Every number uses `font-variant-numeric: tabular-nums`.

| Style | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `title-large` | 32 / 40 | 600 | −0.6 px | "Shortcuts" |
| `title-section` | 20 / 28 | 600 | −0.3 px | "Templates" |
| `nav-title` | 16 / 22 | 600 | 0 | editor title pill, History, Settings |
| `sentence` | 18 / 32 | 400 | 0 | When / Do cards; tokens inherit |
| `body` | 16 / 22 | 400 | 0 | rows, menus, sheet nav |
| `body-strong` | 16 / 22 | 500 | 0 | `Apply to`, `Options`, `Add condition`, `Add action` |
| `tile-label` | 12 / 20 | 600 | 0 | `When` / `Do` word on a tile, 80% opacity, one line |
| `tile-value` | 22 / 27 | 650 | −0.015 em | tile trigger and action, one size, up to three lines, then ellipsis |
| `footnote` | 13 / 18 | 400 | 0 | sheet notes, status line is 15 / 20 |
| `group-label` | 13 / 18 | 400 | 0, uppercase | History and Settings group headers |
| `numeric` | 30 / 36 | 400 | 0 | numeric sheet value and unit |
| `marker` | 14 / 20 | 600 | 0 | "Incompatible" |

Sizes are in `rem` from a 16 px root so text size settings scale the layout. On iOS set `html { font: -apple-system-body; font-family: Inter, … }` so the WebView follows Dynamic Type.

### 3.3 Space, radius, size

| Token | Value | Use |
|---|---|---|
| Page inset | 16 px | left / right |
| Page top | `env(safe-area-inset-top)` | then the 52 px nav row (home) or 56 px (editor) |
| Page bottom | `env(safe-area-inset-bottom) + 16 px` | |
| Grid gap | 12 px | tiles, both axes |
| Card gap | 24 px | between Apply to, When, Do, Options |
| Card padding | 12 px 16 px (When: 12 16 4) | |
| Radius | tile 20 · card 20 · list group 12 · sheet top 12 · menu 12 · menu item 8 · token 6 · chip 24 → 6, chip 26 → 7 · circle 50% | |
| Touch target | ≥ 44 × 44 (tokens: see §8) | |
| Circle button | 44 | back, history, `+` |
| Tile | min height 143, padding 16 | grows with text |
| Glyph | 12 (When) / 11 (Do) in 20 px tile chips; 14–15 in chips; 20–22 in rows | filled on tile chips; stroke 2.2–2.6 (small) |
| Tile switch | 40 × 24 track, 20 knob, 50 × 44 target, top 4 right 4 | |
| Row switch | 51 × 31 | Settings |

Elevation: no shadows on cards or tiles. Cards: `box-shadow: inset 0 0 0 1px var(--border)`. Tiles, templates included: none, the fill is the edge. Menu: border + `0 12px 32px rgba(34,35,38,.16)`.

### 3.4 Icons

Add to `app/src/icons.ts` (`ICONS`, `svg()`), 24 × 24 viewBox, `fill="none" stroke="currentColor"`, round caps and joins. Never emoji.

| Name | Path | Used for |
|---|---|---|
| `close` | `M7 7l10 10M17 9v8H9` | Close Position |
| `shield` | `M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z` | Move Stop Loss |
| `shield-bar` | shield + `M12 9v5` | Set Stop Loss |
| `target` | `circle 12,12 r8` + `circle 12,12 r3.5` | Set Take Profit |
| `wallet` | `rect 3,6 18×13 r2` + `M3 10h18M16 14.5h2` | Add Margin |
| `grow` | `M7 17L17 7M9 7h8v8` | Open, Increase Position |
| `x` | `M7 7l10 10M17 7L7 17` | Cancel Order |
| `bell` | `M6 16v-5a6 6 0 0112 0v5l1.5 2h-15z` + `M10 20.5a2 2 0 004 0` | Notify |
| `when` | `M8 16L16 8M10 8h6v6` | When chip |
| `do-empty` | `M5 12h14M13 6l6 6-6 6` | Do chip before an action is chosen |
| `scope` | `rect 7,3 13×13 r2.5` + `M4 8v10.5A2.5 2.5 0 006.5 21H16` | Apply to chip |
| `back` `down` `up` `right` | `M15 5l-7 7 7 7` · `M6 9l6 6 6-6` · `M6 15l6-6 6 6` · `M9 5l7 7-7 7` | chevrons |
| `plus` `check` | `M12 4v16M4 12h16` · `M5 12.5l4.5 4.5L19 7` | |
| `clock` | `circle r9` + `M12 7.5V12l3 2` | History button |
| `glasses` | `circle 6.5,14 r3.5` + `circle 17.5,14 r3.5` + `M10 14h4M3 13l1.5-5M21 13l-1.5-5` | status line, confirm line |
| `remove` | filled circle r11 `--chip` + `M8.5 8.5l7 7M15.5 8.5l-7 7` in `--text-2` | row remove |
| `warn` | filled `M12 2.5L1.5 21h21z` + white `M12 9.5v5M12 17.6v.4` | Incompatible marker |

### 3.5 Motion

Follows Apple's fluid-interface rules: feedback on pointer-down, animate from the current value, interruptible, no bounce unless a gesture threw it.

| Interaction | Behavior |
|---|---|
| Press (rows, text buttons, tokens) | on `pointerdown` opacity .55 at once; release fades back in 200 ms ease-out |
| Press (tiles) | opacity .85 + `scale(.97)` at once; release 200 ms |
| Sheet open / close | translateY spring, damping 1.0, response 0.35 s; scrim opacity follows progress |
| Sheet drag down | 1:1 from the grabber with the grab offset kept; on release project the end point (`v/1000 · .998/(1−.998)`) and dismiss if it passes half the sheet height or the last 100 ms moved faster than .5 px/ms; the scrim dims with the drag; hand the release velocity to the spring |
| Token menu | scale .9 → 1 and opacity from the token's rect (`transform-origin` on the token); damping 1.0, response 0.25 s; closes back into the token in 150 ms |
| Dialog | scrim fades in, card scale .97 → 1 and opacity, 250 ms; leaves in 150 ms ease-out and takes no taps while it goes |
| Apply to expand | height and chevron rotation, damping 1.0, response 0.3 s; tapping again mid-way reverses from the current height |
| Switch | knob slides 150 ms |
| Incompatible marker | 150 ms fade-in, no shake |
| `prefers-reduced-motion` | all of the above become 150 ms opacity cross-fades; a sheet drag does not follow the finger, but a release past the same distance or flick still closes it |
| `prefers-reduced-transparency` | scrims solid at the same luminance |
| `prefers-contrast: more` | `--border` and `--text-2` become `--text` |

No animation library: CSS transitions, the Web Animations API, and a small spring step for the sheet drag.

## 4. Components

Class names are the contract between `app/index.html` (CSS) and the TypeScript that renders.

### 4.1 Circle button `.circle-btn`
44 × 44, radius 50%, `--surface` with the card outline, glyph 20–22 in `--text`. Variant `.circle-btn--accent`: `--accent` fill, white glyph (home `+`). Icon-only, so it always has `aria-label` ("History", "New shortcut", "Back to Shortcuts").

### 4.2 Tile `.tile`
Shared by your shortcuts and templates (canvas: Main).

```html
<div class="tile" data-state="on" style="--c: var(--act-close)">  <!-- on | off | draft -->
  <a class="tile__body" href="#/shortcut/sc_123"
     aria-label="Close Position: when Liq ≤ 3%, do Close 50%. Edit">
    <span class="tile__when">
      <span class="tile__label"><span class="tile__chip">…</span><span class="tile__word">When</span></span>
      <span class="tile__value">Liq ≤ 3%</span>
    </span>
    <span class="tile__do">                       <!-- same markup: `do-empty` chip, `Do` -->
      …<span class="tile__value">Close 50%</span>
    </span>
  </a>
  <button class="tile__switch" role="switch" aria-checked="true" aria-label="Close Position, Liq ≤ 3%">
    <span class="tile__track"><span class="tile__knob"></span></span>
  </button>
</div>
```

- Body: two grid rows, When over Do, shared across a row of tiles (subgrid) so Do starts at one height, at the bottom. Each is a label (20 px chip, white 22%, and a word) over its value (§6.3), trigger and action in the same size. White over the shaded action fill (§3.1), radius 20, padding 16.
- When chip and word: `when` and `When`; `mic` and `Say` for a voice-only shortcut. The shortcut's `name` replaces the word. Do: `do-empty` and `Do`.
- A shortcut bound to a symbol, chosen coins, one position or an order carries its tag after `Do` (`targetTag`: `BTC`, `BTC, ETH longs`, `ETH short`, `SOL order`; `One symbol` and the like while a template has it to fill), in the chip's fill; the label ends `, on BTC`.
- Switch: over the top-right corner (50 × 44 target), above the body link, so tapping it never opens the editor. On: white track, knob in the card's color. Off: track white 26%, white knob.
- `data-state="off"`: switch off and a darker shade; no text prefix. `data-state="draft"`: the word is `Draft`, switch `aria-disabled="true"`; tapping it opens the editor with the missing values marked (§5.10).
- Busy: while `enable` / `pause` is in flight the switch shows the new position at 60% opacity; on failure it springs back and a toast shows the server's `Issue.message`.
- Template variant `.tile--template`: the whole tile is one `<button>` with the same fill and When / Do layout; a 26 px badge (white 25%, `plus` 12 px, `aria-hidden`) takes the switch's place. `aria-label="Template: when ROI ≥ 20%, do SL to entry. Add"`.
- Grid: 2 columns, 12 px gap. At root font size ≥ 22 px: 1 column.

### 4.3 Token `.token`
Inline-block `<button>` in a sentence: padding 0 6, line-height 26 (inside the 32 px sentence line), radius 6, `--token-bg` fill, `--accent-text` text, `white-space: nowrap` so a token always wraps whole.
- `.token--error`: `--error-bg` / `--error`.
- `.token--placeholder` (board DraftEditor): transparent fill, 1 px dashed `--accent-text` border, text like `choose symbol`; used for missing template values.
- Pressed: fill one step darker (`#DFE1FA`, dark `#30356A`) on `pointerdown`.
- `aria-label`: `<field>, <value>, edit` (e.g. "ROI threshold, 30 percent, edit"); a token whose visible text is its own label ("above") needs none.
- Plain grammar words (`When`, `is`, `by`, `within`, `to`, `Do`) are text nodes, never buttons.

### 4.4 Card and sentence row `.card`, `.row-line`
Card: `--surface`, outline, radius 20, padding per §3.3, `sentence` style. A row line is `<div class="row-line"><p>…tokens…</p><button class="remove">` with the remove button 44 × 44 pulled into the card padding (`margin: -6px -12px -6px 0`) so it does not push the text.

### 4.5 Chip `.chip`
24 × 24 inline at the start of a sentence (`vertical-align: -5px; margin-right: 8px`), radius 6, glyph 14. Variants: `.chip--when` (`--chip` fill, `--text-2` glyph), `.chip--action` (`--text` fill `#222326`, glyph in the action color), `.chip--new` (`--accent` fill, white `plus`). The 26 px version (radius 7, glyph 15) sits in the title pill.

### 4.6 Title pill `.title-pill`
Centered in the editor nav: chip 26 + title (`nav-title`, ellipsis) + 22 px circle (`#E9EAEE`, `down` 10 px in `--text-2`). A `<button>` that opens the title menu (§5.8). On the empty editor it is plain text, no chevron.

### 4.7 Disclosure `.disclosure` (Apply to)
Collapsed: one card row, min height 56: `scope` chip, `Apply to` (`body-strong`), value right-aligned in `--accent-text`, `down` chevron. `aria-expanded="false"`, `aria-controls` = the options list.
Expanded (canvas: ApplyB): same header with `up` chevron; under a 1 px `--border` line, a `radiogroup` of 4 rows, 48 px each: 24 px check slot (`check` in `--accent-text` on the selected row), label, trailing detail (`3 now` for All positions; `right` chevron for the other three).

### 4.8 Bottom sheet `.sheet`
`role="dialog" aria-modal="true"`, focus moves into it and returns to the token that opened it. Grabber 36 × 5 (`#C7C7CC`), nav row 44: `Cancel` (left, `--accent-text`) · title (600) · `Done` (right, 600). Background `--bg`, radius 12 on top, height fits content (max 90% of the viewport). `Done` commits the draft value; `Cancel`, a scrim tap and drag-down discard it. `Done` is disabled while the value is invalid.

### 4.9 Menu `.menu`
Anchored 8 px under the token, left edge clamped to the page inset, width 220, padding 4, radius 12, items 44 high, radius 8. Selected item: `--bg` fill + `check` in `--accent-text`. `role="menu"`, items `role="menuitemradio"`. `--menu-scrim` behind; tapping it closes.

### 4.10 List group `.group`, `.row`, `.switch`
History and Settings: `--surface`, radius 12, no outline; rows min 44 (48 with a switch), padding 0 16, separators 1 px `--border` inset 16 (56 when rows have a chip). Row value in `--text-2`. Row switch 51 × 31: on `--accent`, off `--switch-off`, white knob.

### 4.11 Incompatible marker `.marker`
Under the offending line: `warn` 16 px + `Incompatible` in `marker` style, `--error`. `role="alert"`, `aria-label` = the issue's `message` ("Liquidation distance is incompatible with Increase Position").

### 4.12 Toast, banner, dialog (boards HomeBanner, DiscardDialog, DeleteDialog; the toast is not drawn)
- Toast (the page already has one): bottom, above the safe area, 3 s, text only.
- In-app banner: a top card with the action glyph, `<Title> · <target> · <reason>` and `Confirm on Even G2`; it appears when `GET /notifications?after=` returns an alert while the app is open; tap → `#/history`. Several alerts in one poll show the newest, with `now · +N more`. It never has a confirm button.
- Dialog: centered, 270 wide, title + one line + two stacked buttons. Used only for discarding an edit (§7.1) and deleting a shortcut.

## 5. Screens

### 5.1 Shortcuts — home (board Main)

Top to bottom, page inset 16:
1. Nav row 52: `.circle-btn` History (left, `clock`), `.circle-btn--accent` New shortcut (right, `plus`).
2. `Shortcuts` (`title-large`), 4 px above.
3. Status line (15 / 20, `--text-2`, min height 28, a link to Settings): dot (`--success` when Bybit is connected, `--error` when not) + `Bybit · Demo` (`Bybit · Offline` when not connected) + `glasses` 18 + `G2` (`G2 off` when the lens has not polled `/state` in 10 s, arch §10).
4. Your shortcuts: tile grid, 10 px below the status line, in creation order (oldest first; no reordering in the MVP).
5. `Templates` (`title-section`), 24 px above.
6. One block per template category of arch §12 (Protect, Take profit, Market, Orders), in that order: a collapsible heading like a Notion toggle, then the category's templates in a 2-column grid of `.tile--template`, 4 px below. The heading is an `h3` (17 / 22, semibold) holding one full-width button, min height 44, with a `right` chevron (14, `--text-2`) left of the name; the chevron turns down (0.2 s, none under reduced motion) while open. Tapping anywhere on the row folds or opens that grid; the heading stays. The button carries `aria-expanded` and `aria-controls` (the grid). All open by default. The choice lives on the phone (`createStorage`, key `gt.hiddenTemplates`, since the Even app wipes `localStorage`), so it works while the server is offline. Focus stays on the heading across the 10 s refresh.

Data: `GET /shortcuts` (title, name, `summary`, `doSummary`, enabled, draft flag), `GET /templates` (the same two lines), status from `GET /settings` and `GET /state`. Refetch on route enter and every 10 s while visible.

Interactions:
- Tile body → editor. Switch → `POST /shortcuts/:id/enable` or `/pause` (optimistic, see §4.2). An enable rejected by `validate()` springs back and opens the editor with the issues marked.
- Template → `POST /shortcuts` with that template's rule and `enabled: false` → open the new draft's editor.
- `+` → `#/shortcut/new`.

States:
- Loading: two empty tiles at 40% opacity, no shimmer.
- No shortcuts: the shortcut grid is replaced by one line, `No shortcuts yet. Start from a template or tap +.` (`body`, `--text-2`); Templates stay.
- Server offline: status line `● Server offline` in `--text-2`, switches, templates and `+` disabled (`aria-disabled`), retry every 5 s.

### 5.2 Shortcut Editor (boards Editor, ApplyB)

Full screen, pushed. Top to bottom:
1. Nav row 56, grid `44px 1fr 44px`: back `.circle-btn` (`back`), `.title-pill` (chip filled in the action's color, title = `name` or the action label).
2. Apply to `.disclosure`, 12 px below (§5.3).
3. When card, 24 px below: first line `[when chip] When <condition sentence>`; each further line starts with the group operator token (`or` / `and`); a remove button on every line while there are ≥ 2 lines, none when there is one; then `Add condition` (`body-strong`, `--accent-text`, circled `plus` 20, min height 44). Max 10 lines; `Add condition` hides at 10.
4. Do card, 24 px below: `[action chip] Do <action sentence>` + remove button. Removing the action turns the card into the empty Do card of §5.6.
5. Options row, 24 px below: card row, min height 52: `Options` (`body-strong`), summary in `--text-2` (`On entry · Glasses + phone`), `right` chevron. Opens the Options sheet (§5.7).
6. Confirm line, 12 px below, centered `footnote` in `--text-2`: `glasses` 16 + `Confirm on Even G2` (for `Notify`: `Shows on Even G2`).

Sentence words per condition and action come from `GET /catalog` (arch §4 table); the phone never hardcodes them. Sentence examples, as drawn:
- `When [ROI] is [above] [30%]` / `[or] [price change] [rises] by [5%] within [5 min]`
- `Do [move stop loss] to [entry price]`
- `When [liquidation distance] is [below] [5%]` · `When [price] [crosses above] [90,000 USDT]` · `When [stop loss is missing]` · `When [order] is [partly filled]`
- `Do [close position] by [50%]` · `Do [set stop loss] to [2% adverse from entry]` · `Do [increase position] by [100 USDT]` · `Do [notify]`

Data: the shortcut from `GET /shortcuts`, `GET /catalog`, and `POST /shortcuts/validate` on every draft change (debounced 250 ms, the previous request aborted). The validate answer also carries the `N now` count for Apply to and each condition's current values for the numeric sheet (arch §10).

### 5.3 Apply to (boards Editor collapsed, ApplyB open)

| Option | Collapsed value | On select |
|---|---|---|
| All positions | `All positions` | sets `ALL_POSITIONS`, collapses; the open list shows `N now` from validate |
| One position | `BTCUSDT · Long` | opens the position picker (`GET /positions`; rows `BTCUSDT · Long · 0.050 BTC`), then collapses |
| One symbol | `BTCUSDT` | opens the symbol picker: search field, `Positions and orders` (their symbols), then `All symbols` (`GET /symbols`, the exchange's USDT perpetuals), both filtered by the search; until that list arrives, or when it fails, the typed symbol is offered as is, and once it is there a symbol not on it is not offered (`No results`). Then collapses |
| One order | `BTCUSDT · Buy limit 88,500` | opens the order picker (`GET /orders/open`; rows `BTCUSDT · Buy limit 88,500 · 0.030`), then collapses |
| All orders | `All orders` | sets `ALL_ORDERS` (filled, partly filled or order age; fills act on the position the order opened), collapses |

Long values end with an ellipsis; `aria-label` keeps the full value. Options that can never fit the current action are hidden (e.g. One order for Open Position; Open needs One symbol, Cancel needs One order, arch §7). A scope change that breaks a condition marks that line (§5.9); conditions are never removed silently.

### 5.4 Token editors

| Token kind | Opens | Content |
|---|---|---|
| Metric (`ROI`, `price`, `price change`, `liquidation distance`, `stop loss distance`, `take profit distance`, `profit`, `loss`, `stop loss is missing`, `order` …) | Condition type sheet | compatible types only (§7.3), grouped Price · PnL · Liquidation · Stop and target · Orders, 48 px rows with glyph |
| Comparison (`above` / `below`, `crosses above` / `crosses below`, `rises` / `falls`), side (`long` / `short`) | Menu (§4.9) | 2–4 items |
| Group operator (`or` / `and`) | Menu | `or`, `and`; one value for the whole group, every operator token shows it |
| Number (`30%`, `5%`, `100 USDT`, `90,000 USDT`, `5 min`, leverage `10×`) | Numeric sheet (§5.5) | |
| Close amount (`50%`) | Close amount sheet (board ClosePercent) | `25%` `50%` `75%` `100%` `Custom` (Custom opens the numeric sheet); one choice; note `Market order, reduce-only` |
| Stop / target (`entry price`, `2% adverse from entry`, a price) | Target sheet (board TargetSheet) | three rows: `Entry price` · `% from entry` (number + `Adverse` / `Favorable`, shown under the selected row) · `Price` (only for one-symbol or one-position scopes, otherwise disabled with `Needs one symbol or position`); note `Moves only closer. The exact price shows on Even G2 before you confirm.` (Move Stop Loss) |
| Action (`move stop loss` …) | Action type sheet | §7.3 |
| Placeholder (`choose symbol`, `choose order`) | Matching picker | |

Changing a metric, unit or comparison family clears the dependent number and opens the numeric sheet at once; a value is never carried into a different unit. Flipping `above` ↔ `below` on ROI or PnL switches PROFIT ↔ LOSS and asks for a new value (arch §4).

### 5.5 Numeric sheet (board NumericSheet)

Over the editor, `--scrim` behind. Nav: `Cancel` · field name (`ROI`) · `Done`. One white row, radius 12, height 60: comparison word left (`Above`, `Below`, `By`, `Within`; `--text-2`, 17), value right-aligned (`numeric`), unit after it (`%`, `USDT`, `min`, `×`; `--text-2`, 30). Below it one `footnote` line: the current value from validate (`Now 18.2% on BTCUSDT long`; several targets → the closest one), or for a distance `From mark price · now 7.4% on BTCUSDT long`.

- Input: `<input inputmode="decimal">` with the system keyboard. The keypad on the canvas is the system keyboard; do not build one.
- Draft until `Done`; `Cancel` restores the old value.
- Bounds come from the catalog. Out of bounds: the footnote line turns into one `--error` line (`Enter a number from 0.1 to 100`) and `Done` disables.
- Decimal strings, never floats: the value is sent as typed after trimming trailing zeros.

### 5.6 New Shortcut (board NewShortcut)

The editor with nothing chosen: title `New Shortcut` with `.chip--new`, no chevron. Apply to defaults to All positions. When card: `[when chip] When` + `Add condition`. Do card: `[do-empty chip] Do` + `Add action`. Either may be chosen first; each list filters by what is already chosen (§7.3). Nothing is created on the server until the first valid save (§7.1).

### 5.7 Options sheet (board OptionsSheet)

Drawn groups: `WHEN IT FIRES` (radio rows with a short `--text-2` hint on the right; a disabled row says why), `DELIVERY` (two row switches), `VOICE PHRASE` (field with a microphone glyph, note `Say it on Even G2 to run this shortcut now.`), then one group with `Send a test alert` (`--accent-text`) and `Delete shortcut` (`--error`).

| Row | Control | Rule |
|---|---|---|
| When it fires | radio: `On entry` · `On event` · `Once` · `Repeat every [5 min]` | rules with a crossing or a fill are `On event` only; Open and Increase are `Once` only; the others are disabled with a one-line reason |
| Show on glasses | switch | `delivery.glasses` |
| Send to phone | switch | `delivery.phone` (Telegram when the lens is closed, arch §10) |
| Voice phrase | text field, placeholder `e.g. protect all` | ≤ 40 lowercase letters, digits, spaces; unique per account (arch §4) |
| Test alert | button | `POST /shortcuts/:id/test`; toast `Test alert sent`; History shows `Simulation · nothing sent to Bybit` |
| Delete shortcut | destructive button (`--error`) | dialog `Delete this shortcut?` · `Delete` / `Cancel` |

The Options row summary is `<trigger> · <delivery>`: `On entry`, `On event`, `Once`, `Every 5 min`; `Glasses + phone`, `Glasses`, `Phone`, `Off`.

### 5.8 Title menu (boards TitleMenu, RenameSheet)

Menu under the title pill: `Rename` (sheet with one text field; empty restores the action label), `Duplicate` (copy, disabled, opens it), `Test alert`, `Delete` (as in §5.7).

### 5.9 Incompatible state (board Incompatible)

Driven only by `POST /shortcuts/validate` issues (arch §7):
- `issue.conditionId` set → that line's tokens get `.token--error`, its plain words `--error`, and a `.marker` goes under the line. The group operator token stays normal.
- `issue.field === 'action'` → marker under the Do card. `issue.field === 'scope'` → marker under Apply to.
- The title already shows the new action. The rest of the draft is untouched; the user removes or changes the marked line.
- While issues exist the shortcut cannot be saved or turned on; leaving runs the dialog of §7.1.

### 5.10 Drafts from templates

Selecting a template immediately persists a disabled shortcut. A complete template shows as an off tile. An incomplete one shows `Draft` as its When word and survives leaving the editor and reloading the phone page. Templates 10–15 need a symbol or an order: the editor shows `.token--placeholder` for it, and Apply to shows `Choose…` in `--error`. Validate returns a `missing` issue per gap; the switch stays disabled until there are none.

### 5.11 History (board History)

Nav: back link `Shortcuts` with `back` chevron (left), `History` (`nav-title`, centered), gear → Settings (right). Groups by local day: `TODAY`, `YESTERDAY`, then `MON 23 NOV` (`group-label`). Each row (padding 10 16, gap 12):
- 28 px chip, radius 7, filled in the action color, action glyph 18 in `#0C0C0C`;
- line 1: action label (`body`, 17 on canvas → use 16) and time `HH:mm` right-aligned (`--text-2`, tabular);
- line 2: target and reason (`--text-2`): `BTCUSDT long · liquidation distance 3.2%`, `Voice: protect all`;
- line 3: last status (600), strings from arch §9, for example: `Submitted · waiting for fill`, `Filled · 0.025 BTC at 88,412.0`, `Dismissed on Even G2`, `Sent to Telegram · glasses disconnected`, `Expired · not confirmed within 30 s`, `Skipped · partial stop orders on this position`, `Simulation · nothing sent to Bybit`, `Shown on Even G2`, `Shown in the app`, `Withdrawn · shortcut changed`.

Data: `GET /history?before=`, 50 per page by default, next page when the last row comes into view. Rows are not tappable in the MVP. Empty: `No alerts yet.`

### 5.12 Settings (board Settings)

| Group | Row | Control | Source |
|---|---|---|---|
| BYBIT | Status | `● Connected` / `● Offline` | `GET /settings` |
| | Environment | `Demo` or `Testnet` (read-only) | |
| | API access | reported key permissions (read-only) | `/v5/user/query-api` |
| | Withdrawals | reported key permission (read-only) | |
| | Live trading | `Off` (demo/testnet only) | |
| EVEN G2 | Glasses | `● Connected` / `Not connected` | lens polled `/state` in 10 s |
| NOTIFICATIONS | Show alerts on glasses | switch | `PUT /settings` |
| ON YOUR GLASSES | Gesture tips | local on/off override for lens navigation hints | device storage |
| CONNECTION | Server address and server token | installed package defaults to its configured HTTPS origin | device storage |
| NOTIFICATIONS | Telegram | `Link` → `POST /settings/telegram`, opens `t.me/<bot>?start=<code>`; linked: `Linked` + `Unlink` | arch §10 |
| TIMING | Repeat cooldown | `60 s` → numeric sheet, 10–300 | |
| | Trade proposals expire | `30 s` → numeric sheet, 10–300 | |
| | Other proposals expire | `60 s` → numeric sheet, 10–300 | |

In-app notifications have a switch (`In-app notifications`, Notifications group, `PUT /settings` `notifications.app`); when on, they show whenever the app is open.

## 6. Text rules

### 6.1 Titles
`CLOSE_POSITION` Close Position · `MOVE_SL` Move Stop Loss · `SET_SL` Set Stop Loss · `SET_TP` Set Take Profit · `ADD_MARGIN` Add Margin · `OPEN_LONG` Open Long · `OPEN_SHORT` Open Short · `INCREASE_POSITION` Increase Position · `CANCEL_ORDER` Cancel Order · `NOTIFY` Notify. `name` overrides the label everywhere.

### 6.2 Numbers
Thousands with `,` (`90,000`); decimals as entered; percent attached (`30%`); negatives with U+2212 (`−20%`); `USDT` after a space (`100 USDT`); prices on tiles without a unit; coin from the symbol without `USDT` in the tile's tag (`BTC`); minutes `5 min`; leverage `10×`; quantities to the instrument step (`0.025 BTC`).

### 6.3 Tile lines
The server words both lines of every tile and template, as `summary` (When) and `doSummary` (Do) on `GET /shortcuts` and `GET /templates`: `conditionSummary` and `actionSummary` in `server/src/proposals.ts`. No `Off ·` or `Draft ·` prefix; a value a template leaves open is `…`.
- When: every condition, joined by ` or ` / ` and `; a rise or fall of one size joined by `or` is `Price ±15%`; a voice-only shortcut shows its phrase, `“protect all”`.

| Condition | When line |
|---|---|
| PRICE GTE / LTE | `Price ≥ 90,000` / `Price ≤ 90,000` (`Mark`, `Index` for those sources) |
| PRICE UP_CROSS / DOWN_CROSS | `Price crosses above 90,000` / `Price crosses below 90,000` |
| PRICE_CHANGE UP / DOWN | `Price +3%` / `Price −3%` (from the price when it was switched on, then from its last alert) |
| PROFIT ROI / USDT | `ROI ≥ 30%` / `Profit ≥ 100 USDT` |
| LOSS ROI / USDT | `ROI ≤ −20%` / `Loss ≥ 100 USDT` |
| NEAR_LIQUIDATION | `Liq ≤ 5%` |
| NEAR_SL / NEAR_TP | `SL ≤ 1%` / `TP ≤ 1%` |
| ORDER_FILLED / ORDER_PARTIAL | `Order filled` / `Order partly filled` |
| VOLUME_SPIKE | `Volume 3× in 5 min` |
| FUNDING | `Funding ≥ 0.05% in 30 min` |
| ORDER_STALE | `Order open ≥ 1 h` |
| POSITION_CLOSED | `Liquidated` / `Closed by stop loss` / `Closed by take profit` |

- Do: `Close 50%` · `SL to entry`, `SL at −2%`, `SL at 64,250` (`TP` likewise) · `Add 50 USDT margin` / `Add 25% margin` · `Long 100 USDT ×10` / `Short …` (no leverage when there are several; `Open Long` / `Open Short` when there are several sizes) · `Add 100 USDT` · `Cancel order` · `Notify me`.

### 6.4 Copy deck (fixed strings)
`Shortcuts` · `Templates` · `Bybit · Demo` · `Bybit · Offline` · `Server offline` · `G2` · `G2 off` · `No shortcuts yet. Start from a template or tap +.` · `New Shortcut` · `Apply to` · `All positions` · `Positions by coin` · `Long and short` · `One position` · `One symbol` · `One order` · `of its margin` · `N now` · `When` · `Do` · `Add condition` · `Add action` · `Options` · `Confirm on Even G2` · `Shows on Even G2` · `Incompatible` · `Cancel` · `Done` · `Market order, reduce-only` · `Custom` · `Discard changes?` · `This shortcut has a problem that stops it from saving.` · `Keep editing` · `Discard` · `Delete this shortcut?` · `Delete` · `Test alert sent` · `Changed on another device. Reloaded.` · `No alerts yet.` · `History` · `Settings`.

## 7. Behavior

### 7.1 Draft and save
The editor works on a local copy (`structuredClone`). On back:
- nothing changed → go back;
- changed and validate `ok` → `PUT /shortcuts/:id` (or `POST /shortcuts` for a new one) with the `version` it was opened at, toast `Saved` (or `Saved. Off until you turn it on in Shortcuts` when the shortcut is off), then go back. An enabled shortcut stays enabled; the server makes a new version and invalidates old proposals (arch §4);
- changed and not `ok`, or a new shortcut with no condition or no action → dialog `Discard changes?` / `This shortcut has a problem that stops it from saving.` / `Keep editing` (primary) · `Discard`;
- `409` (newer version on the server) → toast `Changed on another device. Reloaded.` and reload the editor;
- network error → stay, toast, nothing lost.

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
While the app is open: `GET /notifications?after=` every 5 s for the banner (§4.12); home refetches every 10 s online and every 5 s offline; the editor does not poll. No push in the MVP.

### 7.6 Offline
Server unreachable: home as in §5.1; the editor shows its last data read-only (tokens inert, back works without saving) and a toast `Server offline`.

## 8. Accessibility

- Contrast: every pair in §3.1 meets 4.5:1 for text and 3:1 for icons and control edges in both themes.
- Targets: buttons, rows, switches and remove buttons are ≥ 44 × 44 without overlap. Tokens are an accepted exception, as in Apple Shortcuts: 32 px tall (the sentence line) with 4 px extra on each side horizontally; never closer than 6 px to the next line's token.
- Text size: all sizes in `rem`; at root ≥ 22 px tiles go to one column, sheet rows grow, the title pill truncates (the label keeps the full title). Nothing is clipped; everything wraps.
- VoiceOver / TalkBack: labels as in §4; switches `role="switch"` + `aria-checked`; disclosure `aria-expanded`; menus `role="menu"`; sheets `role="dialog" aria-modal="true"` with a focus trap; the marker is announced once per new issue.
- Color is never the only signal: an off tile's knob sits left (and the card is darker), error lines carry `Incompatible`, status dots sit beside words.
- Reduced motion, reduced transparency, more contrast: §3.5.

## 9. Where it goes in the code

| What | Where |
|---|---|
| Tokens and component CSS | `app/index.html` (replace the current Even-style `:root` and phone styles) |
| Phone page logic | split the "phone page" part of `app/src/main.ts` into `app/src/phone/`: `router.ts`, `home.ts`, `editor.ts`, `sentence.ts` (rule → DOM tokens from catalog words), `sheets.ts`, `menu.ts`, `history.ts`, `settings.ts` |
| API calls | extend `app/src/api.ts` with the endpoints of arch §10 |
| Types | import from `server/src/registry.ts` (types only, as `view.ts` already imports from `server/src`) |
| Icons | `app/src/icons.ts` |
| Font | `app/public/fonts/InterVariable.woff2` |
| Remove | `app/src/shortcuts.ts` (old voice-shortcut list) once arch §13 step 1 lands |

No framework and no animation library. Unit-test the tile lines (§6.3), the token renderer and the save-or-discard decision with `node --test` next to the existing `app/test/*.test.ts`.

## 10. Acceptance tests (phone)

| ID | Do | Expect |
|---|---|---|
| P01 | Open the app with 4 shortcuts | 2-column tiles in creation order, each When over Do; the off one is darker with its switch off |
| P02 | Tap a tile's switch | API call, switch moves; on a server error it springs back and a toast shows the reason; the editor does not open |
| P03 | Tap a tile body | editor opens for that shortcut |
| P04 | Tap template 10 | the disabled draft survives leaving, reloading, and reopening; editor shows `choose symbol`; its switch cannot turn on until a symbol is picked |
| P05 | Tap `+`, then back at once | nothing is created |
| P06 | Tap `above` | menu under the token with a check on `Above`; `is` is not tappable |
| P07 | Tap `30%` | numeric sheet, `30` prefilled, `Now …` line; `Cancel` restores; `0` shows the red bounds line and disables `Done` |
| P08 | Change `ROI` to `price change` | the number clears and the numeric sheet opens; no value carried over |
| P09 | Close amount | one choice only; `Custom` opens the numeric sheet |
| P10 | Add a second condition | `or` token on line 2, remove buttons on both lines; remove one → one line, no remove button |
| P11 | Set the operator to `and` | every operator token shows `and`; `logic` is `ALL` |
| P12 | Apply to | with no action selected, all five scopes are available; selecting an action filters the scopes by compatibility. Show the matching target count; One position opens the picker; choosing collapses to `BTCUSDT · Long` |
| P13 | Profit OR Near liquidation, open the action sheet | Increase Position is not listed; Close Position is |
| P14 | Profit AND Loss | validate marks a line; cannot save |
| P15 | Open Position with All positions | Open is not offered; with One symbol it is |
| P16 | Options for Increase Position | only `Once` is selectable |
| P17 | Save after another device saved | toast `Changed on another device. Reloaded.` |
| P18 | History | grouped by day; statuses are exactly the strings of §5.11; 60 alerts load as 50 then 10 at the end |
| P19 | Settings switches | persist via `PUT /settings`; read-only rows are not tappable |
| P20 | Text size 200% | one-column tiles, no clipped text, no overlapping targets |
| P21 | Dark mode | dark tokens applied; contrast as §3.1 |
| P22 | Reduce motion | no transforms, cross-fades only |
| P23 | VoiceOver | reads "ROI threshold, 30 percent, edit"; switches announce on/off; the marker is announced |
| P24 | Server offline | status line says so; switches and templates disabled; editor read-only |
| P25 | Options › Test alert | History shows `Simulation · nothing sent to Bybit`; nothing reaches Bybit |
| P26 | An alert fires while the app is open | banner appears; tap opens History; no confirm button anywhere on the phone |

## 11. Changes from v1

| v1 | v2 | Why |
|---|---|---|
| Root cards with full When/Do sentences and inline token editing | Colour tiles (When trigger over Do action + switch), editing only in the editor | Apple Shortcuts library layout, chosen on the canvas |
| Separate New Shortcut sheet with template rows | Templates as tiles on the home screen, grouped in four categories, each a heading that folds its grid away (25 November 2026: 10 templates instead of 25, the ones where answering on the glasses matters); `+` top right opens an empty editor | user decision |
| Modal editor with Cancel / Done | Pushed editor, back button saves when valid (§7.1) | Apple Shortcuts automation editor reference |
| One grouped When/Do card | Separate Apply to, When, Do cards, 24 px apart | clearer separation |
| Scope row / segmented control | `Apply to` disclosure with five possible scopes | user decision |
| iOS system colors, SF Pro, 17 pt sentences | Linear-style palette, Inter, 18 px sentences, 20 px radius | user decision |
| Large incompatible explanation | Red line + `Incompatible` marker | less text |
| Per-card overflow menu (Edit, Duplicate, Test, Delete) | Title menu and Options sheet in the editor | tiles have no room |
| `Sent to phone` status | `Sent to Telegram` | arch §9–§10 picked Telegram |
| Lens section | `glasses-shortcuts.md` | separate document |

## 12. Where each screen is drawn

Canvas page **Flow**: Main, TokenMenu, NumericSheet, ClosePercent, NewShortcut, Editor, Incompatible, History, Settings (historical board; use §5.12 for the current rows), ApplyB, EditorRule.

Canvas page **More screens**:
- Editor menus, sheets and dialogs: TitleMenu, RenameSheet, OptionsSheet, DeleteDialog, ConditionSheet, ActionSheet, TargetSheet, DiscardDialog.
- Pickers, drafts and home states: PositionPicker, SymbolPicker, OrderPicker, DraftEditor (template 10 with placeholder token and `Choose symbol`), HomeBanner, HomeEmpty, HomeOffline, HomeDark.

The home states come from one board: Main has a `variant` tweak (`normal`, `empty`, `offline`, `dark`), and the state boards import it with that value.

Still not drawn: the toast, the loading state of home, and dark mode for screens other than home. Build them from this document.
