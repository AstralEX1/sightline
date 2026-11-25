// Independent checks of validateShortcut against docs/shortcuts-architecture.md §4–§8, §12.
// The tables below are retyped from the brief on purpose: registry.ts is what is under test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateShortcut, type Validation } from '../src/validate.ts'
import {
  CONDITION_ACTION, STACKING, SCOPE_RULES, TEMPLATES, VOICE_SEEDS, catalog,
  type ActionType, type ConditionType, type ScopeType, type TemplateCategory,
} from '../src/registry.ts'
import { template } from './removed-templates.ts'

// §5 C1–C13 and §6 A1–A10.
const C: ConditionType[] = ['PRICE', 'PRICE_CHANGE', 'PROFIT', 'LOSS', 'NEAR_LIQUIDATION', 'NEAR_SL', 'NEAR_TP', 'ORDER_FILLED', 'ORDER_PARTIAL', 'VOLUME_SPIKE', 'FUNDING', 'ORDER_STALE', 'POSITION_CLOSED']
const A: ActionType[] = ['CLOSE_POSITION', 'MOVE_SL', 'SET_SL', 'SET_TP', 'ADD_MARGIN', 'OPEN_LONG', 'OPEN_SHORT', 'INCREASE_POSITION', 'CANCEL_ORDER', 'NOTIFY']

// §7, columns Close, Move SL, Set SL, Set TP, Margin, Open long, Open short, Increase, Cancel, Notify.
const DOC_CONDITION_ACTION = `
C1  Y G G G G G G G G Y
C2  Y G G G G G G G G Y
C3  Y G G G G N N G N Y
C4  Y G G G G N N G N Y
C5  Y G G N G N N N N Y
C6  Y G N N G N N N N Y
C7  Y G G G G N N N N Y
C8  G G G G G N N N N Y
C9  G G G G G N N N Y Y
C10 Y G G G G N N N N Y
C11 Y N N N N N N N N Y
C12 N N N N N N N N Y Y
C13 N N N N N N N N N Y`
// §7 condition stacking matrix, columns C1–C13.
const DOC_STACKING = `
C1  V B B B B B B A A B B B -
C2  B V B B B B B A A B B B -
C3  B B V O B B B - - B B - -
C4  B B O V B B B - - B B - -
C5  B B B B V B B - - B B - -
C6  B B B B B V B - - B B - -
C7  B B B B B B V - - B B - -
C8  A A - - - - - V O - - - -
C9  A A - - - - - O V - - - -
C10 B B B B B B B - - V B - -
C11 B B B B B B B - - B V - -
C12 B B - - - - - - - - - V -
C13 - - - - - - - - - - - - V`

const table = <K extends string>(cols: readonly K[], text: string) =>
  Object.fromEntries(text.trim().split('\n').map((line, i) => {
    const cells = line.trim().split(/\s+/).slice(1)
    return [C[i], Object.fromEntries(cols.map((k, j) => [k, cells[j]]))]
  })) as Record<ConditionType, Record<K, string>>
const DOC_CA = table(A, DOC_CONDITION_ACTION)
const DOC_ST = table(C, DOC_STACKING)

// Smallest valid parts.
const SCOPE: Record<ScopeType, object> = {
  POSITION: { type: 'POSITION', symbol: 'BTCUSDT', positionIdx: 0, epoch: 'e1' },
  ALL_POSITIONS: { type: 'ALL_POSITIONS' },
  COIN_POSITIONS: { type: 'COIN_POSITIONS', symbols: ['BTCUSDT'], side: 'ANY' },
  SYMBOL: { type: 'SYMBOL', symbol: 'BTCUSDT' },
  ORDER: { type: 'ORDER', symbol: 'BTCUSDT', orderId: 'o1' },
  ALL_ORDERS: { type: 'ALL_ORDERS' },
}
const COND: Record<ConditionType, object> = {
  PRICE: { type: 'PRICE', source: 'LAST', operator: 'GTE', threshold: '100' },
  PRICE_CHANGE: { type: 'PRICE_CHANGE', source: 'LAST', direction: 'UP', percent: '3' },
  PROFIT: { type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '30' },
  LOSS: { type: 'LOSS', unit: 'ROI_PERCENT', threshold: '20' },
  NEAR_LIQUIDATION: { type: 'NEAR_LIQUIDATION', distancePct: '5' },
  NEAR_SL: { type: 'NEAR_SL', distancePct: '1' },
  NEAR_TP: { type: 'NEAR_TP', distancePct: '1' },
  ORDER_FILLED: { type: 'ORDER_FILLED' },
  ORDER_PARTIAL: { type: 'ORDER_PARTIAL' },
  VOLUME_SPIKE: { type: 'VOLUME_SPIKE', multiplier: '3', windowSec: 300 },
  FUNDING: { type: 'FUNDING', ratePct: '0.05', minutesBefore: 30 },
  ORDER_STALE: { type: 'ORDER_STALE', minutes: 60 },
  POSITION_CLOSED: { type: 'POSITION_CLOSED', by: 'SL' },
}
const ACT: Record<ActionType, object> = {
  CLOSE_POSITION: { type: 'CLOSE_POSITION', percent: '50' },
  MOVE_SL: { type: 'MOVE_SL', target: { kind: 'ENTRY_OFFSET', percent: '0' } },
  SET_SL: { type: 'SET_SL', target: { kind: 'ENTRY_OFFSET', percent: '-2' } },
  SET_TP: { type: 'SET_TP', target: { kind: 'ENTRY_OFFSET', percent: '5' } },
  ADD_MARGIN: { type: 'ADD_MARGIN', amount: '100', unit: 'USDT' },
  OPEN_LONG: { type: 'OPEN_LONG', sizes: ['100'], leverages: ['5'] },
  OPEN_SHORT: { type: 'OPEN_SHORT', sizes: ['100', '250'], leverages: ['1', '1.5', '2', '5', '10'] },
  INCREASE_POSITION: { type: 'INCREASE_POSITION', notionalUsdt: '100' },
  CANCEL_ORDER: { type: 'CANCEL_ORDER' },
  NOTIFY: { type: 'NOTIFY' },
}
const price = (operator: string, threshold: string, source = 'LAST') => ({ type: 'PRICE', source, operator, threshold })
const change = (direction: string, percent: string, source = 'LAST') => ({ type: 'PRICE_CHANGE', source, direction, percent })
const ON_ENTRY = { mode: 'ON_ENTRY' }, ON_EVENT = { mode: 'ON_EVENT' }, ONCE = { mode: 'ONCE' }

