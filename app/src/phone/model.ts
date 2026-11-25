/**
 * The editor's pure half: choice filtering with the catalog's matrices (spec §7.3, arch §7), atomic edits (§7.2),
 * the numeric fields and the save-or-discard decision (§7.1). No DOM, no I/O.
 */
import { isEvent, type Action, type ActionType, type Condition, type ConditionType, type Scope, type TriggerMode } from '../../../server/src/registry.ts'
import type { EditableShortcut } from '../../../server/src/validate.ts'
import type { Catalog } from '../api.ts'
import { metricWord } from './sentence.ts'

/** What the editor holds: a new shortcut may have no action yet. */
export type Draft = Omit<EditableShortcut, 'action'> & { action?: Action }

/** Back from the editor: nothing changed → leave; changed and valid → save; else ask (discard dialog). */
export const leaveDecision = (changed: boolean, ok: boolean): 'leave' | 'save' | 'ask' => (!changed ? 'leave' : ok ? 'save' : 'ask')

export const emptyDraft = (): Draft => ({
  scope: { type: 'ALL_POSITIONS' }, conditions: { logic: 'ALL', items: [] },
  trigger: { mode: 'ON_ENTRY' }, delivery: { glasses: true, phone: true },
})

// ── Choice filtering ─────────────────────────────────────

export type ConditionChoice = { group: string; label: string; type: ConditionType; unit?: 'ROI_PERCENT' | 'USDT' }
const CONDITION_CHOICES: ConditionChoice[] = [
  { group: 'Price', label: 'Price', type: 'PRICE' },
  { group: 'Price', label: 'Price change', type: 'PRICE_CHANGE' },
  { group: 'Market', label: 'Volume spike', type: 'VOLUME_SPIKE' },
  { group: 'Market', label: 'Funding rate', type: 'FUNDING' },
  { group: 'Profit and loss', label: 'ROI', type: 'PROFIT', unit: 'ROI_PERCENT' },
  { group: 'Profit and loss', label: 'Profit in USDT', type: 'PROFIT', unit: 'USDT' },
  { group: 'Profit and loss', label: 'Loss in USDT', type: 'LOSS', unit: 'USDT' },
  { group: 'Liquidation', label: 'Liquidation distance', type: 'NEAR_LIQUIDATION' },
  { group: 'Stop and target', label: 'Stop loss distance', type: 'NEAR_SL' },
  { group: 'Stop and target', label: 'Take profit distance', type: 'NEAR_TP' },
  { group: 'Stop and target', label: 'Stop loss is missing', type: 'SL_MISSING' },
  { group: 'Stop and target', label: 'Position closed', type: 'POSITION_CLOSED' },
  { group: 'Orders', label: 'Order filled', type: 'ORDER_FILLED' },
  { group: 'Orders', label: 'Order partly filled', type: 'ORDER_PARTIAL' },
  { group: 'Orders', label: 'Order open too long', type: 'ORDER_STALE' },
]

const scopeRules = (cat: Catalog, t: Scope['type']) => cat.scopes.find(s => s.type === t)!

/** Condition types that fit the scope, the action and every other condition; only static impossibilities are hidden. */
export function conditionChoices(cat: Catalog, d: Draft, replacing?: string): ConditionChoice[] {
  const others = d.conditions.items.filter(c => c.id !== replacing)
  const fits = (t: ConditionType) => scopeRules(cat, d.scope.type).conditions.includes(t)
    && (!d.action || cat.conditionAction[t][d.action.type] !== 'N')
    && others.every(c => cat.stacking[t][c.type] !== '-')
  // ROI is PROFIT or LOSS by the comparison, so it is offered when either fits
  return CONDITION_CHOICES.filter(c => (c.unit === 'ROI_PERCENT' ? fits('PROFIT') || fits('LOSS') : fits(c.type)))
}

/** Actions the scope allows; those the current conditions rule out go to "Needs changes" with the reason. */
export function actionChoices(cat: Catalog, d: Draft) {
  const ok: { type: ActionType; title: string }[] = []
  const needs: { type: ActionType; title: string; reason: string }[] = []
  for (const a of cat.actions) {
    if (!scopeRules(cat, d.scope.type).actions.includes(a.type)) continue
    const bad = d.conditions.items.find(c => cat.conditionAction[c.type][a.type] === 'N')
    if (bad) needs.push({ type: a.type, title: a.title, reason: `Not with ${metricWord(bad)}` })
    else ok.push({ type: a.type, title: a.title })
  }
  return { ok, needs }
}

