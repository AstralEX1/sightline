// The store against docs/shortcuts-architecture.md §4, §9, §10, §12: versions, invalidation, uniqueness, outbox, recovery.
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ACCOUNT, StoreError, createStore, validateSettings } from '../src/store.ts'
import { initialTriggerState } from '../src/engine.ts'
import { CLOSE_SEED } from '../src/registry.ts'
import { DEFAULT_SETTINGS, type AlertRecord, type Execution, type ExecutionStatus, type Proposal } from '../src/types.ts'

const draft = (over: Record<string, unknown> = {}) => ({
  scope: { type: 'ALL_POSITIONS' },
  conditions: { logic: 'ALL', items: [{ id: 'c1', type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '30' }] },
  action: { type: 'MOVE_SL', target: { kind: 'ENTRY_OFFSET', percent: '0' } },
  trigger: { mode: 'ON_ENTRY' },
  delivery: { glasses: true, phone: true },
  ...over,
})

const alertRec = (id: string, shortcutId: string, createdAt: number): AlertRecord => ({
  id, shortcutId, version: 1, targetKey: 'pos:BTCUSDT:0:e1', target: 'BTCUSDT long', title: 'Move stop loss', reason: 'ROI 31%',
  matched: ['c1'], priority: 'NORMAL', simulated: false, delivery: { glasses: true, phone: true }, channels: ['glasses'],
  status: 'Waiting for confirmation', createdAt,
})

const proposalRec = (id: string, alertId: string, shortcutId: string, status: Proposal['status'], createdAt = 1): Proposal => ({
  id, key: 'k', title: 'Move stop loss', detail: 'BTCUSDT long', question: 'Move stop to entry?', who: 'BTC long', why: 'ROI +31.2%', createdAt, expiresAt: createdAt + 60_000,
  alertId, shortcutId, version: 1, targetKey: 'pos:BTCUSDT:0:e1', terms: { type: 'setStop', symbol: 'BTCUSDT', positionIdx: 0, price: 88_000 },
  simulated: false, priority: 'NORMAL', status,
})

const execRec = (id: string, proposalId: string, idempotencyKey: string, status: ExecutionStatus = 'AUTHORIZED', createdAt = 1): Execution => ({
  id, proposalId, idempotencyKey, terms: { type: 'setStop', symbol: 'BTCUSDT', positionIdx: 0, price: 88_000 },
  status, message: '', filledQty: 0, avgPrice: 0, createdAt, updatedAt: createdAt,
})

/** A store on a temp file plus a raw connection to look at the rows. */
function onFile(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'trade-shortcuts-store-'))
  const path = join(dir, 'data', 'trade-shortcuts.db') // the data directory does not exist yet
  const store = createStore(path, () => 1000)
  const raw = new DatabaseSync(path)
  t.after(() => { store.close(); raw.close(); rmSync(dir, { recursive: true, force: true }) })
  return { path, store, raw }
}

const created = (s: ReturnType<typeof createStore>, over: Record<string, unknown> = {}) => {
  const r = s.createShortcut(draft(over))
  assert.ok(r.ok, JSON.stringify(r))
  return r.shortcut
}

test('create stores version 1 of the validated draft, disabled unless asked', () => {
  const s = createStore(':memory:')
  const a = created(s, { name: '  Lock it ' })
  assert.match(a.id, /^sc_[0-9a-f]{16}$/)
  assert.deepEqual({ ...a, id: '' }, { schemaVersion: 1, id: '', accountId: ACCOUNT, version: 1, enabled: false, name: 'Lock it', ...draft() })
  const b = created(s, { enabled: true })
  assert.equal(b.enabled, true)
  assert.equal('name' in b || 'voicePhrase' in b, false)
  assert.deepEqual(s.listShortcuts().map(x => x.id), [a.id, b.id])
  assert.deepEqual(s.getShortcut(a.id), a)
  assert.deepEqual(s.auditLog(a.id).map(x => [x.event, x.detail]), [['created', 'version 1']])

  const bad = s.createShortcut(draft({ action: { type: 'CLOSE_POSITION', percent: '' } }))
  assert.equal(bad.ok, false)
  assert.ok(!bad.ok && bad.issues.some(i => i.field === 'action.percent'))
  assert.equal(s.listShortcuts().length, 2)
  assert.equal(s.getShortcut('sc_missing'), null)
})

