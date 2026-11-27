/**
 * Shortcut editor (spec §5.2–§5.10, §7): Apply to, When, Do, Options on a local copy; validate on every change;
 * written only by the editor's save action (§7.1). Trade proposals are confirmed on the lens.
 */
import * as api from '../api.ts'
import type { ApiError, Catalog, Preview } from '../api.ts'
import type { Action, Condition, ConditionType, Scope, Target, TriggerMode } from '../../../server/src/registry.ts'
import type { EditableShortcut, Issue } from '../../../server/src/validate.ts'
import type { Order, Position } from '../../../server/src/types.ts'
import { normalizePhrase } from '../../../server/src/rules.ts'
import { ACTION_ICON, REMOVE, WARN, icon } from './icons.ts'
import {
  actionChoices, conditionChoices, emptyDraft, fitTrigger, inRange, leaveDecision, newAction, newCondition, nextId, numField,
  rangeText, scopeChoices, setCompare, setMetric, setNumber, triggerChoices, type Draft, type Range,
} from './model.ts'
import { actionParts, coinsText, compareMenu, conditionParts, fmt, metricWord, optionsSummary, parseDec, templateTitle, titleOf, type Part, type Tok } from './sentence.ts'
import { app, dialog, getCatalog, h, isOffline, keepFocus, menu, rowSwitch, sheet, toast } from './ui.ts'

type Pos = Position & { epoch: string }
type State = {
  id?: string; version?: number
  draft: Draft; base: string
  issues: Issue[]; targets: Preview[]
  readOnly: boolean; applyOpen: boolean; done: boolean
  enabled: boolean; saving: boolean; saveError?: string
  positions: Pos[]; orders: Order[]
}

let el: HTMLElement
let cat: Catalog
let s: State
let generation = 0
let ready = false
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined
/** Marker messages already announced: a marker is read out once per new issue (spec §8). */
let shown = new Set<string>()

/** Key order does not count as a change. */
const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x))
const changed = () => stable(s.draft) !== s.base
const cap = (w: string) => w[0].toUpperCase() + w.slice(1)
const cond = (id?: string) => s.draft.conditions.items.find(c => c.id === id)

function toDraft(r: Draft): Draft {
  const d: Draft = structuredClone({ scope: r.scope, conditions: r.conditions, action: r.action, trigger: r.trigger, delivery: r.delivery })
  if (r.name) d.name = r.name
  if (r.voicePhrase) d.voicePhrase = r.voicePhrase
  return d
}

export async function enterEditor(section: HTMLElement, param: string) {
  el = section
  const loading = ++generation
  ready = false
  el.replaceChildren(h('div', { class: 'nav nav--editor' }, backBtn()))
  clearTimeout(timer)
  seq++
  shown = new Set()
  const fresh = (draft: Draft, more: Partial<State> = {}): State => ({
    draft, base: stable(draft), issues: [], targets: [], readOnly: false, applyOpen: false, done: false,
    enabled: false, saving: false, positions: [], orders: [], ...more,
  })
  try {
    const catalog = await getCatalog()
    if (loading !== generation) return
    cat = catalog
    if (param === 'new') {
      s = fresh(emptyDraft())
    } else if (param.startsWith('new?tpl=')) {
      const tpl = (await api.getTemplates()).find(x => x.id === param.slice(8))
      if (loading !== generation) return
      if (!tpl) { toast('This template is gone'); return location.replace('#/') }
      s = fresh(toDraft({ ...tpl.draft, name: templateTitle(tpl) }))
    } else {
      const tiles = await api.listShortcuts()
      if (loading !== generation) return
      app.tiles = tiles
      const t = app.tiles.find(x => x.id === param)
      if (!t) { toast('This shortcut was deleted'); return location.replace('#/') }
      s = fresh(toDraft(t), { id: t.id, version: t.version, enabled: t.enabled })
    }
  } catch (e) {
    if (loading !== generation) return
    // §7.6: offline, the last data read-only, back leaves without saving
    const t = app.tiles?.find(x => x.id === param)
    if (!isOffline(e) || !app.catalog || (!param.startsWith('new') && !t)) { toast(isOffline(e) ? 'Server offline' : (e as Error).message); return location.replace('#/') }
    cat = app.catalog
    s = fresh(t ? toDraft(t) : emptyDraft(), { id: t?.id, version: t?.version, readOnly: true })
    toast('Server offline')
  }
  ready = true
  render()
  if (s.readOnly) return
  validateSoon()
  void api.getPositions().then(p => { if (loading === generation) { s.positions = p; render() } }, () => {})
  void api.getOpenOrders().then(o => { if (loading === generation) { s.orders = o; render() } }, () => {})
}

/** Router hook before leaving the editor: false keeps it open (spec §7.1). */
export async function leaveEditor(): Promise<boolean> {
  if (ready && !s.done) {
    if (app.root.querySelector('.sheet:not(.is-closing), .menu:not(.is-closing), .dialog-scrim:not(.is-closing)')) return false
    const decision = leaveDecision(!s.readOnly && changed(), s.saving)
    if (decision === 'stay') return false
    if (decision === 'ask' && await dialog({
      title: 'Discard changes?',
      text: 'Your edits haven’t been saved.',
      buttons: [{ label: 'Keep editing', primary: true }, { label: 'Discard changes', danger: true }],
    }) !== 1) return false
  }
  ready = false
  generation++
  seq++
  clearTimeout(timer)
  return true
}

function goToShortcuts() {
  if (app.from === '#/') history.back()
  else location.replace('#/')
}

async function save() {
  if (s.saving || s.done || s.readOnly || (s.id && !changed())) return
  clearTimeout(timer)
  seq++
  s.saving = true
  s.saveError = undefined
  render()
  try {
    const v = await api.validate(payload())
    s.issues = v.issues
    if (!v.ok) {
      s.saveError = v.issues[0]?.message ?? 'Check the shortcut before saving.'
      return
    }
    const d = s.draft as EditableShortcut
    const r = s.id ? await api.updateShortcut(s.id, d, s.version!) : await api.createShortcut({ ...d, enabled: false })
    s.done = true
    toast(r.enabled ? 'Saved' : 'Saved. Off until you turn it on in Shortcuts')
    goToShortcuts()
  } catch (e) {
    if ((e as ApiError).status === 409 && s.id) {
      toast('Changed on another device. Reloaded.')
      await enterEditor(el, s.id)
    } else s.saveError = isOffline(e) ? 'Server offline. Try again when it’s connected.' : (e as Error).message
  } finally {
    s.saving = false
    if (ready && !s.done) render()
  }
}