/** Apply to options that can hold the current action (Open needs One symbol, Cancel One order). */
export const scopeChoices = (cat: Catalog, d: Draft) => cat.scopes.filter(s => !d.action || s.actions.includes(d.action.type))

const MODES: TriggerMode[] = ['ON_ENTRY', 'ON_EVENT', 'ONCE', 'REPEAT']
const onceOnly = (a?: Action) => a?.type === 'OPEN_POSITION' || a?.type === 'INCREASE_POSITION'

/** When it fires: each mode, with the one-line reason when it cannot be picked (spec §5.7). */
export function triggerChoices(d: Draft): { mode: TriggerMode; why?: string }[] {
  const ev = d.conditions.items.some(isEvent)
  const states = d.conditions.items.length > 0 && !ev
  return MODES.map(mode => ({
    mode,
    why: onceOnly(d.action) && mode !== 'ONCE' ? `${d.action!.type === 'OPEN_POSITION' ? 'Open position' : 'Increase position'} fires Once`
      : ev && (mode === 'ON_ENTRY' || mode === 'REPEAT') ? 'Not for crossings, fills and closes'
        : states && mode === 'ON_EVENT' ? 'Needs a price crossing, a fill or a close' : undefined,
  }))
}

/** After an edit: a trigger mode that became impossible moves to the one that fits, so the draft never needs a hidden fix. */
export function fitTrigger(d: Draft): void {
  const choice = triggerChoices(d).find(c => c.mode === d.trigger.mode)
  if (!choice?.why) return
  const mode = onceOnly(d.action) ? 'ONCE' : d.conditions.items.some(isEvent) ? 'ON_EVENT' : 'ON_ENTRY'
  d.trigger = { mode }
}

// ── Atomic edits ─────────────────────────────────────────

export const nextId = (items: Condition[]) => `c${Math.max(0, ...items.map(c => Number(c.id.slice(1)) || 0)) + 1}`

/** A fresh condition of a type; numbers start empty so nothing is carried into a new unit. */
export function newCondition(id: string, type: ConditionType, unit: 'ROI_PERCENT' | 'USDT' = 'ROI_PERCENT'): Condition {
  switch (type) {
    case 'PRICE': return { id, type, source: 'LAST', operator: 'GTE', threshold: '' }
    case 'PRICE_CHANGE': return { id, type, source: 'LAST', direction: 'UP', percent: '', windowSec: 300 }
    case 'PROFIT': case 'LOSS': return { id, type, unit, threshold: '' }
    case 'NEAR_LIQUIDATION': case 'NEAR_SL': case 'NEAR_TP': return { id, type, distancePct: '' }
    case 'VOLUME_SPIKE': return { id, type, multiplier: '', windowSec: 300 }
    case 'FUNDING': return { id, type, ratePct: '', minutesBefore: 30 }
    case 'ORDER_STALE': return { id, type, minutes: 60 }
    case 'POSITION_CLOSED': return { id, type, by: 'SL' }
    default: return { id, type } as Condition
  }
}

/** Metric token: a different metric or unit is a new condition under the same id (P08: the number clears). */
export function setMetric(c: Condition, type: ConditionType, unit?: 'ROI_PERCENT' | 'USDT'): Condition {
  const sameUnit = !('unit' in c) || unit === undefined || c.unit === unit
  if (c.type === type && sameUnit) return c
  return newCondition(c.id, type, unit)
}

/** Comparison token. ROI above ↔ below is PROFIT ↔ LOSS, so the old value is dropped (arch §4); other words keep the number. */
export function setCompare(c: Condition, word: string): Condition {
  switch (c.type) {
    case 'PRICE': {
      const operator = ({ above: 'GTE', below: 'LTE', 'crosses above': 'UP_CROSS', 'crosses below': 'DOWN_CROSS' } as const)[word as 'above'] ?? c.operator
      return { ...c, operator }
    }
    case 'PRICE_CHANGE': return { ...c, direction: word === 'falls' ? 'DOWN' : 'UP' }
    case 'PROFIT':
    case 'LOSS': {
      const type = word === 'below' ? 'LOSS' : 'PROFIT'
      return type === c.type ? c : { id: c.id, type, unit: c.unit, threshold: '' }
    }
    case 'ORDER_FILLED':
    case 'ORDER_PARTIAL': return { id: c.id, type: word === 'filled' ? 'ORDER_FILLED' : 'ORDER_PARTIAL' }
    case 'POSITION_CLOSED': return { ...c, by: word === 'liquidated' ? 'LIQUIDATION' : word.endsWith('take profit') ? 'TP' : 'SL' }
    default: return c
  }
}