const PREFERRED: ScopeType[] = ['POSITION', 'ALL_POSITIONS', 'COIN_POSITIONS', 'SYMBOL', 'ORDER', 'ALL_ORDERS']
const scopeFor = (cs: ConditionType[], a: ActionType) =>
  PREFERRED.find(s => cs.every(c => SCOPE_RULES[s].conditions.includes(c)) && SCOPE_RULES[s].actions.includes(a))
const triggerFor = (cs: ConditionType[], a: ActionType) =>
  a === 'OPEN_LONG' || a === 'OPEN_SHORT' || a === 'INCREASE_POSITION' ? ONCE : cs.some(c => c === 'ORDER_FILLED' || c === 'ORDER_PARTIAL' || c === 'POSITION_CLOSED') ? ON_EVENT : ON_ENTRY

interface Parts { scope?: object; logic?: string; items?: object[]; action?: object; trigger?: object; delivery?: object; voicePhrase?: unknown }
/** Conditions get ids c1, c2, … unless they bring their own. */
const rule = (p: Parts = {}) => ({
  scope: p.scope ?? SCOPE.POSITION,
  conditions: { logic: p.logic ?? 'ALL', items: (p.items ?? []).map((c, i) => ({ id: `c${i + 1}`, ...c })) },
  action: p.action ?? ACT.NOTIFY,
  trigger: p.trigger ?? ON_ENTRY,
  delivery: p.delivery ?? { glasses: true, phone: true },
  ...(p.voicePhrase !== undefined && { voicePhrase: p.voicePhrase }),
})

/** Validates and checks what every answer must look like: ok exactly when there is nothing to show, a value only when ok. */
function check(input: unknown, ctx?: { phrasesInUse?: string[] }): Validation {
  const v = validateShortcut(input, ctx)
  assert.equal(typeof v.ok, 'boolean')
  for (const i of v.issues) assert.ok(typeof i.code === 'string' && typeof i.message === 'string' && i.message.length > 0, JSON.stringify(i))
  assert.equal(v.ok, v.issues.length === 0, `ok=${v.ok} with ${JSON.stringify(v.issues)}`)
  assert.equal(v.value !== undefined, v.ok)
  return v
}
const codes = (input: unknown, ctx?: { phrasesInUse?: string[] }) => check(input, ctx).issues.map(i => i.code)
const accepts = (input: unknown, ctx?: { phrasesInUse?: string[] }) => {
  const v = check(input, ctx)
  assert.deepEqual(v.issues, [])
  return v.value!
}

// ---- Matrices (§7) ----

test('STACKING is symmetric', () => {
  for (const x of C) for (const y of C) assert.equal(STACKING[x][y], STACKING[y][x], `${x} × ${y}`)
})

test('CONDITION_ACTION matches the §7 table cell by cell', () => {
  assert.deepEqual(CONDITION_ACTION, DOC_CA)
})

test('STACKING matches the §7 stacking table cell by cell', () => {
  assert.deepEqual(STACKING, DOC_ST)
})

test('catalog numbers conditions C1–C13 and actions A1–A9 as §5 and §6, and ships both matrices', () => {
  const cat = JSON.parse(JSON.stringify(catalog()))
  assert.deepEqual(cat.conditions.map((c: { code: string; type: string }) => [c.code, c.type]), C.map((t, i) => [`C${i + 1}`, t]))
  assert.deepEqual(cat.actions.map((a: { code: string; type: string }) => [a.code, a.type]), A.map((t, i) => [`A${i + 1}`, t]))
  assert.deepEqual(cat.conditionAction, DOC_CA)
  assert.deepEqual(cat.stacking, DOC_ST)
})

// ---- Every condition × action cell ----

for (const c of C) {
  for (const a of A) {
    const cell = DOC_CA[c][a]
    test(`${c} with ${a} is ${cell}`, () => {
      const common = scopeFor([c], a)
      if (!common) assert.equal(cell, 'N', 'a pair with no common scope must be an N cell')
      const scope = common ?? PREFERRED.find(s => SCOPE_RULES[s].conditions.includes(c))!
      const v = check(rule({ scope: SCOPE[scope], items: [COND[c]], action: ACT[a], trigger: triggerFor([c], a) }))
      if (cell === 'N') {
        assert.ok(v.issues.some(i => i.code === 'incompatible_action' && i.conditionId === 'c1'), JSON.stringify(v.issues))
        if (common) assert.deepEqual(v.issues.map(i => i.code), ['incompatible_action'])
      } else {
        assert.deepEqual(v.issues, [])
      }
    })
  }
}

// ---- Every stacking pair, action Notify, both logics, both orders ----

for (let i = 0; i < C.length; i++) {
  for (let j = i + 1; j < C.length; j++) {
    const x = C[i], y = C[j], cell = DOC_ST[x][y]
    test(`${x} stacked with ${y} is ${cell}`, () => {
      const common = scopeFor([x, y], 'NOTIFY')
      if (cell === '-') {
        // no common scope, or one that holds both but where they make no sense together (a close leaves no position)
        if (common) assert.ok(codes(rule({ scope: SCOPE[common], items: [COND[x], COND[y]], trigger: triggerFor([x, y], 'NOTIFY') })).includes('cannot_combine'))
        for (const own of [x, y]) {
          const s = PREFERRED.find(t => SCOPE_RULES[t].conditions.includes(own))!
          for (const logic of ['ALL', 'ANY']) assert.equal(check(rule({ scope: SCOPE[s], logic, items: [COND[x], COND[y]], trigger: triggerFor([x, y], 'NOTIFY') })).ok, false)
        }
        return
      }
      assert.ok(common, `${cell} pair needs a common scope`)
      for (const [p, q] of [[x, y], [y, x]]) {
        for (const logic of ['ALL', 'ANY']) {
          const expected = cell === 'O' && logic === 'ALL' ? ['needs_or'] : cell === 'A' && logic === 'ANY' ? ['needs_and'] : []
          const got = codes(rule({ scope: SCOPE[common], logic, items: [COND[p], COND[q]], trigger: triggerFor([p, q], 'NOTIFY') }))
          assert.deepEqual(got, expected, `${p} ${logic} ${q}`)
        }
      }
    })
  }
}