const payload = () => ({ ...(s.draft as EditableShortcut), ...(s.id && { id: s.id }) })

function validateSoon() {
  clearTimeout(timer)
  const n = ++seq
  timer = setTimeout(async () => {
    try {
      const v = await api.validate(payload())
      if (n !== seq) return
      s.issues = v.issues
      if (v.targets) s.targets = v.targets
      render()
    } catch (e) {
      if (n === seq) toast(isOffline(e) ? 'Server offline' : (e as Error).message)
    }
  }, 250)
}

/** One draft update, then validate (spec §7.2). */
function commit(mut: (d: Draft) => void) {
  if (s.readOnly || s.saving) return
  const d = structuredClone(s.draft)
  mut(d)
  fitTrigger(d)
  s.draft = d
  s.saveError = undefined
  render()
  validateSoon()
}

const replaceCond = (c: Condition) => commit(d => { d.conditions.items = d.conditions.items.map(x => (x.id === c.id ? c : x)) })

/** Markers only for problems the sentence does not show already (placeholders say what is missing). */
const SILENT = new Set(['missing_value'])
/** An empty When, Do or Apply to is the starting point, not an error: marked once the user has changed something. */
const LATE = new Set(['bad_action', 'no_conditions', 'bad_scope'])

function marks() {
  const m = { cond: new Map<string, Issue[]>(), action: [] as Issue[], scope: [] as Issue[], when: [] as Issue[], options: [] as Issue[] }
  const late = changed() || !!s.saveError
  for (const i of s.issues) {
    if (SILENT.has(i.code) || (LATE.has(i.code) && !late)) continue
    if (i.conditionId) m.cond.set(i.conditionId, [...(m.cond.get(i.conditionId) ?? []), i])
    else if (i.field?.startsWith('action')) m.action.push(i)
    else if (i.field?.startsWith('scope')) m.scope.push(i)
    else if (i.field?.startsWith('conditions')) m.when.push(i)
    else m.options.push(i)
  }
  return m
}

let announce = new Set<string>()
function marker(issues: Issue[]) {
  if (!issues.length) return null
  const msg = issues.map(i => i.message).join('. ')
  announce.add(msg)
  // the reason is visible text: aria-label on a <p> is not read by every screen reader, and sighted users need it too
  return h('p', { class: shown.has(msg) ? 'marker' : 'marker is-new', role: shown.has(msg) ? undefined : 'alert' }, h('span', { html: WARN }), h('span', {}, msg))
}

function render() {
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.fk
  announce = new Set()
  const m = marks()
  const fields = h('div', { class: 'editor-fields', inert: s.saving }, applyTo(m.scope), whenCard(m), doCard(m.action), optionsRow(m.options))
  const bar = el.querySelector<HTMLElement>('.editor-actions') ?? h('footer', { class: 'editor-actions' },
    h('p', { class: 'editor-actions__note', role: 'status' }),
    h('button', { class: 'pill-btn pill-btn--accent', type: 'button', 'data-fk': 'save', onclick: () => void save() }))
  el.replaceChildren(nav(), fields, ...(!s.readOnly ? [bar] : []))
  if (!s.readOnly) {
    const note = bar.querySelector('p')!
    const button = bar.querySelector('button')!
    const text = s.saving ? 'Saving…' : s.saveError ?? (!s.id ? '' : s.enabled ? 'Changes to this active shortcut take effect when saved.' : 'This shortcut is off.')
    if (note.textContent !== text) note.textContent = text
    button.textContent = s.id ? 'Save changes' : 'Add shortcut'
    button.setAttribute('aria-disabled', String(s.saving || !!s.id && !changed()))
  }
  shown = announce
  if (focused) focusFk(focused)
}

/** Focus a control by its data-fk after a re-render, unless a sheet or dialog holds focus. */
function focusFk(fk: string) {
  if (app.root.querySelector('.sheet:not(.is-closing), .dialog-scrim:not(.is-closing), .menu:not(.is-closing)')) return
  el.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true })
}
const back = (fk: string) => () => focusFk(fk)

function backBtn() {
  return h('button', {
    class: 'circle-btn', type: 'button', 'aria-label': 'Back to Shortcuts', 'data-fk': 'back', html: icon('back', 20, 2.4),
    'aria-disabled': ready && s.saving ? 'true' : undefined,
    onclick: () => { if (!ready || !s.saving) goToShortcuts() },
  })
}

function nav() {
  const d = s.draft
  const a = d.action && ACTION_ICON[d.action.type]
  const chip = a
    ? h('span', { class: 'chip chip--lg', style: `--c: ${a.color}`, html: icon(a.icon, 15, 2.4) })
    : h('span', { class: 'chip chip--new chip--lg', html: icon('plus', 14, 3) })
  const title = h('span', { class: 'title-pill__text' }, titleOf(d))
  const pill = s.id && !s.readOnly && !s.saving
    ? h('button', { class: 'title-pill', type: 'button', 'aria-label': `${titleOf(d)}, rename or show details`, 'data-fk': 'title', onclick: (e: Event) => titleMenu(e.currentTarget as HTMLElement) },
      chip, title, h('span', { class: 'title-pill__chev', html: icon('down', 10, 3.6) }))
    : h('h1', { class: 'title-pill' }, chip, title)
  return h('div', { class: 'nav nav--editor' }, backBtn(), pill)
}

function scopeValue(sc: Scope): { text: string; missing?: boolean } {
  switch (sc.type) {
    case 'ALL_POSITIONS': return { text: 'All positions' }
    case 'COIN_POSITIONS': return sc.symbols.length ? { text: coinsText(sc) } : { text: 'Choose coins', missing: true }
    case 'ALL_ORDERS': return { text: 'All orders' }
    case 'POSITION': {
      if (!sc.symbol) return { text: 'Choose position', missing: true }
      const p = s.positions.find(x => x.symbol === sc.symbol && x.positionIdx === sc.positionIdx)
      const side = p ? (p.side === 'Buy' ? 'Long' : 'Short') : sc.positionIdx === 1 ? 'Long' : sc.positionIdx === 2 ? 'Short' : ''
      return { text: [sc.symbol, side].filter(Boolean).join(' · ') }
    }
    case 'SYMBOL': return sc.symbol ? { text: sc.symbol } : { text: 'Choose symbol', missing: true }
    case 'ORDER': {
      if (!sc.orderId) return { text: 'Choose order', missing: true }
      const o = s.orders.find(x => x.orderId === sc.orderId)
      return { text: o ? orderLabel(o) : `${sc.symbol} · order` }
    }
  }
}

