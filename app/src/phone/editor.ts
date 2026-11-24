/**
 * Shortcut editor (spec §5.2–§5.10, §7): Apply to, When, Do, Options on a local copy; validate on every change;
 * saved on the way out when valid (§7.1). It never trades and has no confirm button: proposals go to the lens.
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
import { actionParts, compareMenu, conditionParts, fmt, metricWord, optionsSummary, parseDec, titleOf, type Part, type Tok } from './sentence.ts'
import { app, dialog, getCatalog, h, isOffline, menu, rowSwitch, sheet, toast } from './ui.ts'

type Pos = Position & { epoch: string }
type State = {
  id?: string; version?: number
  draft: Draft; base: string
  issues: Issue[]; ok: boolean; targets: Preview[]
  readOnly: boolean; applyOpen: boolean; done: boolean
  positions: Pos[]; orders: Order[]
}

let el: HTMLElement
let cat: Catalog
let s: State
let pending: Draft | null = null
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

/** A template with values to choose: opens unsaved (spec §5.10). */
export function openDraft(d: Draft) {
  pending = d
  location.hash = '#/shortcut/new'
}

export async function enterEditor(section: HTMLElement, param: string) {
  el = section
  el.replaceChildren(h('div', { class: 'nav nav--editor' }, backBtn()))
  clearTimeout(timer)
  seq++
  shown = new Set()
  const fresh = (draft: Draft, more: Partial<State> = {}): State => ({
    draft, base: stable(draft), issues: [], ok: false, targets: [], readOnly: false, applyOpen: false, done: false,
    positions: [], orders: [], ...more,
  })
  try {
    cat = await getCatalog()
    if (param === 'new') {
      s = fresh(pending ?? emptyDraft())
      pending = null
    } else {
      app.tiles = await api.listShortcuts()
      const t = app.tiles.find(x => x.id === param)
      if (!t) { toast('This shortcut was deleted'); return location.replace('#/') }
      s = fresh(toDraft(t), { id: t.id, version: t.version })
    }
  } catch (e) {
    // §7.6: offline, the last data read-only, back leaves without saving
    const t = app.tiles?.find(x => x.id === param)
    if (!isOffline(e) || !app.catalog || (param !== 'new' && !t)) { toast(isOffline(e) ? 'Server offline' : (e as Error).message); return location.replace('#/') }
    cat = app.catalog
    s = fresh(t ? toDraft(t) : emptyDraft(), { id: t?.id, version: t?.version, readOnly: true })
    toast('Server offline')
  }
  render()
  if (s.readOnly) return
  validateSoon()
  void api.getPositions().then(p => { s.positions = p; render() }, () => {})
  void api.getOpenOrders().then(o => { s.orders = o; render() }, () => {})
}

/** Router hook before leaving the editor: false keeps it open (spec §7.1). */
export async function leaveEditor(): Promise<boolean> {
  if (!s || s.readOnly || s.done || !changed()) return true
  clearTimeout(timer)
  seq++
  let ok: boolean
  try {
    const v = await api.validate(payload())
    ok = v.ok
    s.issues = v.issues
  } catch (e) {
    toast(isOffline(e) ? 'Server offline' : (e as Error).message) // stay: nothing is lost
    return false
  }
  if (leaveDecision(true, ok) === 'save') {
    try {
      const d = s.draft as EditableShortcut
      if (s.id) await api.updateShortcut(s.id, d, s.version!)
      else await api.createShortcut({ ...d, enabled: false })
      return true
    } catch (e) {
      if ((e as ApiError).status === 409) {
        toast('Changed on another device. Reloaded.')
        await enterEditor(el, s.id!)
      } else toast((e as Error).message)
      return false
    }
  }
  render()
  const pick = await dialog({
    title: 'Discard changes?', text: 'This shortcut has a problem that stops it from saving.',
    buttons: [{ label: 'Keep editing', primary: true }, { label: 'Discard', danger: true }],
  })
  return pick === 1
}

const payload = () => ({ ...(s.draft as EditableShortcut), ...(s.id && { id: s.id }) })

function validateSoon() {
  clearTimeout(timer)
  const n = ++seq
  // shortcut: a stale answer is dropped by its sequence number instead of aborting the request, pass a signal through api.ts if requests pile up
  timer = setTimeout(async () => {
    try {
      const v = await api.validate(payload())
      if (n !== seq) return
      s.issues = v.issues
      s.ok = v.ok
      if (v.targets) s.targets = v.targets
      render()
    } catch (e) {
      if (n === seq) toast(isOffline(e) ? 'Server offline' : (e as Error).message)
    }
  }, 250)
}