test('Filled or Partial may Notify but cannot Cancel: the Filled row is flagged', () => {
  const v = check(rule({ scope: SCOPE.ORDER, logic: 'ANY', items: [COND.ORDER_FILLED, COND.ORDER_PARTIAL], action: ACT.CANCEL_ORDER, trigger: ON_EVENT }))
  assert.deepEqual(v.issues.map(i => [i.code, i.conditionId]), [['incompatible_action', 'c1']])
})

test('Loss may Increase (averaging down) but Near liquidation may not: the Near liquidation row is flagged', () => {
  const v = check(rule({ logic: 'ANY', items: [COND.LOSS, COND.NEAR_LIQUIDATION], action: ACT.INCREASE_POSITION, trigger: ONCE }))
  assert.deepEqual(v.issues.map(i => [i.code, i.conditionId]), [['incompatible_action', 'c2']])
})

test('a Notify with Glasses and Phone both off goes nowhere and is refused', () => {
  assert.deepEqual(codes(rule({ items: [COND.PROFIT], delivery: { glasses: false, phone: false } })), ['no_delivery'])
  accepts(rule({ items: [COND.PROFIT], delivery: { glasses: false, phone: true } }))
})

// ---- Same metric (V) ----

test('price range under ALL: low < high is fine, low >= high is never true', () => {
  accepts(rule({ items: [price('GTE', '100'), price('LTE', '200')] }))
  accepts(rule({ items: [price('LTE', '200'), price('GTE', '100')] }))
  assert.deepEqual(codes(rule({ items: [price('GTE', '200'), price('LTE', '100')] })), ['never_true'])
  assert.deepEqual(codes(rule({ items: [price('LTE', '100'), price('GTE', '200')] })), ['never_true'])
  assert.deepEqual(codes(rule({ items: [price('GTE', '100'), price('LTE', '100')] })), ['never_true'])
})

test('price range under ANY: outside a range is fine, overlapping limits are always true', () => {
  accepts(rule({ logic: 'ANY', items: [price('GTE', '200'), price('LTE', '100')] }))
  assert.deepEqual(codes(rule({ logic: 'ANY', items: [price('GTE', '100'), price('LTE', '200')] })), ['always_true'])
  assert.deepEqual(codes(rule({ logic: 'ANY', items: [price('LTE', '200'), price('GTE', '100')] })), ['always_true'])
  assert.deepEqual(codes(rule({ logic: 'ANY', items: [price('GTE', '100'), price('LTE', '100')] })), ['always_true'])
})

test('the same condition twice is a duplicate, for every condition type and both logics', () => {
  for (const c of C) {
    for (const logic of ['ALL', 'ANY']) {
      const scope = SCOPE[scopeFor([c], 'NOTIFY')!]
      assert.deepEqual(codes(rule({ scope, logic, items: [COND[c], COND[c]], trigger: triggerFor([c], 'NOTIFY') })), ['duplicate'], `${c} ${logic}`)
    }
  }
})

test('two limits in the same direction are redundant', () => {
  const pairs: [string, object, object][] = [
    ['price above', price('GTE', '100'), price('GTE', '200')],
    ['price below', price('LTE', '100'), price('LTE', '200')],
    ['price rises', change('UP', '3'), change('UP', '5')],
    ['ROI above', COND.PROFIT, { ...COND.PROFIT, threshold: '50' }],
    ['loss above', { type: 'LOSS', unit: 'USDT', threshold: '100' }, { type: 'LOSS', unit: 'USDT', threshold: '200' }],
    ['two near-liquidation thresholds', COND.NEAR_LIQUIDATION, { ...COND.NEAR_LIQUIDATION, distancePct: '3' }],
    ['two near-SL thresholds', COND.NEAR_SL, { ...COND.NEAR_SL, distancePct: '2' }],
    ['two near-TP thresholds', COND.NEAR_TP, { ...COND.NEAR_TP, distancePct: '2' }],
  ]
  for (const [what, x, y] of pairs) {
    for (const logic of ['ALL', 'ANY']) assert.deepEqual(codes(rule({ logic, items: [x, y] })), ['redundant'], `${what} ${logic}`)
  }
})

test('same family, different metric is not redundant: ROI and USDT profit', () => {
  accepts(rule({ items: [COND.PROFIT, { type: 'PROFIT', unit: 'USDT', threshold: '100' }] }))
})

test('price change up and down: never true with and, fine with or', () => {
  assert.deepEqual(codes(rule({ items: [change('UP', '3'), change('DOWN', '3')] })), ['never_true'])
  accepts(rule({ logic: 'ANY', items: [change('UP', '3'), change('DOWN', '3')] }))
})

// ---- Crossings (§7 rules beyond the matrix) ----

test('a crossing or-ed with a level or a state is rejected', () => {
  const states: [ScopeType, object][] = [['SYMBOL', price('GTE', '200')], ['SYMBOL', change('UP', '3')], ['POSITION', COND.PROFIT]]
  for (const [s, other] of states) {
    for (const items of [[price('UP_CROSS', '100'), other], [other, price('UP_CROSS', '100')]]) {
      assert.deepEqual(codes(rule({ scope: SCOPE[s], logic: 'ANY', items, trigger: ON_EVENT })), ['crossing_or_state'], JSON.stringify(items))
    }
  }
})

test('a crossing and-ed with a state is fine', () => {
  accepts(rule({ items: [price('UP_CROSS', '100'), COND.PROFIT], trigger: ON_EVENT }))
  accepts(rule({ scope: SCOPE.SYMBOL, items: [price('DOWN_CROSS', '100'), change('DOWN', '3')], trigger: ON_EVENT }))
})