const orderLabel = (o: Order) => `${o.symbol} · ${o.side} ${o.orderType.toLowerCase()} ${fmt(String(o.price))}`

function applyTo(issues: Issue[]) {
  const d = s.draft
  const v = scopeValue(d.scope)
  const wrap = h('div', { class: 'card disclosure', 'data-open': s.applyOpen ? '' : undefined })
  const head = h('button', {
    class: 'disclosure__head', type: 'button', 'aria-expanded': String(s.applyOpen), 'aria-controls': 'apply-options', 'data-fk': 'apply',
    'aria-label': `Apply to, ${v.text}. ${s.applyOpen ? 'Hide' : 'Show'} options`, disabled: s.readOnly,
    onclick: () => {
      s.applyOpen = !s.applyOpen
      wrap.toggleAttribute('data-open', s.applyOpen)
      head.setAttribute('aria-expanded', String(s.applyOpen))
      head.setAttribute('aria-label', `Apply to, ${v.text}. ${s.applyOpen ? 'Hide' : 'Show'} options`)
    },
  },
  h('span', { class: 'chip', html: icon('scope', 14, 2.4) }),
  h('span', { class: 'disclosure__label' }, 'Apply to'),
  h('span', { class: `disclosure__value${v.missing ? ' is-error' : ''}` }, v.text),
  h('span', { class: 'disclosure__chev', html: icon('down', 14, 2.6) }))
  const row = (t: Scope['type'], label: string) => {
    const on = d.scope.type === t && !v.missing
    return h('button', { class: 'radio-row', type: 'button', role: 'radio', 'aria-checked': String(on), onclick: () => pickScope(t) },
      h('span', { class: 'radio-row__check', html: on ? icon('check', 20, 2.4) : '' }),
      h('span', { class: 'radio-row__label' }, label),
      t === 'ALL_POSITIONS' || t === 'ALL_ORDERS' ? h('span', { class: 'radio-row__detail' }, `${t === 'ALL_POSITIONS' ? s.positions.length : s.orders.length} now`) : h('span', { class: 'radio-row__detail', html: icon('right', 14, 2.6) }))
  }
  wrap.append(head, h('div', { class: 'disclosure__body' },
    h('div', { id: 'apply-options', class: 'disclosure__list', role: 'radiogroup', 'aria-label': 'Apply to' },
      ...scopeChoices(cat, d).map(x => row(x.type, x.label)))))
  return h('div', {}, wrap, marker(issues))
}

function pickScope(t: Scope['type']) {
  const set = (sc: Scope) => { s.applyOpen = false; commit(d => { d.scope = sc }) }
  if (t === 'ALL_POSITIONS') return set({ type: 'ALL_POSITIONS' })
  if (t === 'ALL_ORDERS') return set({ type: 'ALL_ORDERS' })
  if (t === 'POSITION') return picker('One position', s.positions.map(p => ({
    title: p.symbol, sub: `${p.side === 'Buy' ? 'Long' : 'Short'} · ${p.size} ${p.symbol.replace(/USDT$/, '')}`,
    detail: p.positionIM ? `ROI ${p.unrealisedPnl >= 0 ? '+' : '−'}${Math.abs((100 * p.unrealisedPnl) / p.positionIM).toFixed(1)}%` : '',
    pick: () => set({ type: 'POSITION', symbol: p.symbol, positionIdx: p.positionIdx as 0 | 1 | 2, epoch: p.epoch }),
  })), 'No open positions')
  if (t === 'COIN_POSITIONS') {
    const cur = s.draft.scope.type === 'COIN_POSITIONS' ? s.draft.scope : { symbols: [], side: 'ANY' as const }
    return symbolPicker(() => {}, { ...cur, done: (symbols, side) => set({ type: 'COIN_POSITIONS', symbols, side }) })
  }
  if (t === 'ORDER') return picker('One order', s.orders.map(o => ({
    title: orderLabel(o), sub: `${o.leavesQty} left of ${o.qty}`, detail: '', pick: () => set({ type: 'ORDER', symbol: o.symbol, orderId: o.orderId }),
  })), 'No open orders')
  symbolPicker(sym => set({ type: 'SYMBOL', symbol: sym }))
}

type PickRow = { title: string; sub: string; detail: string; pick: () => void }
function picker(title: string, rows: PickRow[], empty: string) {
  const sh = sheet({
    title, back: back('apply'), body: [rows.length
      ? h('div', { class: 'group', role: 'listbox', 'aria-label': title }, ...rows.map(r => h('button', {
        class: 'pick-row', type: 'button', role: 'option', onclick: () => { sh.close(); r.pick() },
      }, h('span', { class: 'pick-row__text' }, h('span', { class: 'pick-row__title' }, r.title), h('span', { class: 'pick-row__sub' }, r.sub)),
      r.detail ? h('span', { class: 'pick-row__detail' }, r.detail) : null)))
      : h('p', { class: 'footnote' }, empty)],
  })
}

/** Every symbol the exchange trades, from the last time the picker loaded it; null until then or while it fails. */
let symbols: string[] | null = null

type CoinSide = 'ANY' | 'LONG' | 'SHORT'
/**
 * Your positions' and orders' symbols first, then every symbol the exchange trades; the search filters both.
 * `multi`: Positions by coin, several coins and a side, kept with Done.
 */
