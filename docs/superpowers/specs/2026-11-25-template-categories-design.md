# Template categories, a shorter list, price change 15% on any coin

Approved by the user on 25 November 2026. The user asked for the 15% template and "any coin" in the same approval, and for the work to be done by a subagent (design on Opus 5.5). Points marked *(call)* were not discussed.

## Why

25 templates in one grid are too many to choose from. Keep the ones where answering on the glasses matters, group them, and let the user fold a group away. A price alert must work for any coin the exchange lists.

## Approaches

- ~~Switch in each category header.~~ Off hides the cards, the header stays. Picked first, then replaced (below).
- Switches in Settings. A cleaner home screen, but a hidden category is hard to bring back.
- **Collapsible heading, like a Notion toggle (picked, 25 November 2026).** The user meant this from the start and asked for the switch to be removed.

## Templates (10)

`Template` gets `category`; `TEMPLATES` is listed in this order. Ids stay stable.

| Category | Id | Card |
|---|---|---|
| Protect | tpl_6 | Close position · Near liquidation · half |
| Protect | tpl_17 | Notify · Closed by stop loss |
| Take profit | tpl_1 | Move stop loss · ROI above 20% · breakeven |
| Take profit | tpl_2 | Close position · ROI above 50% · half |
| Market | tpl_10 | Notify · Price crosses a level |
| Market | tpl_26 (new) | Notify · Price moves 15% in 4 h |
| Market | tpl_11 | Notify · Price falls 2% in 5 min |
| Market | tpl_20 | Notify · Funding above 0.05% in 30 min |
| Orders | tpl_14 | Set take profit · Order filled |
| Orders | tpl_24 | Cancel order · Order open over 1 h |

The other templates are removed. Conditions, actions, the editor and saved shortcuts do not change.

**tpl_26:** scope one symbol (empty, the user picks it); `PRICE_CHANGE` last price UP 15% **or** DOWN 15%, window 14400 s; Notify; on entry. *(call)* 4 h is the longest window the engine has; 24 h would need engine changes. Both directions, since "price change" names neither.

## Home screen

Under `Templates`, one block per category: a collapsible heading, the 2-column grid below. At the user's request the switch that first sat on the heading's right was replaced by this heading: a chevron left of the name points right when folded and down when open, and tapping anywhere on the row folds or opens that grid. It is a button inside the `h3` with `aria-expanded` and `aria-controls`, at least 44 px tall. All open by default. The choice is kept on the phone through `createStorage` (the Even app wipes `localStorage`; the key is still `gt.hiddenTemplates`), so it works while the server is offline. Focus survives the 10 s refresh. Styling follows `docs/design.md` and `brand/README.md`.

## Any coin

- `Exchange.symbols()`: Bybit `GET /v5/market/instruments-info?category=linear`, all pages (`nextPageCursor`), USDT linear perpetuals with status `Trading`, sorted, cached for an hour.
- `FakeExchange` lists only the symbols it can price *(call)*, so the paper demo offers its own coins.
- `GET /api/symbols` returns the names.
- Symbol picker: your position and order symbols first, then every symbol, filtered by search. While the list loads or if it fails, the typed symbol is still offered, as today. With the list loaded, a symbol that is not on it is not offered.

## Also touched

Sandbox "Build your own" moves from tpl_3 to tpl_2 (another session is editing the sandbox: change only those lines). The landing builder keeps its examples without relying on removed templates. Tests keep their engine coverage with the removed drafts as test fixtures. Docs that name the 25 templates are updated, including the "no categories" decision in the phone spec.

## Not included

Deploy, rebuilding the landing page's committed bundle, packing the `.ehpk`, a 24 h window.