test('two crossings: rejected with and, fine with or', () => {
  const items = [price('UP_CROSS', '100'), price('DOWN_CROSS', '90')]
  assert.deepEqual(codes(rule({ scope: SCOPE.SYMBOL, items, trigger: ON_EVENT })), ['two_crossings'])
  accepts(rule({ scope: SCOPE.SYMBOL, logic: 'ANY', items, trigger: ON_EVENT }))
})

test('a crossing with a fill is rejected', () => {
  for (const fill of [COND.ORDER_FILLED, COND.ORDER_PARTIAL]) {
    assert.deepEqual(codes(rule({ scope: SCOPE.ORDER, items: [price('UP_CROSS', '100'), fill], trigger: ON_EVENT })), ['crossing_with_fill'])
  }
})

test('mixed price sources are rejected', () => {
  assert.deepEqual(codes(rule({ items: [price('GTE', '100', 'LAST'), change('UP', '3', 'MARK')] })), ['mixed_source'])
  assert.deepEqual(codes(rule({ items: [price('GTE', '100', 'LAST'), price('LTE', '200', 'INDEX')] })), ['mixed_source'])
  accepts(rule({ items: [price('GTE', '100', 'MARK'), change('UP', '3', 'MARK')] }))
})

// ---- Trigger policies (§8) ----

test('a crossing or a fill outside On event / Once needs On event', () => {
  for (const trigger of [ON_ENTRY, { mode: 'REPEAT' }]) {
    assert.deepEqual(codes(rule({ scope: SCOPE.SYMBOL, items: [price('UP_CROSS', '100')], trigger })), ['needs_on_event'])
    assert.deepEqual(codes(rule({ scope: SCOPE.ORDER, items: [COND.ORDER_FILLED], trigger })), ['needs_on_event'])
  }
  accepts(rule({ scope: SCOPE.SYMBOL, items: [price('UP_CROSS', '100')], trigger: ONCE }))
})

test('On event without an event is rejected', () => {
  assert.deepEqual(codes(rule({ items: [COND.PROFIT], trigger: ON_EVENT })), ['needs_event'])
  assert.deepEqual(codes(rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], trigger: ON_EVENT })), ['needs_event'])
})

test('Open and Increase without Once are rejected', () => {
  assert.deepEqual(codes(rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: ACT.OPEN_LONG, trigger: ON_ENTRY })), ['needs_once'])
  assert.deepEqual(codes(rule({ scope: SCOPE.SYMBOL, items: [price('UP_CROSS', '100')], action: ACT.OPEN_LONG, trigger: ON_EVENT })), ['needs_once'])
  assert.deepEqual(codes(rule({ items: [COND.PROFIT], action: ACT.INCREASE_POSITION, trigger: { mode: 'REPEAT' } })), ['needs_once'])
})

test('Repeat without an interval gets 5 minutes; a given interval is kept', () => {
  assert.deepEqual(accepts(rule({ items: [COND.PROFIT], trigger: { mode: 'REPEAT' } })).trigger, { mode: 'REPEAT', intervalSec: 300 })
  assert.deepEqual(accepts(rule({ items: [COND.PROFIT], trigger: { mode: 'REPEAT', intervalSec: 600 } })).trigger, { mode: 'REPEAT', intervalSec: 600 })
})

// ---- Scopes (§4, §6, §7) ----

test('an absolute price level on All positions is rejected; a relative price change is fine', () => {
  const v = check(rule({ scope: SCOPE.ALL_POSITIONS, items: [price('GTE', '100')] }))
  assert.equal(v.ok, false)
  assert.ok(v.issues.some(i => i.conditionId === 'c1'), JSON.stringify(v.issues))
  accepts(rule({ scope: SCOPE.ALL_POSITIONS, items: [change('UP', '3')] }))
})

test('a price target on All positions is rejected, the same target on one position is fine', () => {
  for (const type of ['MOVE_SL', 'SET_SL', 'SET_TP']) {
    const action = { type, target: { kind: 'PRICE', price: '60000' } }
    assert.deepEqual(codes(rule({ scope: SCOPE.ALL_POSITIONS, items: [COND.PROFIT], action })), ['price_needs_one_symbol'], type)
    accepts(rule({ scope: SCOPE.POSITION, items: [COND.PROFIT], action }))
  }
})

test('a position action on one order needs a fill condition', () => {
  assert.deepEqual(codes(rule({ scope: SCOPE.ORDER, items: [price('GTE', '100')], action: ACT.CLOSE_POSITION })), ['needs_fill'])
  assert.deepEqual(codes(rule({ scope: SCOPE.ORDER, items: [change('UP', '3')], action: ACT.MOVE_SL })), ['needs_fill'])
  accepts(rule({ scope: SCOPE.ORDER, items: [price('GTE', '100'), COND.ORDER_FILLED], action: ACT.CLOSE_POSITION, trigger: ON_EVENT }))
})

test('All orders: a fill can act on the position, a price target cannot, and the action needs the fill', () => {
  const tp = (target: object) => ({ type: 'SET_TP', target })
  accepts(rule({ scope: SCOPE.ALL_ORDERS, items: [COND.ORDER_FILLED], action: tp({ kind: 'ENTRY_OFFSET', percent: '3' }), trigger: ON_EVENT }))
  assert.deepEqual(codes(rule({ scope: SCOPE.ALL_ORDERS, items: [COND.ORDER_FILLED], action: tp({ kind: 'PRICE', price: '60000' }), trigger: ON_EVENT })), ['price_needs_one_symbol'])
  assert.deepEqual(codes(rule({ scope: SCOPE.ALL_ORDERS, items: [], voicePhrase: 'tp all', action: tp({ kind: 'ENTRY_OFFSET', percent: '3' }) })), ['needs_fill'])
})

test('Open works only on one symbol', () => {
  for (const s of PREFERRED) {
    const v = check(rule({ scope: SCOPE[s], items: [change('UP', '3')], action: ACT.OPEN_LONG, trigger: ONCE }))
    assert.equal(v.ok, s === 'SYMBOL', `${s}: ${JSON.stringify(v.issues)}`)
  }
})

test('Cancel works only on one order', () => {
  for (const s of PREFERRED) {
    const v = check(rule({ scope: SCOPE[s], items: [change('UP', '3')], action: ACT.CANCEL_ORDER }))
    assert.equal(v.ok, s === 'ORDER', `${s}: ${JSON.stringify(v.issues)}`)
  }
})