function symbolPicker(pick: (symbol: string) => void, multi?: { symbols: string[]; side: CoinSide; done: (symbols: string[], side: CoinSide) => void }) {
  let chosen = [...(multi?.symbols ?? [])]
  let side: CoinSide = multi?.side ?? 'ANY'
  const max = cat.limits.maxCoins
  const recent = [...new Set([...s.positions.map(p => p.symbol), ...s.orders.map(o => o.symbol)])]
  const lists = h('div')
  const input = h('input', { class: 'search', type: 'search', placeholder: 'Search symbol', 'aria-label': 'Search symbol', autocapitalize: 'characters', autocomplete: 'off' })
  const toggle = (n: string) => {
    chosen = chosen.includes(n) ? chosen.filter(x => x !== n) : chosen.length < max ? [...chosen, n] : chosen
    paint()
  }
  const group = (label: string, names: string[]) => names.length ? [
    ...(label ? [h('h3', { class: 'group-label' }, label)] : []),
    h('div', { class: 'group', role: 'listbox', 'aria-label': label || 'Symbols', 'aria-multiselectable': multi ? 'true' : undefined }, ...names.map(n => h('button', {
      class: 'pick-row pick-row--one', type: 'button', role: 'option', 'aria-selected': multi ? String(chosen.includes(n)) : undefined,
      onclick: () => { if (multi) return toggle(n); sh?.close(); pick(n) },
    }, h('span', { class: 'pick-row__title' }, n), multi && chosen.includes(n) ? h('span', { class: 'radio-row__check', html: icon('check', 20, 2.4) }) : null))),
  ] : []
  const sides = multi && h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Side' })
  const paintSides = () => sides && keepFocus(sides, () => sides.replaceChildren(...(['ANY', 'LONG', 'SHORT'] as const).map(x => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(side === x), onclick: () => { side = x; paintSides() },
  }, x === 'ANY' ? 'Long and short' : x === 'LONG' ? 'Long' : 'Short'))))
  const paint = () => {
    const q = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const typed = q.length >= 2 ? (q.endsWith('USDT') ? q : `${q}USDT`) : ''
    const rank = (n: string) => (n === typed ? 0 : n.startsWith(q) ? 1 : 2) // "ETH" puts ETHUSDT before ETHFIUSDT
    const picked = multi ? chosen.filter(n => n.includes(q)) : []
    const mine = recent.filter(n => n.includes(q) && !picked.includes(n))
    // Until the list arrives (or when it fails) the typed symbol is offered as is; once it is here, only what it holds.
    const all = symbols ? symbols.filter(n => n.includes(q)) : typed && /^[A-Z0-9]{2,20}$/.test(typed) ? [typed] : []
    const rest = all.filter(n => !recent.includes(n) && !picked.includes(n)).sort((a, b) => rank(a) - rank(b))
    keepFocus(lists, () => lists.replaceChildren(...group('Chosen', picked), ...group('Positions and orders', mine), ...group(symbols ? 'All symbols' : '', rest),
      symbols && q && !picked.length && !mine.length && !rest.length ? h('p', { class: 'footnote' }, 'No results') : '',
      multi && chosen.length >= max ? h('p', { class: 'footnote' }, `Up to ${max} coins`) : ''))
    sh?.setDone(chosen.length > 0)
  }
  input.addEventListener('input', paint)
  let sh: ReturnType<typeof sheet> | undefined
  sh = sheet({
    title: multi ? 'Positions by coin' : 'One symbol', back: back('apply'), focus: input,
    body: [...(sides ? [sides, h('p', { class: 'footnote' }, 'Positions of these coins now and later, on this side')] : []),
      h('label', { class: 'search-wrap', html: icon('search', 18, 2.2) }, input), lists],
    ...(multi && { dirty: () => chosen.join() !== multi.symbols.join() || side !== multi.side, onDone: () => { if (!chosen.length) return false; multi.done(chosen, side) } }),
  })
  paintSides()
  paint()
  void api.getSymbols().then(list => { symbols = list; if (lists.isConnected) paint() }, () => {})
}

/** Tokens and words of one line; error lines get red tokens and words, the operator token stays normal (§5.9). */
function sentence(parts: Part[], condId: string | undefined, err: boolean): Node[] {
  const out: Node[] = []
  for (const p of parts) {
    if (out.length) out.push(document.createTextNode(' '))
    out.push(typeof p === 'string' ? h('span', { class: err ? 'word is-error' : 'word' }, p) : token(p, condId, err))
  }
  return out
}

function token(t: Tok, condId: string | undefined, err: boolean) {
  const fk = `${condId ?? 'a'}:${t.key}`
  return h('button', {
    class: `token${err && t.key !== 'logic' ? ' token--error' : ''}${t.empty ? ' token--placeholder' : ''}`, type: 'button',
    'aria-label': t.aria, 'data-fk': fk, disabled: s.readOnly, onclick: (e: Event) => onToken(t, condId, e.currentTarget as HTMLElement, fk),
  }, t.text)
}

function whenCard(m: ReturnType<typeof marks>) {
  const d = s.draft
  const items = d.conditions.items
  const lines: Node[] = items.map((c, i) => {
    const issues = m.cond.get(c.id) ?? []
    const lead: Node[] = i === 0
      ? [h('span', { class: 'chip', html: icon('when', 14, 2.6) }), h('span', { class: issues.length ? 'word is-error' : 'word' }, 'When'), document.createTextNode(' ')]
      : [token({ key: 'logic', text: d.conditions.logic === 'ALL' ? 'and' : 'or', aria: `Group operator, ${d.conditions.logic === 'ALL' ? 'and' : 'or'}, edit` }, c.id, false), document.createTextNode(' ')]
    return h('div', { class: 'row-line' },
      h('div', { class: 'row-line__main' }, h('p', {}, ...lead, ...sentence(conditionParts(c), c.id, issues.length > 0)), marker(issues)),
      items.length >= 2 && !s.readOnly ? h('button', {
        class: 'remove', type: 'button', 'aria-label': `Remove condition: ${metricWord(c)}`,
        'data-fk': `rm:${c.id}`, html: REMOVE,
        onclick: () => commit(x => { x.conditions.items = x.conditions.items.filter(y => y.id !== c.id) }),
      }) : null)
  })
  if (!items.length) {
    lines.push(h('p', {}, h('span', { class: 'chip', html: icon('when', 14, 2.6) }), 'When',
      d.voicePhrase ? h('span', {}, ' you say ', h('em', { class: 'phrase' }, d.voicePhrase)) : null))
  }
  return h('div', { class: 'card card--when sentence', 'data-shortcut-part': 'condition' }, ...lines,
    items.length < cat.limits.maxConditions && !s.readOnly
      ? h('button', { class: 'add-btn', type: 'button', 'data-fk': 'add-cond', html: icon('plus-circle', 20, 2), onclick: () => conditionSheet() }, 'Add condition')
      : null,
    marker(m.when))
}