/** One draft update, then validate (spec §7.2). */
function commit(mut: (d: Draft) => void) {
  if (s.readOnly) return
  const d = structuredClone(s.draft)
  mut(d)
  fitTrigger(d)
  s.draft = d
  render()
  validateSoon()
}

const replaceCond = (c: Condition) => commit(d => { d.conditions.items = d.conditions.items.map(x => (x.id === c.id ? c : x)) })

// ── Rendering ────────────────────────────────────────────

/** Markers only for problems the sentence does not show already (placeholders say what is missing). */
const SILENT = new Set(['missing_value', 'bad_action', 'no_conditions', 'bad_scope'])

function marks() {
  const m = { cond: new Map<string, Issue[]>(), action: [] as Issue[], scope: [] as Issue[], when: [] as Issue[], options: [] as Issue[] }
  for (const i of s.issues) {
    if (SILENT.has(i.code)) continue
    if (i.conditionId) m.cond.set(i.conditionId, [...(m.cond.get(i.conditionId) ?? []), i])
    else if (i.field?.startsWith('action')) m.action.push(i)
    else if (i.field?.startsWith('scope')) m.scope.push(i)
    else if (i.field?.startsWith('conditions')) m.when.push(i)
    else m.options.push(i)
  }
  return m
}

let announce = new Set<string>()
function marker(issues: Issue[], text = 'Incompatible') {
  if (!issues.length) return null
  const msg = issues.map(i => i.message).join('. ')
  announce.add(msg)
  return h('p', { class: 'marker', role: shown.has(msg) ? undefined : 'alert', 'aria-label': msg }, h('span', { html: WARN }), text)
}

function render() {
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.fk
  announce = new Set()
  const m = marks()
  el.replaceChildren(...[nav(), applyTo(m.scope), whenCard(m), doCard(m.action), optionsRow(m.options), confirmLine()].filter(x => x !== null))
  shown = announce
  if (focused) focusFk(focused)
}

/** Focus a control by its data-fk after a re-render, unless a sheet or dialog holds focus. */
function focusFk(fk: string) {
  if (app.root.querySelector('.sheet:not(.is-closing), .dialog-scrim, .menu')) return
  el.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true })
}
const back = (fk: string) => () => focusFk(fk)

function backBtn() {
  return h('button', {
    class: 'circle-btn', type: 'button', 'aria-label': 'Back to Shortcuts', 'data-fk': 'back', html: icon('back', 20, 2.4),
    onclick: () => (app.from === '#/' ? history.back() : location.replace('#/')),
  })
}

function nav() {
  const d = s.draft
  const a = d.action && ACTION_ICON[d.action.type]
  const chip = a
    ? h('span', { class: 'chip chip--action chip--lg', style: `color: ${a.color}`, html: icon(a.icon, 15, 2.4) })
    : h('span', { class: 'chip chip--new chip--lg', html: icon('plus', 14, 3) })
  const title = h('span', { class: 'title-pill__text' }, titleOf(d))
  const pill = s.id && !s.readOnly
    ? h('button', { class: 'title-pill', type: 'button', 'aria-label': `${titleOf(d)}, rename or show details`, 'data-fk': 'title', onclick: (e: Event) => titleMenu(e.currentTarget as HTMLElement) },
      chip, title, h('span', { class: 'title-pill__chev', html: icon('down', 10, 3.6) }))
    : h('span', { class: 'title-pill' }, chip, title)
  return h('div', { class: 'nav nav--editor' }, backBtn(), pill, h('span'))
}

function scopeValue(sc: Scope): { text: string; missing?: boolean } {
  switch (sc.type) {
    case 'ALL_POSITIONS': return { text: 'All positions' }
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
  h('span', { class: 'chip chip--when', html: icon('scope', 14, 2.4) }),
  h('span', { class: 'disclosure__label' }, 'Apply to'),
  h('span', { class: `disclosure__value${v.missing ? ' is-error' : ''}` }, v.text),
  h('span', { class: 'disclosure__chev', html: icon('down', 14, 2.6) }))
  const row = (t: Scope['type'], label: string) => {
    const on = d.scope.type === t && !v.missing
    return h('button', { class: 'radio-row', type: 'button', role: 'radio', 'aria-checked': String(on), onclick: () => pickScope(t) },
      h('span', { class: 'radio-row__check', html: on ? icon('check', 20, 2.4) : '' }),
      h('span', { class: 'radio-row__label' }, label),
      t === 'ALL_POSITIONS' ? h('span', { class: 'radio-row__detail' }, `${s.positions.length} now`) : h('span', { class: 'radio-row__detail', html: icon('right', 14, 2.6) }))
  }
  wrap.append(head, h('div', { class: 'disclosure__body' },
    h('div', { id: 'apply-options', class: 'disclosure__list', role: 'radiogroup', 'aria-label': 'Apply to' },
      ...scopeChoices(cat, d).map(x => row(x.type, x.label)))))
  return h('div', {}, wrap, marker(issues))
}