test('Open position from before the split loads as Open long or Open short with one choice each', () => {
  const v = check(rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: { type: 'OPEN_POSITION', side: 'SHORT', notionalUsdt: '100', leverage: '5' }, trigger: ONCE }))
  assert.deepEqual(v.value?.action, { type: 'OPEN_SHORT', sizes: ['100'], leverages: ['5'] })
})

test('Positions by coin: a price level or a price target needs one coin', () => {
  const two = { type: 'COIN_POSITIONS', symbols: ['BTCUSDT', 'ETHUSDT'], side: 'LONG' }
  accepts(rule({ scope: SCOPE.COIN_POSITIONS, items: [price('GTE', '100')] }))
  accepts(rule({ scope: two, items: [change('UP', '3')], action: { type: 'MOVE_SL', target: { kind: 'ENTRY_OFFSET', percent: '0' } } }))
  assert.deepEqual(codes(rule({ scope: two, items: [price('GTE', '100')] })), ['price_needs_one_symbol'])
  assert.deepEqual(codes(rule({ scope: two, items: [COND.PROFIT], action: { type: 'SET_SL', target: { kind: 'PRICE', price: '90' } } })), ['price_needs_one_symbol'])
})

test('Add margin from before the units loads as USDT', () => {
  const v = check(rule({ items: [COND.PROFIT], action: { type: 'ADD_MARGIN', usdt: '50' } }))
  assert.deepEqual(v.value?.action, { type: 'ADD_MARGIN', amount: '50', unit: 'USDT' })
  assert.deepEqual(check(rule({ items: [COND.PROFIT], action: { type: 'ADD_MARGIN', amount: '20', unit: 'MARGIN_PERCENT' } })).value?.action, { type: 'ADD_MARGIN', amount: '20', unit: 'MARGIN_PERCENT' })
})

test('a voice-only shortcut still passes the scope rules', () => {
  accepts(rule({ scope: SCOPE.SYMBOL, action: ACT.OPEN_LONG, trigger: ONCE, voicePhrase: 'buy btc' }))
  assert.equal(check(rule({ scope: SCOPE.ALL_POSITIONS, action: ACT.OPEN_LONG, trigger: ONCE, voicePhrase: 'buy btc' })).ok, false)
  assert.equal(check(rule({ scope: SCOPE.POSITION, action: ACT.CANCEL_ORDER, voicePhrase: 'cancel it' })).ok, false)
})

// ---- Voice (§4) ----

test('no conditions and no phrase is rejected', () => {
  assert.deepEqual(codes(rule({ items: [] })), ['no_conditions'])
  assert.deepEqual(codes(rule({ items: [], voicePhrase: '' })), ['no_conditions'])
  const { conditions: _, ...noConditions } = rule({ items: [] })
  assert.equal(check(noConditions).ok, false)
})

test('no conditions with a phrase is a voice-only shortcut', () => {
  const v = accepts(rule({ scope: SCOPE.ALL_POSITIONS, items: [], action: ACT.SET_SL, voicePhrase: 'protect all' }))
  assert.equal(v.voicePhrase, 'protect all')
  assert.deepEqual(v.conditions.items, [])
})

test('a phrase another shortcut has is taken', () => {
  const input = rule({ items: [COND.PROFIT], voicePhrase: 'protect all' })
  assert.deepEqual(codes(input, { phrasesInUse: ['lock profits', 'protect all'] }), ['phrase_taken'])
  accepts(input, { phrasesInUse: ['lock profits'] })
})

test('a phrase must be up to 40 lowercase letters, digits and spaces', () => {
  for (const p of ['Protect all', 'PROTECT ALL', 'protect all!', 'protect-all', 'close, now', ' protect all', 'a'.repeat(41), 42]) {
    const v = check(rule({ items: [COND.PROFIT], voicePhrase: p }))
    assert.equal(v.ok, false, String(p))
    assert.equal(v.issues.length, 1, String(p))
  }
  accepts(rule({ items: [COND.PROFIT], voicePhrase: 'close 2 now' }))
  accepts(rule({ items: [COND.PROFIT], voicePhrase: 'a'.repeat(40) }))
})

test('both voice seeds validate and match §12', () => {
  const seen = VOICE_SEEDS.map(seed => {
    const v = accepts(seed)
    return [v.voicePhrase, v.conditions.items.length, v.scope.type, JSON.stringify(v.action)]
  })
  assert.deepEqual(seen, [
    ['protect all', 0, 'ALL_POSITIONS', JSON.stringify(ACT.SET_SL)],
    ['lock profits', 0, 'ALL_POSITIONS', JSON.stringify(ACT.MOVE_SL)],
  ])
})

// ---- Templates (§12) ----

const words = (o: object): string => Object.entries(o).filter(([k]) => k !== 'id')
  .map(([, v]) => (v !== null && typeof v === 'object' ? words(v) : v === '' ? '_' : String(v))).join(' ')