function doCard(issues: Issue[]) {
  const a = s.draft.action
  if (!a) {
    return h('div', { class: 'card card--when sentence', 'data-shortcut-part': 'action' },
      h('p', {}, h('span', { class: 'chip', html: icon('do-empty', 14, 2.6) }), 'Do'),
      s.readOnly ? null : h('button', { class: 'add-btn', type: 'button', 'data-fk': 'add-action', html: icon('plus-circle', 20, 2), onclick: () => actionSheet('add-action') }, 'Add action'),
      marker(issues))
  }
  const ic = ACTION_ICON[a.type]
  return h('div', { class: 'card sentence', 'data-shortcut-part': 'action' }, h('div', { class: 'row-line' },
    h('div', { class: 'row-line__main' },
      h('p', {}, h('span', { class: 'chip', style: `--c: ${ic.color}`, html: icon(ic.icon, 14, 2.4) }),
        h('span', { class: issues.length ? 'word is-error' : 'word' }, 'Do'), ' ', ...sentence(actionParts(a), undefined, issues.length > 0)),
      marker(issues)),
    s.readOnly ? null : h('button', { class: 'remove', type: 'button', 'aria-label': 'Remove action', 'data-fk': 'rm:action', html: REMOVE, onclick: () => commit(d => { delete d.action }) })), confirmLine())
}

function optionsRow(issues: Issue[]) {
  return h('div', {},
    h('button', { class: 'card options-row', type: 'button', 'data-fk': 'options', 'aria-label': `Options, ${optionsSummary(s.draft)}`, disabled: s.readOnly, onclick: optionsSheet },
      h('span', { class: 'options-row__label' }, 'Options'),
      h('span', { class: 'options-row__value' }, optionsSummary(s.draft)),
      h('span', { class: 'options-row__chev', html: icon('right', 14, 2.6) })),
    marker(issues))
}

function confirmLine() {
  const a = s.draft.action
  if (!a) return null
  const phoneOnly = a.type === 'NOTIFY' && !s.draft.delivery.glasses
  return h('p', { class: 'confirm-line', html: icon(phoneOnly ? 'bell' : 'glasses', 16, 2) }, phoneOnly ? 'Sends to phone' : a.type === 'NOTIFY' ? 'OK on Even G2' : 'Confirm on Even G2')
}

/** The first value a fresh condition or action still needs: its sheet opens at once (§5.4). */
const firstEmpty = (parts: Part[]) => (parts.find(p => typeof p !== 'string' && p.empty) as Tok | undefined)?.key

function onToken(t: Tok, condId: string | undefined, anchor: HTMLElement, fk: string) {
  const c = cond(condId)
  switch (t.key) {
    case 'metric': return conditionSheet(condId, fk)
    case 'action': return actionSheet(fk)
    case 'close': return closeSheet(fk)
    case 'target': return targetSheet(fk)
    case 'logic': {
      const cur = s.draft.conditions.logic
      return menu(anchor, (['ANY', 'ALL'] as const).map(l => ({
        label: l === 'ANY' ? 'or' : 'and', checked: cur === l, onPick: () => commit(d => { d.conditions.logic = l }),
      })), 'Group operator', back(fk))
    }
    case 'sizes':
    case 'leverages': return listSheet(t.key, fk)
    case 'unit': {
      const a = s.draft.action
      if (a?.type !== 'ADD_MARGIN') return
      return menu(anchor, (['MARGIN_PERCENT', 'USDT'] as const).map(unit => ({
        label: unit === 'USDT' ? 'USDT' : '% of its margin', checked: a.unit === unit,
        onPick: () => {
          if (unit === a.unit) return
          const before = s.draft
          commit(d => { d.action = { type: 'ADD_MARGIN', amount: '', unit } }) // another unit: the old number means nothing
          numericSheet('amount', undefined, fk, before)
        },
      })), 'Unit', back(fk))
    }
    case 'compare': {
      const cm = c && compareMenu(c)
      if (!c || !cm) return
      return menu(anchor, cm.items.map(w => ({
        label: cap(w), checked: w === cm.current,
        onPick: () => {
          const before = s.draft
          const next = setCompare(c, w)
          replaceCond(next)
          if (next !== c && firstEmpty(conditionParts(next))) numericSheet('threshold', c.id, fk, before) // ROI above ↔ below asks for a new value; Cancel puts the old one back
        },
      })), 'Comparison', back(fk))
    }
    default: return numericSheet(t.key, condId, fk)
  }
}

function conditionSheet(replacing?: string, fk = 'add-cond') {
  const old = cond(replacing)
  const choices = conditionChoices(cat, s.draft, replacing)
  const groups = [...new Set(choices.map(c => c.group))]
  const current = (c: (typeof choices)[number]) => old && old.type === c.type && (!('unit' in old) || old.unit === c.unit)
  const sh = sheet({
    title: replacing ? 'Condition' : 'Add condition', back: back(fk),
    body: groups.flatMap(g => [h('h3', { class: 'group-label' }, g), h('div', { class: 'group' }, ...choices.filter(c => c.group === g).map(c =>
      h('button', {
        class: 'radio-row', type: 'button', 'aria-current': current(c) ? 'true' : undefined,
        onclick: () => {
          sh.close()
          // ROI keeps its side: replacing a LOSS ROI with ROI stays LOSS
          const type: ConditionType = c.unit === 'ROI_PERCENT' && old?.type === 'LOSS' ? 'LOSS' : c.type
          const before = s.draft
          const next = old ? setMetric(old, type, c.unit) : newCondition(nextId(s.draft.conditions.items), type, c.unit)
          if (old) replaceCond(next)
          else commit(d => { if (d.conditions.items.length === 1) d.conditions.logic = 'ANY'; d.conditions.items.push(next) }) // a second line starts as or (P10)
          const key = firstEmpty(conditionParts(next))
          if (key && next !== old) numericSheet(key, next.id, `${next.id}:${key}`, before) // Cancel there takes the whole step back
        },
      }, h('span', { class: 'radio-row__label' }, c.label), current(c) ? h('span', { class: 'radio-row__check', html: icon('check', 20, 2.4) }) : null)))]),
  })
}