test('edit writes version +1, keeps enabled, and leaves the old version row as it was', t => {
  const { store: s, raw } = onFile(t)
  const a = created(s, { enabled: true })
  const v1 = raw.prepare('SELECT json FROM shortcut_versions WHERE shortcut_id = ? AND version = 1').get(a.id)!.json
  const r = s.updateShortcut(a.id, draft({ conditions: { logic: 'ALL', items: [{ id: 'c1', type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '50' }] }, enabled: false }), 1)
  assert.ok(r.ok)
  assert.equal(r.shortcut.version, 2)
  assert.equal(r.shortcut.enabled, true)
  assert.deepEqual(s.getShortcut(a.id), r.shortcut)
  assert.deepEqual(s.listShortcuts(), [r.shortcut])
  const rows = raw.prepare('SELECT version, json FROM shortcut_versions WHERE shortcut_id = ? ORDER BY version').all(a.id)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].json, v1)
  assert.deepEqual(JSON.parse(rows[0].json as string), a)
  assert.equal(raw.prepare('SELECT current_version FROM shortcuts WHERE id = ?').get(a.id)!.current_version, 2)

  const bad = s.updateShortcut(a.id, draft({ trigger: { mode: 'NOPE' } }), 2)
  assert.equal(bad.ok, false)
  assert.equal(s.getShortcut(a.id)!.version, 2)
})

test('a stale baseVersion is a conflict and a missing or deleted shortcut is not_found', () => {
  const s = createStore(':memory:')
  const a = created(s)
  assert.ok(s.updateShortcut(a.id, draft(), 1).ok)
  const fails = (code: StoreError['code'], fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof StoreError && e.code === code)
  fails('conflict', () => s.updateShortcut(a.id, draft(), 1))
  fails('conflict', () => s.setEnabled(a.id, true, 1))
  fails('conflict', () => s.deleteShortcut(a.id, 1))
  assert.equal(s.getShortcut(a.id)!.version, 2)
  fails('not_found', () => s.updateShortcut('sc_missing', draft(), 1))
  fails('not_found', () => s.setEnabled('sc_missing', true))
  fails('not_found', () => s.deleteShortcut('sc_missing', 1))
  s.deleteShortcut(a.id, 2)
  assert.equal(s.getShortcut(a.id), null)
  assert.deepEqual(s.listShortcuts(), [])
  fails('not_found', () => s.updateShortcut(a.id, draft(), 2))
  fails('not_found', () => s.deleteShortcut(a.id, 2))
})

test('two live shortcuts cannot share a phrase; deleting one frees it; the index refuses a direct duplicate', t => {
  const { store: s, raw } = onFile(t)
  const a = created(s, { voicePhrase: 'protect all' })
  const taken = s.createShortcut(draft({ voicePhrase: 'protect all' }))
  assert.ok(!taken.ok && taken.issues.some(i => i.code === 'phrase_taken' && i.field === 'voicePhrase'))
  assert.deepEqual(s.phrasesInUse(), ['protect all'])
  assert.deepEqual(s.phrasesInUse(a.id), [])
  const b = created(s)
  const onB = s.updateShortcut(b.id, draft({ voicePhrase: 'protect all' }), 1)
  assert.ok(!onB.ok && onB.issues.some(i => i.code === 'phrase_taken'))
  assert.ok(s.updateShortcut(a.id, draft({ voicePhrase: 'protect all' }), 1).ok, 'its own phrase is not taken')

  assert.throws(() => raw.prepare(`INSERT INTO shortcuts VALUES ('sc_x', ?, 1, 'protect all', 1, NULL)`).run(ACCOUNT), /UNIQUE/)
  s.deleteShortcut(a.id, 2)
  assert.deepEqual(s.phrasesInUse(), [])
  assert.ok(s.updateShortcut(b.id, draft({ voicePhrase: 'protect all' }), 1).ok)
})