function pickScope(t: Scope['type']) {
  const set = (sc: Scope) => { s.applyOpen = false; commit(d => { d.scope = sc }) }
  if (t === 'ALL_POSITIONS') return set({ type: 'ALL_POSITIONS' })
  if (t === 'POSITION') return picker('One position', s.positions.map(p => ({
    title: p.symbol, sub: `${p.side === 'Buy' ? 'Long' : 'Short'} · ${p.size} ${p.symbol.replace(/USDT$/, '')}`,
    detail: p.positionIM ? `ROI ${p.unrealisedPnl >= 0 ? '+' : '−'}${Math.abs((100 * p.unrealisedPnl) / p.positionIM).toFixed(1)}%` : '',
    pick: () => set({ type: 'POSITION', symbol: p.symbol, positionIdx: p.positionIdx as 0 | 1 | 2, epoch: p.epoch }),
  })), 'No open positions')
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

/** Recent symbols from positions and orders, plus whatever is typed. */
function symbolPicker(pick: (symbol: string) => void) {
  // shortcut: no instrument list endpoint, so the list is your positions' and orders' symbols plus the typed one; list USDT perpetuals once the server sends them
  const recent = [...new Set([...s.positions.map(p => p.symbol), ...s.orders.map(o => o.symbol)])]
  const list = h('div', { class: 'group', role: 'listbox', 'aria-label': 'Symbols' })
  const input = h('input', { class: 'search', type: 'search', placeholder: 'Search symbol', 'aria-label': 'Search symbol', autocapitalize: 'characters', autocomplete: 'off' })
  const paint = () => {
    const q = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const typed = q.length >= 2 ? (q.endsWith('USDT') ? q : `${q}USDT`) : ''
    const names = [...new Set([...recent.filter(x => x.includes(q)), ...(typed && /^[A-Z0-9]{2,20}$/.test(typed) ? [typed] : [])])]
    list.replaceChildren(...names.map(n => h('button', { class: 'pick-row', type: 'button', role: 'option', onclick: () => { sh.close(); pick(n) } },
      h('span', { class: 'pick-row__title' }, n))))
    list.hidden = !names.length
  }
  input.addEventListener('input', paint)
  const sh = sheet({ title: 'One symbol', back: back('apply'), focus: input, body: [h('label', { class: 'search-wrap', html: icon('search', 18, 2.2) }, input), list] })
  paint()
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
      ? [h('span', { class: 'chip chip--when', html: icon('when', 14, 2.6) }), h('span', { class: issues.length ? 'word is-error' : 'word' }, 'When'), document.createTextNode(' ')]
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
    lines.push(h('p', {}, h('span', { class: 'chip chip--when', html: icon('when', 14, 2.6) }), 'When',
      d.voicePhrase ? h('span', {}, ' you say ', h('em', { class: 'phrase' }, d.voicePhrase)) : null))
  }
  return h('div', { class: 'card card--when sentence' }, ...lines,
    items.length < cat.limits.maxConditions && !s.readOnly
      ? h('button', { class: 'add-btn', type: 'button', 'data-fk': 'add-cond', html: icon('plus-circle', 20, 2), onclick: () => conditionSheet() }, 'Add condition')
      : null,
    marker(m.when))
}