function actionSheet(fk: string) {
  const cur = s.draft.action?.type
  const row = (a: { type: Action['type']; title: string }) => {
    const ic = ACTION_ICON[a.type]
    return h('button', {
      class: 'choice-row', type: 'button', 'aria-current': cur === a.type ? 'true' : undefined,
      onclick: () => {
        sh.close()
        const before = s.draft
        const next = cur === a.type ? s.draft.action! : newAction(a.type)
        commit(d => { d.action = next })
        const key = firstEmpty(actionParts(next))
        if (key === 'sizes' || key === 'leverages') listSheet(key, `a:${key}`, next === before.action ? undefined : before)
        else if (key) numericSheet(key, undefined, `a:${key}`, next === before.action ? undefined : before)
      },
    },
    h('span', { class: 'chip chip--row', style: `--c: ${ic.color}`, html: icon(ic.icon, 16, 2.4) }),
    h('span', { class: 'choice-row__text' }, h('span', {}, a.title)),
    cur === a.type ? h('span', { class: 'radio-row__check', html: icon('check', 20, 2.4) }) : null)
  }
  const sh = sheet({
    title: 'Action', back: back(fk),
    body: [h('div', { class: 'group' }, ...actionChoices(cat, s.draft).map(row))],
  })
}

/** Open's sizes or leverages: the choices the glasses offer, smallest first. Tap a row to remove it. */
function listSheet(key: 'sizes' | 'leverages', fk: string, before?: Draft) {
  const a = s.draft.action
  const f = numField(cat, s.draft, key)
  if ((a?.type !== 'OPEN_LONG' && a?.type !== 'OPEN_SHORT') || !f) return
  let values = [...a[key]]
  const max = cat.limits.maxPicks
  const shown = (v: string) => `${fmt(v)}${f.unit === '×' ? '×' : ` ${f.unit}`}`
  const input = h('input', {
    class: 'numeric__input', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done',
    'aria-label': `Add ${f.word.toLowerCase()}, ${f.unit === '×' ? 'times' : f.unit}`,
  })
  const group = h('div', { class: 'group', 'aria-label': f.title })
  const note = h('p', { class: 'footnote', 'aria-live': 'polite' })
  /** The typed value goes in the list; false when it cannot. */
  const add = (): boolean => {
    const v = checkNum(input.value, f.range)
    if (v === null || values.length >= max) return false
    if (!values.some(x => Number(x) === Number(v))) values = [...values, v].sort((x, y) => Number(x) - Number(y))
    input.value = ''
    paint()
    return true
  }
  const paint = () => {
    keepFocus(group, () => group.replaceChildren(...values.map(v => h('button', {
      class: 'radio-row', type: 'button', 'aria-label': `Remove ${shown(v)}`, onclick: () => { values = values.filter(x => x !== v); paint() },
    }, h('span', { class: 'radio-row__label num' }, shown(v)), h('span', { class: 'radio-row__detail', html: REMOVE })))))
    const typed = input.value.trim() !== ''
    const bad = typed && checkNum(input.value, f.range) === null
    note.textContent = bad ? rangeText(f.range, f.unit) : values.length >= max ? `Up to ${max} choices` : values.length > 1 ? 'The glasses ask which one' : 'One value is used without asking'
    note.classList.toggle('is-error', bad)
    sh.setDone(!bad && (values.length > 0 || (typed && values.length < max)))
  }
  const sh = sheet({
    title: f.title, back: back(fk), focus: input, onCancel: before && (() => restore(before)),
    dirty: () => input.value.trim() !== '' || values.join() !== a[key].join(),
    body: [group, h('label', { class: 'numeric' }, h('span', { class: 'numeric__word' }, 'Add'),
      h('span', { class: 'numeric__value' }, input), h('span', { class: 'numeric__unit' }, f.unit)), note],
    onDone: () => {
      if (input.value.trim() && !add()) return false
      if (!values.length) return false
      commit(d => { (d.action as typeof a)[key] = values })
    },
  })
  input.addEventListener('input', paint)
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add() } })
  paint()
}

