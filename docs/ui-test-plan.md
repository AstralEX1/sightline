# Trade Shortcuts UI test plan

Manual-style UI tests run by agents against an isolated stand. Sources of truth for expected strings: `docs/trade-shortcuts-spec.md` (phone, §5–§10) and `docs/glasses-shortcuts.md` (lens, §2–§9). When this plan and a spec disagree, the spec wins; report the mismatch.

## Stand

| Piece | Where |
|---|---|
| Code copy | `$STAND` = scratchpad `stand/` (copy of `app/` and `server/`, with disposable local credentials; `node_modules` symlinked). Own DB `server/data/fake.db`. |
| Server | `EXCHANGE=fake PORT=8811`, API at `http://localhost:8811/api` |
| Phone page | `http://localhost:5191/phone.html` (phone only, no lens) |
| Lens app | `http://localhost:5191/` in the Even Hub simulator, automation port 9931 |
| Token | `APP_TOKEN` in `$STAND/.env`, `Authorization: Bearer <token>`; `VITE_APP_TOKEN` is set, so the page connects by itself |
| Demo exchange | BTCUSDT isolated long sliding toward liquidation; ETHUSDT short, no stop; SOLUSDT long in profit |

Never point anything at Bybit or edit `.env`. Do not edit source code: report bugs.

Shared server: several testers run at once. Prefix every shortcut you create with your tester letter (Rename: `A1 …`), touch only your own shortcuts, never assert global counts.

## Phone (viewport 390 × 844 unless stated)

| ID | Precondition | Do | Expect |
|---|---|---|---|
| P01 | 4 own shortcuts, one off | open home | 2-column tiles in creation order, each When over Do; off tile darker, knob left; status line `Bybit · Demo`, `G2` / `G2 off` |
| P02 | an own shortcut | tap its switch on, off; then make enable fail (incomplete draft) | API call, switch moves; failure springs back + toast / editor with issues; body does not open on switch tap |
| P03 | | tap tile body | editor of that shortcut |
| P04 | | tap template 10 (needs symbol) | return to Shortcuts, reload, and reopen the same disabled tile (its When word reads `Draft`); editor shows `choose symbol` placeholder, Apply to `Choose…` red; switch cannot turn on until symbol picked |
| P05 | note tiles | `+`, then back at once | nothing created |
| P06 | ROI condition | tap `above` | menu under token, check on `Above`; `is` not tappable |
| P07 | ROI 30% | tap `30%` | numeric sheet, `30` prefilled, `Now …` line; Cancel restores; `0` → red bounds line, Done disabled |
| P08 | | change `ROI` → `price change` | number cleared, numeric sheet opens, no value carried |
| P09 | Close action | tap close amount | 25/50/75/100/Custom, one choice; Custom opens numeric sheet; note `Market order, reduce-only` |
| P10 | | add 2nd condition, remove it | `or` token on line 2, remove buttons on both; after removal one line, no remove button |
| P11 | 2 conditions | operator → `and` | every operator token shows `and`; saved rule `logic: ALL` (check via API) |
| P12 | | Apply to | with no action selected, 5 options (All orders included); after choosing an action, only compatible scopes with `3 now`; One position → picker `BTCUSDT · Long · 0.050 BTC`; collapses to `BTCUSDT · Long` |
| P13 | Profit OR Near liquidation | open the action sheet | Increase Position is not listed; Close Position is |
| P14 | | Profit AND Loss | a line marked; cannot save |
| P15 | All positions | open action sheet | Open Position not offered; with One symbol it is |
| P16 | Increase Position | Options | only `Once` selectable, others disabled with a reason |
| P17 | editor open | change the same shortcut via `PUT /api/shortcuts/:id`, then save in UI | toast `Changed on another device. Reloaded.` |
| P18 | a few alerts | History | grouped by day (`TODAY`…); statuses as spec §5.11; empty state `No alerts yet.`; with 60 alerts, scrolling loads 50 then 10 |
| P19 | | Settings: toggle switches, reload | persisted (`GET /api/settings`); read-only rows not tappable; timing sheets bounded 10–300 |
| P20 | | root font 200% (`document.documentElement.style.fontSize`) | one-column tiles, no clipped text, no overlapping targets |
| P21 | | `prefers-color-scheme: dark` | dark tokens; text readable |
| P22 | | `prefers-reduced-motion: reduce` | no transforms on sheets/switches, fades only |
| P23 | | accessibility tree | switches `role=switch` + `aria-checked`; disclosure `aria-expanded`; menus `role=menu`; sheets `role=dialog aria-modal`; focus trapped in sheet; switch hit area ≥ 44 × 44 CSS px; click inside the target above the painted track and verify the state toggles |
| P24 | | stop the server | status `Server offline`; switches/templates `aria-disabled`; editor read-only, back works; recovers when server is back |
| P25 | own shortcut | Options › Send a test alert | toast `Test alert sent`; History `Simulation · nothing sent to Bybit`; no exchange order (`GET /api/positions` unchanged) |
| P26 | app open | an own enabled shortcut fires | banner appears; tap → History; no confirm button anywhere on the phone |
| P27 | | Rename to empty, Duplicate, Delete (dialog Cancel then Delete) | empty name restores action label; duplicate opens disabled copy; delete removes tile |
| P28 | | numeric input `1.50`, `abc`, `-5`, huge number | sent as `1.5`; invalid → bounds line, Done disabled |
| P29 | | voice phrase `Protect All!`, a duplicate phrase | rejected or normalized per arch §4 (≤40 lowercase, unique) with a visible message |
| P30 | | break-ui: 40-char name, many conditions (10) | title truncates with ellipsis, `Add condition` hides at 10, nothing overlaps |