function doCard(issues: Issue[]) {
  const a = s.draft.action
  if (!a) {
    return h('div', { class: 'card card--when sentence' },
      h('p', {}, h('span', { class: 'chip chip--action', style: 'color: var(--tile-text-2)', html: icon('do-empty', 14, 2.6) }), 'Do'),
      s.readOnly ? null : h('button', { class: 'add-btn', type: 'button', 'data-fk': 'add-action', html: icon('plus-circle', 20, 2), onclick: () => actionSheet('add-action') }, 'Add action'))
  }
  const ic = ACTION_ICON[a.type]
  return h('div', { class: 'card sentence' }, h('div', { class: 'row-line' },
    h('div', { class: 'row-line__main' },
      h('p', {}, h('span', { class: 'chip chip--action', style: `color: ${ic.color}`, html: icon(ic.icon, 14, 2.4) }),
        h('span', { class: issues.length ? 'word is-error' : 'word' }, 'Do'), ' ', ...sentence(actionParts(a), undefined, issues.length > 0)),
      marker(issues)),
    s.readOnly ? null : h('button', { class: 'remove', type: 'button', 'aria-label': 'Remove action', 'data-fk': 'rm:action', html: REMOVE, onclick: () => commit(d => { delete d.action }) })))
}

function optionsRow(issues: Issue[]) {
  return h('div', {},
    h('button', { class: 'card options-row', type: 'button', 'data-fk': 'options', 'aria-label': `Options, ${optionsSummary(s.draft)}`, disabled: s.readOnly, onclick: optionsSheet },
      h('span', { class: 'options-row__label' }, 'Options'),
      h('span', { class: 'options-row__value' }, optionsSummary(s.draft)),
      h('span', { class: 'options-row__chev', html: icon('right', 14, 2.6) })),
    issues.length ? marker(issues, issues.map(i => i.message).join('. ')) : null)
}

function confirmLine() {
  const a = s.draft.action
  return a ? h('p', { class: 'confirm-line', html: icon('glasses', 16, 2) }, a.type === 'NOTIFY' ? 'Shows on Even G2' : 'Confirm on Even G2') : null
}

// ── Token editors ────────────────────────────────────────

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
    case 'side': {
      const a = s.draft.action
      if (a?.type !== 'OPEN_POSITION') return
      return menu(anchor, (['LONG', 'SHORT'] as const).map(side => ({
        label: side === 'LONG' ? 'Long' : 'Short', checked: a.side === side, onPick: () => commit(d => { (d.action as typeof a).side = side }),
      })), 'Side', back(fk))
    }
    case 'compare': {
      const cm = c && compareMenu(c)
      if (!c || !cm) return
      return menu(anchor, cm.items.map(w => ({
        label: cap(w), checked: w === cm.current,
        onPick: () => {
          const next = setCompare(c, w)
          replaceCond(next)
          if (next !== c && firstEmpty(conditionParts(next))) numericSheet('threshold', c.id, fk) // ROI above ↔ below asks for a new value
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
          const next = old ? setMetric(old, type, c.unit) : newCondition(nextId(s.draft.conditions.items), type, c.unit)
          if (old) replaceCond(next)
          else commit(d => { if (d.conditions.items.length === 1) d.conditions.logic = 'ANY'; d.conditions.items.push(next) }) // a second line starts as or (P10)
          const key = firstEmpty(conditionParts(next))
          if (key && next !== old) numericSheet(key, next.id, `${next.id}:${key}`)
        },
      }, h('span', { class: 'radio-row__label' }, c.label), current(c) ? h('span', { class: 'radio-row__check', html: icon('check', 20, 2.4) }) : null)))]),
  })
}

function actionSheet(fk: string) {
  const { ok, needs } = actionChoices(cat, s.draft)
  const cur = s.draft.action?.type
  const row = (a: { type: Action['type']; title: string; reason?: string }) => {
    const ic = ACTION_ICON[a.type]
    return h('button', {
      class: 'choice-row', type: 'button', 'aria-current': cur === a.type ? 'true' : undefined,
      onclick: () => {
        sh.close()
        const next = cur === a.type ? s.draft.action! : newAction(a.type)
        commit(d => { d.action = next })
        const key = firstEmpty(actionParts(next))
        if (key) numericSheet(key, undefined, `a:${key}`)
      },
    },
    h('span', { class: 'chip chip--action chip--row', style: `color: ${ic.color}`, html: icon(ic.icon, 16, 2.4) }),
    h('span', { class: 'choice-row__text' }, h('span', {}, a.title), a.reason ? h('span', { class: 'choice-row__sub' }, a.reason) : null),
    cur === a.type ? h('span', { class: 'radio-row__check', html: icon('check', 20, 2.4) }) : null)
  }
  const sh = sheet({
    title: 'Action', back: back(fk),
    body: [h('div', { class: 'group' }, ...ok.map(row)), needs.length ? h('h3', { class: 'group-label' }, 'Needs changes') : '', needs.length ? h('div', { class: 'group' }, ...needs.map(row)) : ''],
  })
}