/** Footnote of the numeric sheet: the value now on the closest target (§5.5). */
function nowLine(c?: Condition): string {
  if (!c) return ''
  const vals = s.targets.flatMap(t => (typeof t.values[c.id] === 'number' ? [{ label: t.label, v: t.values[c.id] as number }] : []))
  if (!vals.length) return ''
  const raw = 'threshold' in c ? c.threshold : 'distancePct' in c ? c.distancePct : 'percent' in c ? c.percent
    : 'multiplier' in c ? c.multiplier : 'ratePct' in c ? c.ratePct : 'minutes' in c ? String(c.minutes) : ''
  const goal = raw === '' ? NaN : Number(raw) * (c.type === 'LOSS' ? -1 : 1)
  const best = Number.isNaN(goal) ? vals[0] : vals.reduce((a, b) => (Math.abs(b.v - goal) < Math.abs(a.v - goal) ? b : a))
  const n = (v: number, d: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: d })}`
  const v = c.type === 'PRICE' ? `${n(best.v, 2)} USDT` : (c.type === 'PROFIT' || c.type === 'LOSS') && c.unit === 'USDT' ? `${n(best.v, 2)} USDT`
    : c.type === 'VOLUME_SPIKE' ? `${n(best.v, 1)}×` : c.type === 'ORDER_STALE' ? `${Math.floor(best.v)} min` : c.type === 'FUNDING' ? `${n(best.v, 4)}%` : `${n(best.v, 1)}%`
  const distance = c.type === 'NEAR_LIQUIDATION' || c.type === 'NEAR_SL' || c.type === 'NEAR_TP'
  return distance ? `From mark price · now ${v} on ${best.label}` : `Now ${v} on ${best.label}`
}

/** A decimal string in range, or null. */
function checkNum(raw: string, r: Range, integer?: boolean): string | null {
  const v = parseDec(raw)
  return v !== null && inRange(Number(v), r) && (!integer || Number.isInteger(Number(v))) ? v : null
}

/** Puts the draft back as it was before a step whose sheet was cancelled. */
function restore(before: Draft) {
  s.draft = before
  render()
  validateSoon()
}

/** `before`: the draft ahead of the step that opened this sheet; Cancel restores it, so a cancelled Add leaves nothing behind. */
function numericSheet(key: string, condId: string | undefined, fk: string, before?: Draft) {
  const f = numField(cat, s.draft, key, condId)
  if (!f) return
  const input = h('input', {
    class: 'numeric__input', type: 'text', inputmode: f.integer ? 'numeric' : 'decimal', value: f.value, autocomplete: 'off', enterkeyhint: 'done',
    'aria-label': `${f.title}, ${f.unit === '%' ? 'percent' : f.unit === '×' ? 'times' : f.unit === 'min' ? 'minutes' : f.unit}`,
  })
  const note = h('p', { class: 'footnote', 'aria-live': 'polite' })
  const now = nowLine(cond(condId))
  const check = () => {
    input.size = Math.max(2, input.value.length + 1) // the sign stays next to the number
    const ok = checkNum(input.value, f.range, f.integer) !== null
    const typed = input.value.trim() !== ''
    note.textContent = !ok && typed ? rangeText(f.range, f.unit) : now
    note.classList.toggle('is-error', !ok && typed)
    sh.setDone(ok)
  }
  const sh = sheet({
    title: f.title, back: back(fk), focus: input,
    dirty: () => input.value !== f.value, onCancel: before && (() => restore(before)),
    body: [h('label', { class: 'numeric' },
      h('span', { class: 'numeric__word' }, f.word),
      h('span', { class: 'numeric__value' }, f.sign ? h('span', { class: 'numeric__unit' }, f.sign) : null, input),
      h('span', { class: 'numeric__unit' }, f.unit)), note],
    onDone: () => {
      const v = checkNum(input.value, f.range, f.integer)
      if (v === null) return false
      commit(d => setNumber(d, key, v, condId))
    },
  })
  input.addEventListener('input', check)
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sh.el.querySelector<HTMLButtonElement>('.link-btn--strong')?.click() } }) // no keypress then, which would press the token focus went back to
  check()
  input.select()
}

function closeSheet(fk: string) {
  const a = s.draft.action
  if (a?.type !== 'CLOSE_POSITION') return
  let pick = a.percent
  const presets = ['25', '50', '75', '100']
  const group = h('div', { class: 'group', role: 'radiogroup', 'aria-label': 'Close amount' })
  const paint = () => keepFocus(group, () => group.replaceChildren(
    ...presets.map(p => h('button', { class: 'radio-row', type: 'button', role: 'radio', 'aria-checked': String(pick === p), onclick: () => { pick = p; paint() } },
      h('span', { class: 'radio-row__label num' }, `${p}%`), pick === p ? h('span', { class: 'radio-row__check', html: icon('check', 20, 2.4) }) : null)),
    h('button', { class: 'radio-row', type: 'button', role: 'radio', 'aria-checked': String(!presets.includes(pick)), onclick: () => { sh.close(); numericSheet('close', undefined, fk) } },
      h('span', { class: 'radio-row__label' }, presets.includes(pick) ? 'Custom' : `Custom · ${pick}%`), h('span', { class: 'radio-row__detail', html: icon('right', 14, 2.6) }))))
  const sh = sheet({
    title: 'Close amount', back: back(fk), body: [group, h('p', { class: 'footnote' }, 'Market order, reduce-only')],
    onDone: () => commit(d => { (d.action as typeof a).percent = pick }),
  })
  paint()
}

function targetSheet(fk: string) {
  const a = s.draft.action
  if (a?.type !== 'MOVE_SL' && a?.type !== 'SET_SL' && a?.type !== 'SET_TP') return
  const tp = a.type === 'SET_TP'
  const t = a.target
  let kind: 'entry' | 'pct' | 'price' = t.kind === 'PRICE' ? 'price' : t.percent === '0' && !tp ? 'entry' : 'pct'
  let side: 'adverse' | 'favorable' = t.kind === 'ENTRY_OFFSET' && Number(t.percent) < 0 ? 'adverse' : 'favorable'
  const pct = h('input', { class: 'inline-input', type: 'text', inputmode: 'decimal', 'aria-label': 'Percent from entry', value: t.kind === 'ENTRY_OFFSET' && t.percent !== '0' ? t.percent.replace('-', '') : '' })
  const px = h('input', { class: 'inline-input', type: 'text', inputmode: 'decimal', 'aria-label': 'Price, USDT', value: t.kind === 'PRICE' ? t.price : '' })
  const sc = s.draft.scope
  const priceOk = sc.type !== 'ALL_POSITIONS' && sc.type !== 'ALL_ORDERS' && !(sc.type === 'COIN_POSITIONS' && sc.symbols.length > 1)
  const L = cat.limits
  const priceRange = { gt: 0, lt: 1e9 }
  const percentRange = tp ? { gt: L.tpPct.min, le: L.tpPct.max } : { gt: 0, lt: L.stopPct.max }
  const value = (): Target | null => {
    if (kind === 'entry') return { kind: 'ENTRY_OFFSET', percent: '0' }
    if (kind === 'price') { const v = checkNum(px.value, priceRange); return v ? { kind: 'PRICE', price: v } : null }
    const v = checkNum(pct.value, percentRange)
    return v ? { kind: 'ENTRY_OFFSET', percent: side === 'adverse' && !tp ? `-${v}` : v } : null
  }
  const note = h('p', { class: 'footnote is-error', 'aria-live': 'polite', hidden: true })
  const check = () => {
    const valid = value() !== null
    const typed = kind === 'pct' ? pct.value.trim() : kind === 'price' ? px.value.trim() : ''
    note.hidden = valid || !typed
    note.textContent = note.hidden ? '' : kind === 'pct' ? rangeText(percentRange, '%') : rangeText(priceRange, 'USDT')
    sh.setDone(valid)
  }
  const group = h('div', { class: 'group', role: 'radiogroup', 'aria-label': tp ? 'Take profit' : 'Stop loss' })
  const radio = (k: typeof kind, label: string, disabled?: string) => h('button', {
    class: 'radio-row', type: 'button', role: 'radio', 'aria-checked': String(kind === k), disabled: !!disabled,
    onclick: () => { kind = k; paint(); (k === 'pct' ? pct : k === 'price' ? px : null)?.focus() },
  }, h('span', { class: 'radio-row__check', html: kind === k ? icon('check', 20, 2.4) : '' }),
  h('span', { class: 'radio-row__text' }, h('span', {}, label), disabled ? h('span', { class: 'choice-row__sub' }, disabled) : null))
  const seg = () => h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Side of entry' },
    ...(['adverse', 'favorable'] as const).map(x => h('button', { type: 'button', role: 'radio', 'aria-checked': String(side === x), onclick: () => { side = x; paint() } }, cap(x))))
  const paint = () => {
    keepFocus(group, () => group.replaceChildren(
      ...(tp ? [] : [radio('entry', 'Entry price')]),
      radio('pct', '% from entry'),
      kind === 'pct' ? h('div', { class: 'sub-row' }, h('label', { class: 'inline-field' }, pct, h('span', {}, '%')), tp ? null : seg()) : '',
      radio('price', 'Price', priceOk ? undefined : 'Needs one symbol or position'),
      kind === 'price' ? h('div', { class: 'sub-row' }, h('label', { class: 'inline-field' }, px, h('span', {}, 'USDT'))) : ''))
    check()
  }
  const sh = sheet({
    title: tp ? 'Take profit' : 'Stop loss', back: back(fk),
    body: [group, note, h('p', { class: 'footnote' }, `${a.type === 'MOVE_SL' ? 'Moves only closer. ' : ''}The exact price shows on Even G2 before you confirm.`)],
    onDone: () => {
      const v = value()
      if (!v) return false
      commit(d => { (d.action as typeof a).target = v })
    },
  })
  for (const i of [pct, px]) i.addEventListener('input', check)
  paint()
}

const HINT: Record<TriggerMode, string> = { ON_ENTRY: 'each time it becomes true', ON_EVENT: 'only for crossings and fills', ONCE: 'the first time only', REPEAT: 'while it stays true' }

function optionsSheet() {
  const o = { trigger: structuredClone(s.draft.trigger), delivery: { ...s.draft.delivery } }
  const phrase = h('input', {
    class: 'text-field__input', type: 'text', value: s.draft.voicePhrase ?? '', placeholder: 'e.g. protect all', maxlength: cat.limits.maxPhrase,
    autocapitalize: 'none', autocomplete: 'off', 'aria-label': 'Voice phrase',
  })
  const fires = h('div', { class: 'group', role: 'radiogroup', 'aria-label': 'When it fires' })
  const paint = () => keepFocus(fires, () => fires.replaceChildren(...triggerChoices({ ...s.draft, trigger: o.trigger }).map(c => h('button', {
    class: 'radio-row', type: 'button', role: 'radio', 'aria-checked': String(o.trigger.mode === c.mode), disabled: !!c.why,
    onclick: () => { o.trigger = c.mode === 'REPEAT' ? { mode: 'REPEAT', intervalSec: cat.limits.repeatSec.default } : { mode: c.mode }; paint() },
  },
  h('span', { class: 'radio-row__check', html: o.trigger.mode === c.mode ? icon('check', 20, 2.4) : '' }),
  h('span', { class: 'radio-row__label' }, c.mode === 'REPEAT' ? `Repeat every ${cat.limits.repeatSec.default / 60} min` : { ON_ENTRY: 'On entry', ON_EVENT: 'On event', ONCE: 'Once' }[c.mode]),
  h('span', { class: 'radio-row__detail' }, c.why ?? HINT[c.mode])))))
  sheet({
    title: 'Options', back: back('options'),
    body: [
      h('h3', { class: 'group-label' }, 'When it fires'), fires,
      h('h3', { class: 'group-label' }, 'Delivery'),
      h('div', { class: 'group' },
        h('div', { class: 'row row--switch' }, h('span', { id: 'opt-glasses' }, 'Show on glasses'), rowSwitch(o.delivery.glasses, 'opt-glasses', (on, b) => { o.delivery.glasses = on; b.setAttribute('aria-checked', String(on)) })),
        h('div', { class: 'row row--switch' }, h('span', { id: 'opt-phone' }, 'Send to phone'), rowSwitch(o.delivery.phone, 'opt-phone', (on, b) => { o.delivery.phone = on; b.setAttribute('aria-checked', String(on)) }))),
    ],
    // Test alert and Delete live in the title menu: here they would close the sheet and drop its edits
    dirty: () => stable(o) !== stable({ trigger: s.draft.trigger, delivery: s.draft.delivery }) || normalizePhrase(phrase.value) !== (s.draft.voicePhrase ?? ''),
    onDone: () => commit(d => {
      d.trigger = o.trigger
      d.delivery = o.delivery
      const p = normalizePhrase(phrase.value)
      if (p) d.voicePhrase = p
      else delete d.voicePhrase
    }),
  })
  paint()
}

function titleMenu(anchor: HTMLElement) {
  menu(anchor, [
    { label: 'Rename', onPick: renameSheet },
    { label: 'Duplicate', disabled: changed(), onPick: () => void duplicate() },
    { label: 'Test alert', onPick: () => void testAlert() },
    { label: 'Delete', danger: true, onPick: () => void remove() },
  ], 'Shortcut', back('title'))
}

function renameSheet() {
  const input = h('input', { class: 'text-field__input', type: 'text', value: s.draft.name ?? '', placeholder: s.draft.action ? titleOf({ action: s.draft.action }) : '', maxlength: cat.limits.maxName, 'aria-label': 'Name' })
  sheet({
    title: 'Rename', back: back('title'), focus: input, dirty: () => input.value.trim() !== (s.draft.name ?? ''), body: [h('label', { class: 'text-field' }, input), h('p', { class: 'footnote' }, 'Leave it empty to use the action name.')],
    onDone: () => commit(d => { const v = input.value.trim(); if (v) d.name = v; else delete d.name }),
  })
}

/** A disabled copy without the voice phrase (phrases are unique), opened in the editor. */
async function duplicate() {
  if (!s.draft.action) return
  const copy = structuredClone(s.draft) as EditableShortcut
  delete copy.voicePhrase
  try {
    const sc = await api.createShortcut({ ...copy, enabled: false })
    location.hash = `#/shortcut/${encodeURIComponent(sc.id)}`
  } catch (e) { toast((e as Error).message) }
}

/** A simulated alert and proposal on the saved version: History says "Simulation · nothing sent to Bybit" (P25). */
async function testAlert() {
  if (!s.id) return
  try {
    const r = await api.testShortcut(s.id)
    toast(r.ok ? 'Test alert sent' : r.message)
  } catch (e) { toast((e as Error).message) }
}

async function remove() {
  if (!s.id) return
  const pick = await dialog({ title: 'Delete this shortcut?', text: 'It stops at once. History keeps its alerts.', buttons: [{ label: 'Delete', danger: true }, { label: 'Cancel', primary: true }] })
  if (pick !== 0) return focusFk('title') // the menu item it opened from is gone
  try {
    await api.deleteShortcut(s.id, s.version!)
    s.done = true
    location.replace('#/')
  } catch (e) {
    if ((e as ApiError).status === 409) { toast('Changed on another device. Reloaded.'); return void enterEditor(el, s.id) }
    toast((e as Error).message)
  }
}