/** A fresh action; values the user must choose start empty, the rest as the templates have them. */
export function newAction(type: ActionType): Action {
  switch (type) {
    case 'CLOSE_POSITION': return { type, percent: '50' }
    case 'MOVE_SL': return { type, target: { kind: 'ENTRY_OFFSET', percent: '0' } }
    case 'SET_SL': return { type, target: { kind: 'ENTRY_OFFSET', percent: '-2' } }
    case 'SET_TP': return { type, target: { kind: 'ENTRY_OFFSET', percent: '5' } }
    case 'ADD_MARGIN': return { type, usdt: '' }
    case 'OPEN_POSITION': return { type, side: 'LONG', notionalUsdt: '', leverage: '' }
    case 'INCREASE_POSITION': return { type, notionalUsdt: '' }
    default: return { type } as Action
  }
}

// ── Numbers ──────────────────────────────────────────────

/** gt/ge and lt/le bounds, as validate.ts has them. */
export type Range = { gt?: number; ge?: number; lt?: number; le?: number }
export const inRange = (n: number, r: Range) =>
  (r.gt === undefined || n > r.gt) && (r.ge === undefined || n >= r.ge) && (r.lt === undefined || n < r.lt) && (r.le === undefined || n <= r.le)
/** "Enter a number above 0%, up to 100%". `unit` as the sheet shows it: % and × sit on the number, words get a space. */
export const rangeText = (r: Range, unit = '') => {
  const u = (n: number) => `${n}${unit && !/^[%×]$/.test(unit) ? ' ' : ''}${unit}`
  const top = r.le !== undefined ? `, up to ${u(r.le)}` : r.lt !== undefined && r.lt < 1e9 ? `, below ${u(r.lt)}` : ''
  return r.gt !== undefined ? `Enter a number above ${u(r.gt)}${top}` : `Enter a number from ${u(r.ge!)} to ${u(r.le!)}`
}

/** One number the numeric sheet edits: what it shows and the bounds it accepts. */
export type NumField = { title: string; word: string; unit: string; sign?: string; value: string; range: Range; integer?: boolean }