## Lens (simulator, 576 × 288)

| ID | Precondition | Do | Expect |
|---|---|---|---|
| L01 | no own alerts | launch | Main: top `Bybit Demo · 3 positions` … time; rows sorted by liq distance; `liq x%` flag on BTC only; extra tips follow the launch count and Gesture tips setting; exit remains visible |
| L02 | Main | swipe down/up | `▶` moves, brightness swaps; no page rebuild flicker |
| L03 | Main | tap | Detail of `▶` position: top `BTC long · 10×` … `1/3`, table, big PnL, `swipe: next position · double tap: back` |
| L04 | Detail | swipe, double tap | next position; back to Main with cursor on the same position |
| L05 | | enable a Close 50% on near-liquidation shortcut | Alert frame, `BTC long`, `x% to liquidation`, `> Dismiss` selected, `Close 50% · 0.025 BTC` below |
| L06 | new alert | tap within 1 s | ignored (`CARD_SETTLE_MS`) |
| L07 | alert | swipe to action, tap | Sent (`waiting for Bybit · double tap: hide`, taps ignored) → Filled with `> OK`; History on phone matches |
| L08 | alert | double tap | dismissed; History `Dismissed on Even G2` |
| L09 | 2 alerts | | queue `1/2`, then next after answering |
| L10 | Open Position shortcut | tap `Review long …` | Review opens; double tap returns to Dismiss, leaves proposal pending and position unchanged. Re-enter Review and explicitly confirm once |
| L11 | trade alert | wait > 30 s | Expired · nothing sent, `> Dismiss` only |
| L12 | | phone Test alert | lens queue `TEST`; tap ends in `Test only · nothing was sent` |
| L13 | OR rule both branches true | | one alert, strongest reason (liquidation beats ROI) |
| L14 | Main | double tap | host exit dialog |
| L15 | | console (`/api/console`) during all of the above | no uncaught errors or failed fetches |
| L16 | | stop server | Main top bright `No connection to your server · retrying`, table hidden, no alert; recovers |

## Additional acceptance checks

- Delay the lens highlight update after a swipe. A tap before acknowledgement leaves the proposal pending. A tap after the highlight appears confirms the selected action.
- With stale exchange data only Dismiss is available. For an ambiguous submission, show Unknown and reconcile from exchange state. Unknown Add Margin blocks another margin addition and still permits Close.
- In Settings → Connection save a valid HTTPS address and test server token. Restart the app and verify the authenticated connection resumes. Switch Gesture tips off, restart, then on and restart again. Check that Main follows the saved preference and Exit remains visible.
- Build an .ehpk with a single HTTPS backend origin. Install it, enter the server token in Connection and verify positions load from the configured server. Check microphone interruption, Detail redraw and R1 input on physical G2 hardware. Record the build, device and result.

## Split

| Tester | Model | IDs | Browser |
|---|---|---|---|
| A | Sonnet | P01–P17 | `playwright-cli -s=a` |
| B | Haiku | P18, P19, P25–P29 | `playwright-cli -s=b` |
| C | Haiku | P20–P23, P30 | `playwright-cli -s=c` |
| D | Sonnet | L01–L15 | simulator, port 9931 |
| E | Haiku, after A–D | P24, L16 | both |

## Verification on 25 November 2026

Local FakeExchange and headless Chrome at 390 × 844. P04 persisted an incomplete price-crossing template, returned home, reloaded, and reopened the same shortcut ID. For P23 the Gesture tips switch measured 51 × 44 CSS px and a click 2 px below its top edge toggled its state. These checks cover the browser interactions; physical screen-reader and G2/R1 checks remain open.

## Report

Each tester writes `reports/<letter>.md` in the scratchpad: one row per ID `ID | PASS / FAIL / BLOCKED | evidence (screenshot path, API output) | note`, then each FAIL as a bug: steps, expected, actual, likely file:line.