test('enable and pause write a new version; a repeated tap changes nothing', () => {
  const s = createStore(':memory:')
  const a = created(s)
  const on = s.setEnabled(a.id, true)
  assert.deepEqual([on.version, on.enabled], [2, true])
  const off = s.setEnabled(a.id, false, 2)
  assert.deepEqual([off.version, off.enabled], [3, false])
  assert.deepEqual(s.getShortcut(a.id), off)
  assert.equal(s.setEnabled(a.id, false, 3).version, 3)
  assert.deepEqual(s.auditLog(a.id).map(x => x.event), ['created', 'enabled', 'paused'])
})

test('enabling a stored draft that no longer validates is refused', t => {
  const { store: s, raw } = onFile(t)
  const a = created(s)
  // A version written under older rules: a template value left empty.
  const stale = { ...a, version: 2, action: { type: 'CLOSE_POSITION', percent: '' } }
  raw.prepare('INSERT INTO shortcut_versions VALUES (?, 2, ?, 1)').run(a.id, JSON.stringify(stale))
  raw.prepare('UPDATE shortcuts SET current_version = 2 WHERE id = ?').run(a.id)
  assert.throws(() => s.setEnabled(a.id, true, 2), (e: unknown) => e instanceof StoreError && e.code === 'conflict' && /how much to close/.test(e.message))
  assert.deepEqual([s.getShortcut(a.id)!.version, s.getShortcut(a.id)!.enabled], [2, false])
})

test('opening drops the removed SL_MISSING condition; a rule left with no condition and no phrase is deleted', t => {
  const { path, store: s, raw } = onFile(t)
  const keep = created(s, { enabled: true }), gone = created(s, { enabled: true })
  const sl = { id: 'c2', type: 'SL_MISSING' } // as the old starter rule tpl_8 stored it
  const put = (r: typeof keep, items: unknown[]) => {
    raw.prepare('INSERT INTO shortcut_versions VALUES (?, 2, ?, 1)').run(r.id, JSON.stringify({ ...r, version: 2, conditions: { logic: 'ANY', items } }))
    raw.prepare('UPDATE shortcuts SET current_version = 2 WHERE id = ?').run(r.id)
  }
  put(keep, [...keep.conditions.items, sl])
  put(gone, [sl])
  const again = createStore(path)
  assert.deepEqual(again.listShortcuts().map(r => [r.id, r.version, r.enabled, r.conditions.items.map(c => c.type)]), [[keep.id, 3, true, ['PROFIT']]])
  assert.equal(again.getShortcut(gone.id), null)
  again.close()
})

test('seed adds the voice shortcuts once, and not again after they are deleted', () => {
  const s = createStore(':memory:')
  s.seed()
  const seeded = s.listShortcuts()
  assert.deepEqual(seeded.map(x => [x.voicePhrase, x.enabled, x.conditions.items.length]), [['protect all', true, 0], ['lock profits', true, 0]])
  s.seed()
  assert.equal(s.listShortcuts().length, 2)
  for (const x of seeded) s.deleteShortcut(x.id, x.version)
  s.seed()
  assert.deepEqual(s.listShortcuts(), [])
})

test('a later seed key adds its shortcut once, and skips a phrase already taken', () => {
  const s = createStore(':memory:')
  s.seed()
  s.seed([CLOSE_SEED], 'seeded:close')
  s.seed([CLOSE_SEED], 'seeded:close')
  assert.deepEqual(s.listShortcuts().map(x => x.voicePhrase), ['protect all', 'lock profits', 'close all'])
  const t = createStore(':memory:')
  t.seed([{ ...CLOSE_SEED, action: { type: 'MOVE_SL', target: { kind: 'ENTRY_OFFSET', percent: '0' } } }], 'mine')
  t.seed([CLOSE_SEED], 'seeded:close')
  assert.deepEqual(t.listShortcuts().map(x => x.action.type), ['MOVE_SL'])
})