const BIG = 1e9
/** The numeric sheet for a token of a condition (by id) or of the action. */
export function numField(cat: Catalog, d: Draft, key: string, conditionId?: string): NumField | null {
  const L = cat.limits
  const c = d.conditions.items.find(x => x.id === conditionId)
  const a = d.action
  if (c) {
    if (c.type === 'PRICE' && key === 'threshold') {
      const word = ({ GTE: 'Above', LTE: 'Below', UP_CROSS: 'Crosses above', DOWN_CROSS: 'Crosses below' } as const)[c.operator]
      return { title: 'Price', word, unit: 'USDT', value: c.threshold, range: { gt: 0, lt: BIG } }
    }
    if (c.type === 'PRICE_CHANGE' && key === 'percent') return { title: 'Price change', word: 'By', unit: '%', value: c.percent, range: { gt: L.pricePct.min, le: L.pricePct.max } }
    if (c.type === 'PRICE_CHANGE' && key === 'window') return { title: 'Time window', word: 'Within', unit: 'min', value: String(c.windowSec / 60), range: { ge: L.windowSec.min / 60, le: L.windowSec.max / 60 }, integer: true }
    if ((c.type === 'PROFIT' || c.type === 'LOSS') && key === 'threshold') {
      const roi = c.unit === 'ROI_PERCENT'
      return { title: roi ? 'ROI' : c.type === 'PROFIT' ? 'Profit' : 'Loss', word: c.type === 'LOSS' && roi ? 'Below' : 'Above', sign: c.type === 'LOSS' && roi ? '−' : undefined, unit: roi ? '%' : 'USDT', value: c.threshold, range: { gt: 0, lt: BIG } }
    }
    if (c.type === 'VOLUME_SPIKE' && key === 'multiplier') return { title: 'Volume', word: 'Above', unit: '×', value: c.multiplier, range: { gt: L.volumeX.min, le: L.volumeX.max } }
    if (c.type === 'VOLUME_SPIKE' && key === 'window') return { title: 'Time window', word: 'Within', unit: 'min', value: String(c.windowSec / 60), range: { ge: L.volumeWindowSec.min / 60, le: L.volumeWindowSec.max / 60 }, integer: true }
    if (c.type === 'FUNDING' && key === 'rate') return { title: 'Funding rate', word: 'Above', unit: '%', value: c.ratePct, range: { gt: L.fundingPct.min, le: L.fundingPct.max } }
    if (c.type === 'FUNDING' && key === 'minutes') return { title: 'Before funding', word: 'Within', unit: 'min', value: String(c.minutesBefore), range: { ge: L.fundingMin.min, le: L.fundingMin.max }, integer: true }
    if (c.type === 'ORDER_STALE' && key === 'minutes') return { title: 'Order age', word: 'Over', unit: 'min', value: String(c.minutes), range: { ge: L.orderAgeMin.min, le: L.orderAgeMin.max }, integer: true }
    if ((c.type === 'NEAR_LIQUIDATION' || c.type === 'NEAR_SL' || c.type === 'NEAR_TP') && key === 'distance') {
      const w = metricWord(c)
      return { title: w[0].toUpperCase() + w.slice(1), word: 'Below', unit: '%', value: c.distancePct, range: { gt: L.pricePct.min, le: L.pricePct.max } }
    }
    return null
  }
  if (a?.type === 'CLOSE_POSITION' && key === 'close') return { title: 'Close amount', word: 'Close', unit: '%', value: a.percent, range: { gt: L.closePct.min, le: L.closePct.max } }
  if (a?.type === 'ADD_MARGIN' && key === 'usdt') return { title: 'Margin', word: 'Add', unit: 'USDT', value: a.usdt, range: { gt: 0, lt: BIG } }
  if ((a?.type === 'OPEN_POSITION' || a?.type === 'INCREASE_POSITION') && key === 'notional') return { title: a.type === 'OPEN_POSITION' ? 'Size' : 'Increase by', word: 'Size', unit: 'USDT', value: a.notionalUsdt, range: { gt: 0, lt: BIG } }
  if (a?.type === 'OPEN_POSITION' && key === 'leverage') return { title: 'Leverage', word: 'Leverage', unit: '×', value: a.leverage, range: { ge: L.leverage.min, le: L.leverage.max } }
  return null
}

/** Writes a committed number back into the draft (mutates it). */
export function setNumber(d: Draft, key: string, value: string, conditionId?: string): void {
  const i = d.conditions.items.findIndex(x => x.id === conditionId)
  if (i >= 0) {
    const c = d.conditions.items[i]
    if (key === 'window' && (c.type === 'PRICE_CHANGE' || c.type === 'VOLUME_SPIKE')) d.conditions.items[i] = { ...c, windowSec: Number(value) * 60 }
    else if (key === 'multiplier' && c.type === 'VOLUME_SPIKE') d.conditions.items[i] = { ...c, multiplier: value }
    else if (key === 'rate' && c.type === 'FUNDING') d.conditions.items[i] = { ...c, ratePct: value }
    else if (key === 'minutes' && c.type === 'FUNDING') d.conditions.items[i] = { ...c, minutesBefore: Number(value) }
    else if (key === 'minutes' && c.type === 'ORDER_STALE') d.conditions.items[i] = { ...c, minutes: Number(value) }
    else if (key === 'percent' && c.type === 'PRICE_CHANGE') d.conditions.items[i] = { ...c, percent: value }
    else if (key === 'distance' && 'distancePct' in c) d.conditions.items[i] = { ...c, distancePct: value }
    else if (key === 'threshold' && 'threshold' in c) d.conditions.items[i] = { ...c, threshold: value }
    return
  }
  const a = d.action
  if (a?.type === 'CLOSE_POSITION') a.percent = value
  else if (a?.type === 'ADD_MARGIN') a.usdt = value
  else if (a?.type === 'INCREASE_POSITION') a.notionalUsdt = value
  else if (a?.type === 'OPEN_POSITION') { if (key === 'leverage') a.leverage = value; else a.notionalUsdt = value }
}