// Category, card, scope, trigger, conditions and action as §12 states them (each a prefix of the draft's own words).
const BRIEF_TEMPLATES: [TemplateCategory, string, ScopeType, string, string[], string][] = [
  ['Protect', 'Close position · Near liquidation · half', 'ALL_POSITIONS', 'ON_ENTRY', ['NEAR_LIQUIDATION 3'], 'CLOSE_POSITION 50'],
  ['Protect', 'Add margin · Near liquidation · 25%', 'ALL_POSITIONS', 'ON_ENTRY', ['NEAR_LIQUIDATION 5'], 'ADD_MARGIN 25 MARGIN_PERCENT'],
  ['Protect', 'Notify · Near stop loss', 'ALL_POSITIONS', 'ON_ENTRY', ['NEAR_SL 1'], 'NOTIFY'],
  ['Protect', 'Notify · Closed by stop loss', 'ALL_POSITIONS', 'ON_EVENT', ['POSITION_CLOSED SL'], 'NOTIFY'],
  ['Take profit', 'Move stop loss · ROI above 20% · breakeven', 'ALL_POSITIONS', 'ON_ENTRY', ['PROFIT ROI_PERCENT 20'], 'MOVE_SL ENTRY_OFFSET 0'],
  ['Take profit', 'Close position · ROI above 50% · half', 'ALL_POSITIONS', 'ON_ENTRY', ['PROFIT ROI_PERCENT 50'], 'CLOSE_POSITION 50'],
  ['Market', 'Notify · Price crosses a level', 'SYMBOL', 'ON_EVENT', ['PRICE'], 'NOTIFY'],
  ['Market', 'Notify · Price moves 15%', 'ALL_POSITIONS', 'ON_ENTRY', ['PRICE_CHANGE LAST UP 15', 'PRICE_CHANGE LAST DOWN 15'], 'NOTIFY'],
  ['Market', 'Notify · Price falls 2%', 'ALL_POSITIONS', 'ON_ENTRY', ['PRICE_CHANGE LAST DOWN 2'], 'NOTIFY'],
  ['Market', 'Notify · Funding above 0.05% in 30 min', 'ALL_POSITIONS', 'ON_ENTRY', ['FUNDING 0.05 30'], 'NOTIFY'],
  ['Orders', 'Set take profit · Order filled', 'ALL_ORDERS', 'ON_EVENT', ['ORDER_FILLED'], 'SET_TP ENTRY_OFFSET 3'],
  ['Orders', 'Cancel order · Order open over 1 h', 'ALL_ORDERS', 'ON_ENTRY', ['ORDER_STALE 60'], 'CANCEL_ORDER'],
]

const startsWithWords = (actual: string, expected: string) => actual === expected || actual.startsWith(`${expected} `)

test('the 12 templates are the §12 cards, by category, in grid order', () => {
  assert.equal(TEMPLATES.length, 12)
  assert.equal(new Set(TEMPLATES.map(t => t.id)).size, 12)
  TEMPLATES.forEach((t, i) => {
    const [category, card, scope, mode, conds, action] = BRIEF_TEMPLATES[i]
    assert.equal(t.category, category, card)
    assert.equal(`${t.title} · ${t.sub}`, card)
    assert.equal(t.draft.scope.type, scope, card)
    assert.equal(t.draft.trigger.mode, mode, card)
    assert.equal(t.draft.conditions.logic, conds.length > 1 ? 'ANY' : 'ALL', card) // two conditions: either one fires
    assert.equal(t.draft.conditions.items.length, conds.length, card)
    t.draft.conditions.items.forEach((c, j) => assert.ok(startsWithWords(words(c), conds[j]), `${card}: ${words(c)}`))
    assert.ok(startsWithWords(words(t.draft.action), action), `${card}: ${words(t.draft.action)}`)
  })
})

// Removed templates (test fixtures now) are checked too: engine tests build on them.
for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 16, 17, 18, 19, 20, 21, 23, 24, 25]) {
  test(`template ${n} validates as it is`, () => { accepts(template(n)) })
}

// What the user still has to enter (§12): [conditionId or undefined, the blank field's name].
const BLANKS: Record<number, [string | undefined, string][]> = {
  10: [[undefined, 'symbol'], ['c1', 'threshold']],
  12: [[undefined, 'symbol']],
  13: [[undefined, 'symbol'], ['c1', 'threshold']],
  15: [[undefined, 'symbol'], [undefined, 'orderId']],
  22: [[undefined, 'symbol']],
}
const SENSIBLE: Record<string, string> = { symbol: 'BTCUSDT', orderId: 'o1', threshold: '100000', notionalUsdt: '100', leverage: '5' }
const fillBlanks = (o: unknown): unknown => Array.isArray(o) ? o.map(fillBlanks)
  : o !== null && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => {
    if (v !== '') return [k, fillBlanks(v)]
    assert.ok(k in SENSIBLE, `no sensible value for blank ${k}`)
    return [k, SENSIBLE[k]]
  })) : o

for (const n of [10, 12, 13, 15, 22]) {
  test(`template ${n} reports exactly its blanks, then validates once they are filled`, () => {
    const draft = template(n)
    const v = check(draft)
    assert.ok(v.issues.every(i => i.code === 'missing_value'), JSON.stringify(v.issues))
    const got = v.issues.map(i => [i.conditionId, i.field ?? ''] as const)
    assert.equal(got.length, BLANKS[n].length, JSON.stringify(v.issues))
    for (const [conditionId, key] of BLANKS[n]) {
      assert.ok(got.some(([id, field]) => id === conditionId && field.endsWith(key)), `missing blank ${key}: ${JSON.stringify(v.issues)}`)
    }
    accepts(fillBlanks(draft))
  })
}

// ---- Delivery ----

test('a trade action with glasses off is rejected; Notify with glasses off is fine', () => {
  for (const a of A) {
    const input = rule({ scope: SCOPE[scopeFor(['PRICE_CHANGE'], a)!], items: [change('UP', '3')], action: ACT[a], trigger: triggerFor(['PRICE_CHANGE'], a), delivery: { glasses: false, phone: true } })
    assert.deepEqual(codes(input), a === 'NOTIFY' ? [] : ['needs_glasses'], a)
  }
})

// ---- Trust boundary ----

test('unknown fields are dropped from value', () => {
  const base = rule({
    scope: { ...SCOPE.POSITION, extra: 1 },
    items: [{ ...COND.PROFIT, extra: 1 }],
    action: { ...ACT.SET_TP, extra: 1, target: { kind: 'ENTRY_OFFSET', percent: '5', extra: 1 } },
    trigger: { mode: 'ON_ENTRY', intervalSec: 300, extra: 1 },
    delivery: { glasses: true, phone: false, extra: 1 },
  })
  const input = { ...base, conditions: { ...base.conditions, extra: 1 }, id: 'sc_1', accountId: 'a1', version: 3, enabled: true, schemaVersion: 1, extra: { deep: true } }
  assert.deepEqual(accepts(input), {
    scope: SCOPE.POSITION,
    conditions: { logic: 'ALL', items: [{ id: 'c1', ...COND.PROFIT }] },
    action: ACT.SET_TP,
    trigger: { mode: 'ON_ENTRY' },
    delivery: { glasses: true, phone: false },
  })
})