test('edit, pause and delete supersede PENDING proposals and withdraw their alerts; AUTHORIZED stays', () => {
  const s = createStore(':memory:')
  const change = [
    (id: string, v: number) => { assert.ok(s.updateShortcut(id, draft(), v).ok) },
    (id: string, v: number) => { s.setEnabled(id, false, v) },
    (id: string, v: number) => s.deleteShortcut(id, v),
  ]
  for (const [i, fn] of change.entries()) {
    const sc = created(s, { enabled: true })
    const other = created(s, { enabled: true })
    s.saveAlert(alertRec(`a${i}p`, sc.id, 1))
    s.saveAlert(alertRec(`a${i}x`, sc.id, 2))
    s.saveAlert(alertRec(`a${i}o`, other.id, 3))
    s.saveProposal(proposalRec(`p${i}p`, `a${i}p`, sc.id, 'PENDING'))
    s.saveProposal(proposalRec(`p${i}x`, `a${i}x`, sc.id, 'AUTHORIZED'))
    s.saveProposal(proposalRec(`p${i}o`, `a${i}o`, other.id, 'PENDING'))
    fn(sc.id, 1)
    assert.equal(s.proposal(`p${i}p`)!.status, 'SUPERSEDED')
    assert.equal(s.alert(`a${i}p`)!.status, 'Withdrawn · shortcut changed')
    assert.equal(s.proposal(`p${i}x`)!.status, 'AUTHORIZED')
    assert.equal(s.alert(`a${i}x`)!.status, 'Waiting for confirmation')
    assert.equal(s.proposal(`p${i}o`)!.status, 'PENDING', 'another shortcut keeps its proposals')
    assert.deepEqual(s.pendingProposals().map(p => p.id), [`p${i}o`])
    assert.deepEqual(s.auditLog(`p${i}p`).map(x => x.event), ['PENDING', 'SUPERSEDED'])
    s.saveProposal({ ...s.proposal(`p${i}o`)!, status: 'DISMISSED' })
  }
})

test('one execution per proposal and per idempotency key', () => {
  const s = createStore(':memory:')
  s.saveExecution(execRec('e1', 'p1', 'k1'))
  s.saveExecution({ ...execRec('e1', 'p1', 'k1', 'FILLED'), filledQty: 0.025, message: 'Filled' })
  assert.equal(s.execution('e1')!.status, 'FILLED')
  assert.throws(() => s.saveExecution(execRec('e2', 'p1', 'k2')), /UNIQUE/)
  assert.throws(() => s.saveExecution(execRec('e3', 'p3', 'k1')), /UNIQUE/)
  assert.equal(s.execution('e2'), null)
  assert.equal(s.executionByKey('k1')!.id, 'e1')
  assert.equal(s.executionByProposal('p1')!.id, 'e1')
  assert.equal(s.executionByKey('k2'), null)
  assert.deepEqual(s.auditLog('e1').map(x => [x.event, x.detail]), [['AUTHORIZED', ''], ['FILLED', 'Filled']])
})

test('openExecutions lists the unfinished ones, oldest first', () => {
  const s = createStore(':memory:')
  const all: ExecutionStatus[] = ['UNKNOWN', 'APPLIED', 'AUTHORIZED', 'FILLED', 'VALIDATING', 'REJECTED', 'SUBMITTING', 'SIMULATED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED']
  all.forEach((st, i) => s.saveExecution(execRec(`e${i}`, `p${i}`, `k${i}`, st, 100 - i)))
  assert.deepEqual(s.openExecutions().map(e => e.status), ['PARTIALLY_FILLED', 'ACKNOWLEDGED', 'SUBMITTING', 'VALIDATING', 'AUTHORIZED', 'UNKNOWN'])
})