/** Footnote of the numeric sheet: the value now on the closest target (§5.5). */
function nowLine(c?: Condition): string {
  if (!c) return ''
  const vals = s.targets.flatMap(t => (typeof t.values[c.id] === 'number' ? [{ label: t.label, v: t.values[c.id] as number }] : []))
  if (!vals.length) return ''
  const raw = 'threshold' in c ? c.threshold : 'distancePct' in c ? c.distancePct : 'percent' in c ? c.percent : ''
  const goal = raw === '' ? NaN : Number(raw) * (c.type === 'LOSS' ? -1 : 1)
  const best = Number.isNaN(goal) ? vals[0] : vals.reduce((a, b) => (Math.abs(b.v - goal) < Math.abs(a.v - goal) ? b : a))
  const n = (v: number, d: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: d })}`
  const v = c.type === 'PRICE' ? `${n(best.v, 2)} USDT` : (c.type === 'PROFIT' || c.type === 'LOSS') && c.unit === 'USDT' ? `${n(best.v, 2)} USDT` : `${n(best.v, 1)}%`
  const distance = c.type === 'NEAR_LIQUIDATION' || c.type === 'NEAR_SL' || c.type === 'NEAR_TP'
  return distance ? `From mark price · now ${v} on ${best.label}` : `Now ${v} on ${best.label}`
}

/** A decimal string in range, or null. */
function checkNum(raw: string, r: Range, integer?: boolean): string | null {
  const v = parseDec(raw)
  return v !== null && inRange(Number(v), r) && (!integer || Number.isInteger(Number(v))) ? v : null
}

function numericSheet(key: string, condId: string | undefined, fk: string) {
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
    note.textContent = !ok && typed ? rangeText(f.range) : now
    note.classList.toggle('is-error', !ok && typed)
    sh.setDone(ok)
  }
  const sh = sheet({
    title: f.title, back: back(fk), focus: input,
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
  const paint = () => group.replaceChildren(
    ...presets.map(p => h('button', { class: 'radio-row', type: 'button', role: 'radio', 'aria-checked': String(pick === p), onclick: () => { pick = p; paint() } },
      h('span', { class: 'radio-row__label num' }, `${p}%`), pick === p ? h('span', { class: 'radio-row__check', html: icon('check', 20, 2.4) }) : null)),
    h('button', { class: 'radio-row', type: 'button', role: 'radio', 'aria-checked': String(!presets.includes(pick)), onclick: () => { sh.close(); numericSheet('close', undefined, fk) } },
      h('span', { class: 'radio-row__label' }, presets.includes(pick) ? 'Custom' : `Custom · ${pick}%`), h('span', { class: 'radio-row__detail', html: icon('right', 14, 2.6) })))
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
  const priceOk = s.draft.scope.type !== 'ALL_POSITIONS'
  const L = cat.limits
  const value = (): Target | null => {
    if (kind === 'entry') return { kind: 'ENTRY_OFFSET', percent: '0' }
    if (kind === 'price') { const v = checkNum(px.value, { gt: 0, lt: 1e9 }); return v ? { kind: 'PRICE', price: v } : null }
    const v = checkNum(pct.value, tp ? { gt: L.tpPct.min, le: L.tpPct.max } : { gt: 0, lt: L.stopPct.max })
    return v ? { kind: 'ENTRY_OFFSET', percent: side === 'adverse' && !tp ? `-${v}` : v } : null
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
    group.replaceChildren(
      ...(tp ? [] : [radio('entry', 'Entry price')]),
      radio('pct', '% from entry'),
      kind === 'pct' ? h('div', { class: 'sub-row' }, h('label', { class: 'inline-field' }, pct, h('span', {}, '%')), tp ? null : seg()) : '',
      radio('price', 'Price', priceOk ? undefined : 'Needs one symbol or position'),
      kind === 'price' ? h('div', { class: 'sub-row' }, h('label', { class: 'inline-field' }, px, h('span', {}, 'USDT'))) : '')
    sh.setDone(!!value())
  }
  const sh = sheet({
    title: tp ? 'Take profit' : 'Stop loss', back: back(fk),
    body: [group, h('p', { class: 'footnote' }, `${a.type === 'MOVE_SL' ? 'Moves only closer. ' : ''}The exact price shows on Even G2 before you confirm.`)],
    onDone: () => {
      const v = value()
      if (!v) return false
      commit(d => { (d.action as typeof a).target = v })
    },
  })
  for (const i of [pct, px]) i.addEventListener('input', () => sh.setDone(!!value()))
  paint()
}

const HINT: Record<TriggerMode, string> = { ON_ENTRY: 'each time it becomes true', ON_EVENT: 'only for crossings and fills', ONCE: '', REPEAT: '' }

function optionsSheet() {
  const o = { trigger: structuredClone(s.draft.trigger), delivery: { ...s.draft.delivery } }
  const phrase = h('input', {
    class: 'text-field__input', type: 'text', value: s.draft.voicePhrase ?? '', placeholder: 'e.g. protect all', maxlength: cat.limits.maxPhrase,
    autocapitalize: 'none', autocomplete: 'off', 'aria-label': 'Voice phrase',
  })
  const fires = h('div', { class: 'group', role: 'radiogroup', 'aria-label': 'When it fires' })
  const paint = () => fires.replaceChildren(...triggerChoices({ ...s.draft, trigger: o.trigger }).map(c => h('button', {
    class: 'radio-row', type: 'button', role: 'radio', 'aria-checked': String(o.trigger.mode === c.mode), disabled: !!c.why,
    onclick: () => { o.trigger = c.mode === 'REPEAT' ? { mode: 'REPEAT', intervalSec: cat.limits.repeatSec.default } : { mode: c.mode }; paint() },
  },
  h('span', { class: 'radio-row__check', html: o.trigger.mode === c.mode ? icon('check', 20, 2.4) : '' }),
  h('span', { class: 'radio-row__label' }, c.mode === 'REPEAT' ? `Repeat every ${cat.limits.repeatSec.default / 60} min` : { ON_ENTRY: 'On entry', ON_EVENT: 'On event', ONCE: 'Once' }[c.mode]),
  h('span', { class: 'radio-row__detail' }, c.why ?? HINT[c.mode]))))
  // shortcut: Repeat uses the 5 min default, add an interval token when someone needs another
  const saved = !!s.id
  const sh = sheet({
    title: 'Options', back: back('options'),
    body: [
      h('h3', { class: 'group-label' }, 'When it fires'), fires,
      h('h3', { class: 'group-label' }, 'Delivery'),
      h('div', { class: 'group' },
        h('div', { class: 'row row--switch' }, h('span', { id: 'opt-glasses' }, 'Show on glasses'), rowSwitch(o.delivery.glasses, 'opt-glasses', (on, b) => { o.delivery.glasses = on; b.setAttribute('aria-checked', String(on)) })),
        h('div', { class: 'row row--switch' }, h('span', { id: 'opt-phone' }, 'Send to phone'), rowSwitch(o.delivery.phone, 'opt-phone', (on, b) => { o.delivery.phone = on; b.setAttribute('aria-checked', String(on)) }))),
      h('h3', { class: 'group-label' }, 'Voice phrase'),
      h('label', { class: 'text-field', html: icon('mic', 20, 2) }, phrase),
      h('p', { class: 'footnote' }, 'Say it on Even G2 to run this shortcut now.'),
      saved ? h('div', { class: 'group group--gap' },
        h('button', { class: 'row row--btn is-accent', type: 'button', onclick: () => { sh.close(); void testAlert() } }, 'Send a test alert'),
        h('button', { class: 'row row--btn is-danger', type: 'button', onclick: () => { sh.close(); void remove() } }, 'Delete shortcut')) : '',
    ],
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
    { label: 'Duplicate', onPick: () => void duplicate() },
    { label: 'Test alert', onPick: () => void testAlert() },
    { label: 'Delete', danger: true, onPick: () => void remove() },
  ], 'Shortcut', back('title'))
}

function renameSheet() {
  const input = h('input', { class: 'text-field__input', type: 'text', value: s.draft.name ?? '', placeholder: s.draft.action ? titleOf({ action: s.draft.action }) : '', maxlength: cat.limits.maxName, 'aria-label': 'Name' })
  sheet({
    title: 'Rename', back: back('title'), focus: input, body: [h('label', { class: 'text-field' }, input), h('p', { class: 'footnote' }, 'Leave it empty to use the action name.')],
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
  if (pick !== 0) return
  try {
    await api.deleteShortcut(s.id, s.version!)
    s.done = true
    location.replace('#/')
  } catch (e) {
    if ((e as ApiError).status === 409) { toast('Changed on another device. Reloaded.'); return void enterEditor(el, s.id) }
    toast((e as Error).message)
  }
}