test('the §4 example validates and keeps only the editable fields', () => {
  const example = JSON.parse(`{
    "schemaVersion": 1, "id": "sc_123", "accountId": "account_1", "version": 1, "enabled": true,
    "scope": {"type": "ALL_POSITIONS"},
    "conditions": {"logic": "ANY", "items": [
      {"id": "c1", "type": "NEAR_LIQUIDATION", "distancePct": "5"},
      {"id": "c2", "type": "LOSS", "unit": "ROI_PERCENT", "threshold": "20"}
    ]},
    "action": {"type": "CLOSE_POSITION", "percent": "50"},
    "trigger": {"mode": "ON_ENTRY"},
    "delivery": {"glasses": true, "phone": true}
  }`)
  const { schemaVersion: _s, id: _i, accountId: _a, version: _v, enabled: _e, ...editable } = example
  assert.deepEqual(accepts(example), editable)
})

test('non-object input is rejected without throwing', () => {
  for (const x of [null, undefined, 42, 'shortcut', true, [], [rule({ items: [COND.PROFIT] })], () => ({})]) {
    assert.equal(check(x).ok, false, String(x))
  }
})

test('junk in every part is rejected without throwing', () => {
  const junk = [
    { scope: 'ALL_POSITIONS', conditions: [], action: null, trigger: 'ONCE', delivery: 'both' },
    { ...rule({ items: [COND.PROFIT] }), conditions: { logic: 'XOR', items: [COND.PROFIT] } },
    { ...rule(), conditions: { logic: 'ALL', items: [null, 'PRICE', 7, [], { id: 'c1' }, { id: 'c2', type: 'RSI' }] } },
    { ...rule({ items: [COND.PROFIT] }), conditions: { logic: 'ALL', items: { id: 'c1', ...COND.PROFIT } } },
    rule({ scope: { type: 'PORTFOLIO' }, items: [COND.PROFIT] }),
    rule({ items: [COND.PROFIT], action: { type: 'WITHDRAW', usdt: '100' } }),
    rule({ items: [COND.PROFIT], trigger: { mode: 'ALWAYS' } }),
    rule({ items: [COND.PROFIT], delivery: { glasses: 'yes', phone: true } }),
  ]
  for (const x of junk) assert.equal(check(x).ok, false, JSON.stringify(x))
})

test('numbers or malformed strings where decimal strings are expected are rejected', () => {
  const at = (v: unknown) => [
    rule({ items: [price('GTE', v as string)] }),
    rule({ items: [change('UP', v as string)] }),
    rule({ items: [{ ...COND.PROFIT, threshold: v }] }),
    rule({ items: [{ ...COND.NEAR_LIQUIDATION, distancePct: v }] }),
    rule({ items: [COND.PROFIT], action: { type: 'CLOSE_POSITION', percent: v } }),
    rule({ items: [COND.PROFIT], action: { type: 'ADD_MARGIN', amount: v, unit: 'USDT' } }),
    rule({ items: [COND.PROFIT], action: { type: 'ADD_MARGIN', amount: v, unit: 'MARGIN_PERCENT' } }),
    rule({ items: [COND.PROFIT], action: { type: 'MOVE_SL', target: { kind: 'ENTRY_OFFSET', percent: v } } }),
    rule({ items: [COND.PROFIT], action: { type: 'INCREASE_POSITION', notionalUsdt: v }, trigger: ONCE }),
    rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: { ...ACT.OPEN_LONG, sizes: [v] }, trigger: ONCE }),
    rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: { ...ACT.OPEN_LONG, leverages: [v] }, trigger: ONCE }),
  ]
  for (const v of [5, 5.5, '1e2', '0x10', ' 5', '5 ', '5.', '.5', '5,5', 'NaN', 'Infinity', '+5', null, {}, ['5']]) {
    for (const x of at(v)) {
      const v2 = check(x)
      assert.equal(v2.ok, false, `${JSON.stringify(v)} in ${JSON.stringify(x)}`)
      assert.equal(v2.issues.length, 1, `${JSON.stringify(v)}: ${JSON.stringify(v2.issues)}`)
    }
  }
})