test('history pages newest first; alertsAfter reads oldest first; saveAlert upserts', () => {
  const s = createStore(':memory:')
  for (const at of [3, 1, 5, 2, 4]) s.saveAlert(alertRec(`a${at}`, 'sc_1', at))
  const ids = (xs: AlertRecord[]) => xs.map(a => a.id)
  assert.deepEqual(ids(s.history()), ['a5', 'a4', 'a3', 'a2', 'a1'])
  assert.deepEqual(ids(s.history(undefined, 2)), ['a5', 'a4'])
  assert.deepEqual(ids(s.history(4, 2)), ['a3', 'a2'])
  assert.deepEqual(ids(s.history(1)), [])
  assert.deepEqual(ids(s.alertsAfter(2)), ['a3', 'a4', 'a5'])
  assert.deepEqual(ids(s.alertsAfter(2, 1)), ['a3'])
  s.saveAlert({ ...alertRec('a3', 'sc_1', 3), status: 'Dismissed on Even G2' })
  assert.equal(s.history().length, 5)
  assert.equal(s.alert('a3')!.status, 'Dismissed on Even G2')
  assert.equal(s.alert('nope'), null)
})

test('outbox: due, retry with backoff, terminal failure; sent rows are not due', () => {
  let now = 1000
  const s = createStore(':memory:', () => now)
  const id = s.enqueue({ alertId: 'a1', channel: 'telegram', text: 'Close 50%' })
  const sent = s.enqueue({ alertId: 'a2', channel: 'telegram', text: 'Notify' })
  assert.deepEqual(s.dueOutbox(999), [])
  assert.deepEqual(s.dueOutbox(1000), [
    { id, alertId: 'a1', channel: 'telegram', text: 'Close 50%', attempts: 0 },
    { id: sent, alertId: 'a2', channel: 'telegram', text: 'Notify', attempts: 0 },
  ])
  s.outboxSent(sent, 1000)
  const due = (at: number) => s.dueOutbox(at).map(r => [r.id, r.attempts])
  for (const [i, sec] of [5, 10, 20, 40, 80, 160, 300].entries()) {
    s.outboxRetry(id, now, 'timeout')
    assert.deepEqual(due(now + sec * 1000 - 1), [], `attempt ${i + 1}`)
    assert.deepEqual(due(now + sec * 1000), [[id, i + 1]])
    now += sec * 1000
  }
  s.outboxRetry(id, now, 'timeout')
  assert.deepEqual(due(Number.MAX_SAFE_INTEGER), [], 'failed after 8 attempts, sent one never due')
  s.outboxRetry(id, now, 'timeout') // a failed row stays failed
  assert.deepEqual(due(Number.MAX_SAFE_INTEGER), [])
})

test('a throw rolls the whole transaction back, nested calls included', () => {
  const s = createStore(':memory:')
  assert.throws(() => s.transaction(() => {
    created(s)
    s.transaction(() => s.saveSettings({ ...DEFAULT_SETTINGS, cooldownSec: 99 }))
    throw new Error('boom')
  }), /boom/)
  assert.deepEqual(s.listShortcuts(), [])
  assert.equal(s.settings().cooldownSec, 60)
  assert.equal(s.transaction(() => { created(s); return 7 }), 7)
  assert.equal(s.listShortcuts().length, 1)
})

test('engine state: trigger state by key, epochs by position', () => {
  const s = createStore(':memory:')
  assert.equal(s.trigger('sc_1|pos:BTCUSDT:0:e1'), null)
  const st = { ...initialTriggerState(2), phase: 'fired' as const, lastAlertAt: 5, seen: ['x'] }
  s.saveTrigger('sc_1|pos:BTCUSDT:0:e1', st)
  assert.deepEqual(s.trigger('sc_1|pos:BTCUSDT:0:e1'), st)
  s.saveTrigger('sc_1|pos:BTCUSDT:0:e1', { ...st, latched: true })
  assert.equal(s.trigger('sc_1|pos:BTCUSDT:0:e1')!.latched, true)
  s.saveEpoch('BTCUSDT:0', 'e1')
  s.saveEpoch('ETHUSDT:1', 'e2')
  s.saveEpoch('BTCUSDT:0', 'e3')
  assert.deepEqual(s.epochs(), { 'BTCUSDT:0': 'e3', 'ETHUSDT:1': 'e2' })
  s.saveEpoch('BTCUSDT:0', null)
  assert.deepEqual(s.epochs(), { 'ETHUSDT:1': 'e2' })
})

test('everything survives close and reopen on a file', t => {
  const { path, store: s, raw } = onFile(t)
  assert.equal(raw.prepare('PRAGMA journal_mode').get()!.journal_mode, 'wal')
  s.seed()
  const a = created(s, { enabled: true })
  assert.ok(s.updateShortcut(a.id, draft(), 1).ok)
  s.saveTrigger('k', initialTriggerState(2))
  s.saveEpoch('BTCUSDT:0', 'e1')
  s.saveAlert(alertRec('a1', a.id, 10))
  s.saveProposal(proposalRec('p1', 'a1', a.id, 'PENDING'))
  s.saveExecution(execRec('e1', 'p0', 'k0', 'UNKNOWN'))
  s.saveSettings({ ...DEFAULT_SETTINGS, cooldownSec: 120 })
  s.saveTelegram({ chatId: 42, name: 'alex', offset: 7 })
  const ob = s.enqueue({ alertId: 'a1', channel: 'telegram', text: 'hi' })
  s.close()

  const r = createStore(path, () => 2000)
  t.after(() => r.close())
  r.seed()
  assert.deepEqual(r.listShortcuts().map(x => x.voicePhrase ?? x.version), ['protect all', 'lock profits', 2])
  assert.equal(r.trigger('k')!.version, 2)
  assert.deepEqual(r.epochs(), { 'BTCUSDT:0': 'e1' })
  assert.deepEqual(r.history().map(x => x.id), ['a1'])
  assert.deepEqual(r.pendingProposals().map(x => x.id), ['p1'])
  assert.deepEqual(r.openExecutions().map(x => x.id), ['e1'])
  assert.equal(r.settings().cooldownSec, 120)
  assert.deepEqual(r.telegram(), { chatId: 42, name: 'alex', offset: 7 })
  assert.deepEqual(r.dueOutbox(2000).map(x => x.id), [ob])
  assert.deepEqual(r.auditLog(a.id).map(x => x.event), ['created', 'edited'])
})

test('settings: defaults until saved; validateSettings bounds', () => {
  const s = createStore(':memory:')
  const d = s.settings()
  assert.deepEqual(d, DEFAULT_SETTINGS)
  d.expiry.marketSec = 11
  assert.equal(s.settings().expiry.marketSec, 30, 'callers get a copy of the defaults')
  assert.deepEqual(s.telegram(), { offset: 0 })

  assert.deepEqual(validateSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS)
  const edge = { cooldownSec: 10, expiry: { marketSec: 300, protectionSec: 10 }, notifications: { glasses: false, app: true, telegram: false } }
  assert.deepEqual(validateSettings({ ...edge, extra: 1, expiry: { ...edge.expiry, x: 2 } }), edge)
  const bad = (over: Record<string, unknown>, msg: RegExp) => assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, ...over }), msg)
  for (const v of [9, 301, 10.5, '60', null, undefined]) bad({ cooldownSec: v }, /Cooldown must be whole seconds from 10 to 300/)
  bad({ expiry: { marketSec: 5, protectionSec: 60 } }, /Market order expiry/)
  bad({ expiry: { marketSec: 30 } }, /Protection expiry/)
  bad({ notifications: { glasses: true, app: 'yes', telegram: true } }, /In-app notifications must be on or off/)
  bad({ notifications: null }, /Notifications must be an object/)
  assert.throws(() => validateSettings([]), /Settings must be an object/)
})