test('negative and out-of-range values are rejected', () => {
  const cases: [string, unknown][] = [
    ['price 0', rule({ items: [price('GTE', '0')] })],
    ['price negative', rule({ items: [price('LTE', '-1')] })],
    ['ROI negative', rule({ items: [{ ...COND.PROFIT, threshold: '-30' }] })],
    ['ROI 0', rule({ items: [{ ...COND.LOSS, threshold: '0' }] })],
    ['USDT loss negative', rule({ items: [{ type: 'LOSS', unit: 'USDT', threshold: '-100' }] })],
    ['distance 0', rule({ items: [{ ...COND.NEAR_LIQUIDATION, distancePct: '0' }] })],
    ['distance over 100', rule({ items: [{ ...COND.NEAR_SL, distancePct: '101' }] })],
    ['distance negative', rule({ items: [{ ...COND.NEAR_TP, distancePct: '-1' }] })],
    ['price change 0', rule({ items: [change('UP', '0')] })],
    ['price change negative', rule({ items: [change('DOWN', '-3')] })],
    ['price change over 100', rule({ items: [change('UP', '101')] })],
    ['close 0', rule({ items: [COND.PROFIT], action: { type: 'CLOSE_POSITION', percent: '0' } })],
    ['close over 100', rule({ items: [COND.PROFIT], action: { type: 'CLOSE_POSITION', percent: '101' } })],
    ['close negative', rule({ items: [COND.PROFIT], action: { type: 'CLOSE_POSITION', percent: '-50' } })],
    ['margin 0', rule({ items: [COND.PROFIT], action: { type: 'ADD_MARGIN', amount: '0', unit: 'USDT' } })],
    ['margin negative', rule({ items: [COND.PROFIT], action: { type: 'ADD_MARGIN', amount: '-100', unit: 'USDT' } })],
    ['margin over 100% of the margin', rule({ items: [COND.PROFIT], action: { type: 'ADD_MARGIN', amount: '101', unit: 'MARGIN_PERCENT' } })],
    ['margin unit', rule({ items: [COND.PROFIT], action: { type: 'ADD_MARGIN', amount: '10', unit: 'BTC' } })],
    ['coins empty', rule({ scope: { type: 'COIN_POSITIONS', symbols: [], side: 'ANY' } })],
    ['coins not a list', rule({ scope: { type: 'COIN_POSITIONS', symbols: 'BTCUSDT', side: 'ANY' } })],
    ['coin malformed', rule({ scope: { type: 'COIN_POSITIONS', symbols: ['btc'], side: 'ANY' } })],
    ['coin twice', rule({ scope: { type: 'COIN_POSITIONS', symbols: ['BTCUSDT', 'BTCUSDT'], side: 'ANY' } })],
    ['coins over the limit', rule({ scope: { type: 'COIN_POSITIONS', symbols: Array.from({ length: 11 }, (_, i) => `C${i}USDT`), side: 'ANY' } })],
    ['coins side', rule({ scope: { type: 'COIN_POSITIONS', symbols: ['BTCUSDT'], side: 'BOTH' } })],
    ['stop at -100%', rule({ items: [COND.PROFIT], action: { type: 'SET_SL', target: { kind: 'ENTRY_OFFSET', percent: '-100' } } })],
    ['stop at +100%', rule({ items: [COND.PROFIT], action: { type: 'MOVE_SL', target: { kind: 'ENTRY_OFFSET', percent: '100' } } })],
    ['take profit at entry', rule({ items: [COND.PROFIT], action: { type: 'SET_TP', target: { kind: 'ENTRY_OFFSET', percent: '0' } } })],
    ['take profit adverse', rule({ items: [COND.PROFIT], action: { type: 'SET_TP', target: { kind: 'ENTRY_OFFSET', percent: '-5' } } })],
    ['target price 0', rule({ items: [COND.PROFIT], action: { type: 'SET_SL', target: { kind: 'PRICE', price: '0' } } })],
    ['increase negative', rule({ items: [COND.PROFIT], action: { type: 'INCREASE_POSITION', notionalUsdt: '-100' }, trigger: ONCE })],
    ['open size 0', rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: { ...ACT.OPEN_LONG, sizes: ['0'] }, trigger: ONCE })],
    ['open no sizes', rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: { ...ACT.OPEN_LONG, sizes: [] }, trigger: ONCE })],
    ['open sizes not a list', rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: { ...ACT.OPEN_LONG, sizes: '100' }, trigger: ONCE })],
    ['open size twice', rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: { ...ACT.OPEN_LONG, sizes: ['100', '100.0'] }, trigger: ONCE })],
    ['open six leverages', rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: { ...ACT.OPEN_LONG, leverages: ['1', '2', '3', '4', '5', '6'] }, trigger: ONCE })],
    ['open leverage 0', rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: { ...ACT.OPEN_LONG, leverages: ['0'] }, trigger: ONCE })],
    ['open leverage 201', rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: { ...ACT.OPEN_SHORT, leverages: ['5', '201'] }, trigger: ONCE })],
    ['open stop on the winning side', rule({ scope: SCOPE.SYMBOL, items: [price('GTE', '100')], action: { ...ACT.OPEN_LONG, sl: { kind: 'ENTRY_OFFSET', percent: '2' } }, trigger: ONCE })],
    ['repeat under a minute', rule({ items: [COND.PROFIT], trigger: { mode: 'REPEAT', intervalSec: 30 } })],
    ['repeat over a day', rule({ items: [COND.PROFIT], trigger: { mode: 'REPEAT', intervalSec: 86_401 } })],
    ['position index 3', rule({ scope: { ...SCOPE.POSITION, positionIdx: 3 } })],
    ['position index as a string', rule({ scope: { ...SCOPE.POSITION, positionIdx: '0' } })],
    ['lowercase symbol', rule({ scope: { type: 'SYMBOL', symbol: 'btcusdt' }, items: [price('GTE', '100')] })],
  ]
  for (const [what, x] of cases) {
    const v = check(x)
    assert.equal(v.ok, false, what)
  }
  // The minimal rule itself is fine, so each rejection above is the bad value's doing.
  accepts(rule({ items: [COND.PROFIT] }))
})

test('up to 10 conditions; 11 are rejected', () => {
  const ten = [price('GTE', '100'), change('UP', '3'), COND.PROFIT, COND.LOSS, COND.NEAR_LIQUIDATION, COND.NEAR_SL, COND.NEAR_TP, COND.FUNDING,
    { type: 'PROFIT', unit: 'USDT', threshold: '100' }, { type: 'LOSS', unit: 'USDT', threshold: '50' }]
  accepts(rule({ logic: 'ANY', items: ten }))
  const v = check(rule({ logic: 'ANY', items: [...ten, change('DOWN', '3')] }))
  assert.ok(v.issues.some(i => i.code === 'too_many_conditions'), JSON.stringify(v.issues))
  assert.equal(check(rule({ logic: 'ANY', items: Array.from({ length: 1000 }, (_, i) => ({ ...COND.NEAR_TP, distancePct: String(i % 99 + 1) })) })).ok, false)
})

test('condition ids must be present and unique', () => {
  assert.equal(check(rule({ logic: 'ANY', items: [{ id: 'c1', ...COND.PROFIT }, { id: 'c1', ...COND.LOSS }] })).ok, false)
  assert.equal(check(rule({ items: [{ ...COND.PROFIT, id: undefined }] })).ok, false)
  assert.equal(check(rule({ items: [{ ...COND.PROFIT, id: '' }] })).ok, false)
  assert.equal(check(rule({ items: [{ ...COND.PROFIT, id: 7 }] })).ok, false)
})

// ---- The Incompatible screen (§7) ----

test('ROI above 30% or liquidation distance below 5% with Increase position flags the liquidation row', () => {
  const v = check(rule({ scope: SCOPE.ALL_POSITIONS, logic: 'ANY', items: [COND.PROFIT, COND.NEAR_LIQUIDATION], action: ACT.INCREASE_POSITION, trigger: ONCE }))
  assert.deepEqual(v.issues.map(({ code, conditionId, message }) => ({ code, conditionId, message })), [
    { code: 'incompatible_action', conditionId: 'c2', message: 'Liquidation distance is incompatible with Increase position' },
  ])
})
