/**
 * Durable state of the shortcuts server on built-in node:sqlite (docs/shortcuts-architecture.md §4, §9, §10).
 * Records sit as JSON in a `json` column; the other columns exist for lookups, uniqueness and ordering.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { VOICE_SEEDS, type ShortcutRule } from './registry.ts'
import { validateShortcut, type Issue } from './validate.ts'
import type { TriggerState } from './engine.ts'
import {
  DEFAULT_SETTINGS,
  type AlertRecord, type Channel, type Execution, type ExecutionStatus, type OutboxRow, type Proposal, type Settings, type TelegramLink,
} from './types.ts'

/** One process, one token, one account. The account_id columns stay so the tables move to PostgreSQL as they are. */
export const ACCOUNT = 'main'

export type SaveResult = { ok: true; shortcut: ShortcutRule } | { ok: false; issues: Issue[] }

/** http maps not_found to 404 and conflict to 409. */
export class StoreError extends Error {
  code: 'not_found' | 'conflict'
  constructor(code: 'not_found' | 'conflict', message: string) {
    super(message)
    this.code = code
  }
}

/** Trust boundary for PUT /settings: every field is required, so a partial body cannot reset the others to defaults. */
export function validateSettings(input: unknown): Settings {
  const o = (v: unknown, what: string) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    throw new Error(`${what} must be an object`)
  }
  const sec = (v: unknown, what: string) => {
    if (Number.isInteger(v) && (v as number) >= 10 && (v as number) <= 300) return v as number
    throw new Error(`${what} must be whole seconds from 10 to 300`)
  }
  const flag = (v: unknown, what: string) => {
    if (typeof v === 'boolean') return v
    throw new Error(`${what} must be on or off`)
  }
  const s = o(input, 'Settings')
  const e = o(s.expiry, 'Expiry')
  const n = o(s.notifications, 'Notifications')
  return {
    cooldownSec: sec(s.cooldownSec, 'Cooldown'),
    expiry: { marketSec: sec(e.marketSec, 'Market order expiry'), protectionSec: sec(e.protectionSec, 'Protection expiry') },
    notifications: { glasses: flag(n.glasses, 'Alerts on glasses'), app: flag(n.app, 'In-app notifications'), telegram: flag(n.telegram, 'Telegram') },
  }
}

export interface Store {
  close(): void
  /** BEGIN IMMEDIATE / COMMIT / ROLLBACK; a nested call just runs fn inside the outer one. */
  transaction<T>(fn: () => T): T
  /** Current version of each live shortcut, oldest first. */
  listShortcuts(): ShortcutRule[]
  /** Current version; null when missing or deleted. */
  getShortcut(id: string): ShortcutRule | null
  createShortcut(input: unknown): SaveResult
  /** Throws StoreError not_found, or conflict when baseVersion is not the current one. Keeps enabled. */
  updateShortcut(id: string, input: unknown, baseVersion: number): SaveResult
  /** A new version too, so pausing invalidates proposals. Enabling validates the stored draft again (conflict when it fails). */
  setEnabled(id: string, enabled: boolean, baseVersion?: number): ShortcutRule
  /** Soft delete: versions stay for History, the phrase is free again. */
  deleteShortcut(id: string, baseVersion: number): void
  phrasesInUse(exceptId?: string): string[]
  /** First start only: VOICE_SEEDS as enabled shortcuts; never again, even after the user deletes them. */
  seed(): void
  trigger(key: string): TriggerState | null
  saveTrigger(key: string, s: TriggerState): void
  /** Position key 'BTCUSDT:0' → epoch. */
  epochs(): Record<string, string>
  /** null deletes. */
  saveEpoch(positionKey: string, epoch: string | null): void
  saveAlert(a: AlertRecord): void
  alert(id: string): AlertRecord | null
  /** Newest first, createdAt < before; default limit 50. */
  history(before?: number, limit?: number): AlertRecord[]
  /** createdAt > after, oldest first. */
  alertsAfter(after: number, limit?: number): AlertRecord[]
  saveProposal(p: Proposal): void
  proposal(id: string): Proposal | null
  /** Status PENDING, oldest first. */
  pendingProposals(): Proposal[]
  /** Upsert by id; a different execution with the same proposalId or idempotencyKey throws. */
  saveExecution(e: Execution): void
  execution(id: string): Execution | null
  executionByKey(idempotencyKey: string): Execution | null
  executionByProposal(proposalId: string): Execution | null
  /** Not final yet: AUTHORIZED, VALIDATING, SUBMITTING, ACKNOWLEDGED, PARTIALLY_FILLED, UNKNOWN. */
  openExecutions(): Execution[]
  /** DEFAULT_SETTINGS until saved. */
  settings(): Settings
  saveSettings(s: Settings): void
  /** { offset: 0 } until saved. */
  telegram(): TelegramLink
  saveTelegram(t: TelegramLink): void
  /** Write it in the same transaction as the alert; delivery is at-least-once. Returns the row id. */
  enqueue(o: { alertId: string; channel: Channel; text: string }): string
  /** Not sent, not failed, next attempt due. */
  dueOutbox(now: number): OutboxRow[]
  outboxSent(id: string, now: number): void
  /** Backoff 5 s · 2^attempts up to 5 min; terminal failure after 8 attempts. */
  outboxRetry(id: string, now: number, error: string): void
  audit(entity: string, entityId: string, event: string, detail?: string): void
  auditLog(entityId: string): { at: number; entity: string; event: string; detail: string }[]
}

const OPEN: ExecutionStatus[] = ['AUTHORIZED', 'VALIDATING', 'SUBMITTING', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'UNKNOWN']
const MAX_ATTEMPTS = 8

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exchange_accounts (id TEXT PRIMARY KEY, environment TEXT NOT NULL, capabilities TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shortcuts (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, current_version INTEGER NOT NULL, voice_phrase TEXT,
  created_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS shortcuts_phrase ON shortcuts (account_id, voice_phrase) WHERE deleted_at IS NULL AND voice_phrase IS NOT NULL;
CREATE TABLE IF NOT EXISTS shortcut_versions (
  shortcut_id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (shortcut_id, version));
CREATE TABLE IF NOT EXISTS target_state (account_id TEXT NOT NULL, key TEXT NOT NULL, epoch TEXT NOT NULL, PRIMARY KEY (account_id, key));
CREATE TABLE IF NOT EXISTS trigger_state (account_id TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (account_id, key));
CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, shortcut_id TEXT NOT NULL, created_at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS alerts_created ON alerts (account_id, created_at);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, shortcut_id TEXT NOT NULL, alert_id TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS proposals_status ON proposals (account_id, status, shortcut_id);
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, proposal_id TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL, created_at INTEGER NOT NULL, json TEXT NOT NULL,
  UNIQUE (account_id, idempotency_key));
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, alert_id TEXT NOT NULL, channel TEXT NOT NULL, text TEXT NOT NULL,
  attempts INTEGER NOT NULL, next_at INTEGER NOT NULL, sent_at INTEGER, failed_at INTEGER, error TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (account_id, next_at) WHERE sent_at IS NULL AND failed_at IS NULL;
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, at INTEGER NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_log (entity_id);
CREATE TABLE IF NOT EXISTS settings (account_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS telegram (account_id TEXT PRIMARY KEY, json TEXT NOT NULL);
`

/** `':memory:'` in tests; a file path gets its directory created and WAL. */
export function createStore(path: string, clock: () => number = Date.now): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec(SCHEMA)
  // shortcut: environment and capabilities stay empty until the Settings screen needs them stored
  db.prepare(`INSERT OR IGNORE INTO exchange_accounts VALUES (?, '', '{}')`).run(ACCOUNT)

  const run = (sql: string, ...p: SQLInputValue[]) => { db.prepare(sql).run(...p) }
  const get = (sql: string, ...p: SQLInputValue[]) => db.prepare(sql).get(...p)
  const all = (sql: string, ...p: SQLInputValue[]) => db.prepare(sql).all(...p)
  const one = <T>(sql: string, ...p: SQLInputValue[]): T | null => {
    const row = get(sql, ...p)
    return row ? (JSON.parse(row.json as string) as T) : null
  }
  const many = <T>(sql: string, ...p: SQLInputValue[]): T[] => all(sql, ...p).map(r => JSON.parse(r.json as string) as T)
  const id = (prefix: string) => prefix + randomBytes(8).toString('hex')

  const CURRENT = `SELECT v.json FROM shortcuts s JOIN shortcut_versions v ON v.shortcut_id = s.id AND v.version = s.current_version
    WHERE s.account_id = ? AND s.deleted_at IS NULL`

  /** The live shortcut at baseVersion, or StoreError. */
  const current = (scId: string, baseVersion?: number) => {
    const cur = store.getShortcut(scId)
    if (!cur) throw new StoreError('not_found', 'No such shortcut')
    if (baseVersion !== undefined && baseVersion !== cur.version) throw new StoreError('conflict', 'This shortcut was changed elsewhere: reload it')
    return cur
  }

  /** Writes an immutable version, moves the pointer, and withdraws the proposals of the old one. */
  const writeVersion = (rule: ShortcutRule, event: string) => {
    run('INSERT INTO shortcut_versions VALUES (?, ?, ?, ?)', rule.id, rule.version, JSON.stringify(rule), clock())
    run('UPDATE shortcuts SET current_version = ?, voice_phrase = ? WHERE id = ?', rule.version, rule.voicePhrase ?? null, rule.id)
    store.audit('shortcut', rule.id, event, `version ${rule.version}`)
    if (rule.version > 1) supersede(rule.id)
  }

  /** §4: edit, pause or delete withdraws PENDING proposals; an AUTHORIZED one is already executing and stays. */
  const supersede = (scId: string) => {
    for (const p of many<Proposal>('SELECT json FROM proposals WHERE account_id = ? AND status = ? AND shortcut_id = ?', ACCOUNT, 'PENDING', scId)) {
      store.saveProposal({ ...p, status: 'SUPERSEDED' })
      const a = store.alert(p.alertId)
      if (a) store.saveAlert({ ...a, status: 'Withdrawn · shortcut changed' })
    }
  }

  const store: Store = {
    close: () => { if (db.isOpen) db.close() },

    transaction(fn) {
      if (db.isTransaction) return fn()
      db.exec('BEGIN IMMEDIATE')
      try {
        const r = fn()
        db.exec('COMMIT')
        return r
      } catch (e) {
        if (db.isTransaction) db.exec('ROLLBACK')
        throw e
      }
    },

    listShortcuts: () => many<ShortcutRule>(`${CURRENT} ORDER BY s.created_at, s.rowid`, ACCOUNT),
    getShortcut: scId => one<ShortcutRule>(`${CURRENT} AND s.id = ?`, ACCOUNT, scId),

    createShortcut: input => store.transaction(() => {
      const v = validateShortcut(input, { phrasesInUse: store.phrasesInUse() })
      if (!v.ok || !v.value) return { ok: false, issues: v.issues }
      const rule: ShortcutRule = {
        schemaVersion: 1, id: id('sc_'), accountId: ACCOUNT, version: 1,
        enabled: (input as Record<string, unknown>).enabled === true, ...v.value,
      }
      run('INSERT INTO shortcuts VALUES (?, ?, 0, NULL, ?, NULL)', rule.id, ACCOUNT, clock())
      writeVersion(rule, 'created')
      return { ok: true, shortcut: rule }
    }),

    updateShortcut: (scId, input, baseVersion) => store.transaction(() => {
      const cur = current(scId, baseVersion)
      const v = validateShortcut(input, { phrasesInUse: store.phrasesInUse(scId) })
      if (!v.ok || !v.value) return { ok: false, issues: v.issues }
      const rule: ShortcutRule = { schemaVersion: 1, id: scId, accountId: ACCOUNT, version: cur.version + 1, enabled: cur.enabled, ...v.value }
      writeVersion(rule, 'edited')
      return { ok: true, shortcut: rule }
    }),

    setEnabled: (scId, enabled, baseVersion) => store.transaction(() => {
      const cur = current(scId, baseVersion)
      if (cur.enabled === enabled) return cur // a repeated tap must not withdraw live proposals
      if (enabled) {
        const v = validateShortcut(cur, { phrasesInUse: store.phrasesInUse(scId) })
        if (!v.ok) throw new StoreError('conflict', v.issues.map(i => i.message).join('. '))
      }
      const rule = { ...cur, version: cur.version + 1, enabled }
      writeVersion(rule, enabled ? 'enabled' : 'paused')
      return rule
    }),

    deleteShortcut: (scId, baseVersion) => store.transaction(() => {
      const cur = current(scId, baseVersion)
      run('UPDATE shortcuts SET deleted_at = ? WHERE id = ?', clock(), scId)
      store.audit('shortcut', scId, 'deleted', `version ${cur.version}`)
      supersede(scId)
    }),

    phrasesInUse: exceptId => all(
      'SELECT voice_phrase FROM shortcuts WHERE account_id = ? AND deleted_at IS NULL AND voice_phrase IS NOT NULL AND id IS NOT ?',
      ACCOUNT, exceptId ?? null,
    ).map(r => r.voice_phrase as string),

    seed: () => store.transaction(() => {
      if (get(`SELECT 1 FROM meta WHERE key = 'seeded'`)) return
      for (const draft of VOICE_SEEDS) {
        const r = store.createShortcut({ ...draft, enabled: true })
        if (!r.ok) throw new Error(`Voice seed "${draft.voicePhrase}" is invalid: ${r.issues.map(i => i.message).join('. ')}`)
      }
      run(`INSERT INTO meta VALUES ('seeded', ?)`, String(clock()))
    }),

    trigger: key => one<TriggerState>('SELECT json FROM trigger_state WHERE account_id = ? AND key = ?', ACCOUNT, key),
    saveTrigger: (key, s) => run('INSERT OR REPLACE INTO trigger_state VALUES (?, ?, ?)', ACCOUNT, key, JSON.stringify(s)),

    epochs: () => Object.fromEntries(all('SELECT key, epoch FROM target_state WHERE account_id = ?', ACCOUNT).map(r => [r.key as string, r.epoch as string])),
    saveEpoch: (key, epoch) => epoch === null
      ? run('DELETE FROM target_state WHERE account_id = ? AND key = ?', ACCOUNT, key)
      : run('INSERT OR REPLACE INTO target_state VALUES (?, ?, ?)', ACCOUNT, key, epoch),

    saveAlert: a => run(
      `INSERT INTO alerts VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json, created_at = excluded.created_at`,
      a.id, ACCOUNT, a.shortcutId, a.createdAt, JSON.stringify(a),
    ),
    alert: aId => one<AlertRecord>('SELECT json FROM alerts WHERE account_id = ? AND id = ?', ACCOUNT, aId),
    // shortcut: paging by createdAt alone skips alerts that share the boundary millisecond, page by (createdAt, id) if one tick ever writes more than a page
    history: (before = Number.MAX_SAFE_INTEGER, limit = 50) => many<AlertRecord>(
      'SELECT json FROM alerts WHERE account_id = ? AND created_at < ? ORDER BY created_at DESC, rowid DESC LIMIT ?', ACCOUNT, before, limit),
    alertsAfter: (after, limit = 50) => many<AlertRecord>(
      'SELECT json FROM alerts WHERE account_id = ? AND created_at > ? ORDER BY created_at, rowid LIMIT ?', ACCOUNT, after, limit),

    saveProposal: p => store.transaction(() => {
      const prev = get('SELECT status FROM proposals WHERE id = ?', p.id)
      run(
        `INSERT INTO proposals VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET status = excluded.status, json = excluded.json`,
        p.id, ACCOUNT, p.shortcutId, p.alertId, p.status, p.createdAt, JSON.stringify(p),
      )
      if (prev?.status !== p.status) store.audit('proposal', p.id, p.status)
    }),
    proposal: pId => one<Proposal>('SELECT json FROM proposals WHERE account_id = ? AND id = ?', ACCOUNT, pId),
    pendingProposals: () => many<Proposal>(`SELECT json FROM proposals WHERE account_id = ? AND status = 'PENDING' ORDER BY created_at, rowid`, ACCOUNT),

    saveExecution: e => store.transaction(() => {
      const prev = get('SELECT status FROM executions WHERE id = ?', e.id)
      // Only the id conflict is an update; the UNIQUE proposal_id and idempotency_key make a second execution throw.
      run(
        `INSERT INTO executions VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET
          proposal_id = excluded.proposal_id, idempotency_key = excluded.idempotency_key, status = excluded.status, json = excluded.json`,
        e.id, ACCOUNT, e.proposalId, e.idempotencyKey, e.status, e.createdAt, JSON.stringify(e),
      )
      if (prev?.status !== e.status) store.audit('execution', e.id, e.status, e.message)
    }),
    execution: eId => one<Execution>('SELECT json FROM executions WHERE account_id = ? AND id = ?', ACCOUNT, eId),
    executionByKey: key => one<Execution>('SELECT json FROM executions WHERE account_id = ? AND idempotency_key = ?', ACCOUNT, key),
    executionByProposal: pId => one<Execution>('SELECT json FROM executions WHERE account_id = ? AND proposal_id = ?', ACCOUNT, pId),
    openExecutions: () => many<Execution>(
      `SELECT json FROM executions WHERE account_id = ? AND status IN (${OPEN.map(() => '?').join(', ')}) ORDER BY created_at, rowid`, ACCOUNT, ...OPEN),

    settings: () => one<Settings>('SELECT json FROM settings WHERE account_id = ?', ACCOUNT) ?? structuredClone(DEFAULT_SETTINGS),
    saveSettings: s => run('INSERT OR REPLACE INTO settings VALUES (?, ?)', ACCOUNT, JSON.stringify(s)),
    telegram: () => one<TelegramLink>('SELECT json FROM telegram WHERE account_id = ?', ACCOUNT) ?? { offset: 0 },
    saveTelegram: t => run('INSERT OR REPLACE INTO telegram VALUES (?, ?)', ACCOUNT, JSON.stringify(t)),

    enqueue: o => {
      const oId = id('ob_')
      const now = clock()
      run('INSERT INTO outbox VALUES (?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, ?)', oId, ACCOUNT, o.alertId, o.channel, o.text, now, now)
      return oId
    },
    dueOutbox: now => all(
      `SELECT id, alert_id, channel, text, attempts FROM outbox
        WHERE account_id = ? AND sent_at IS NULL AND failed_at IS NULL AND next_at <= ? ORDER BY next_at, rowid`, ACCOUNT, now,
    ).map(r => ({ id: r.id as string, alertId: r.alert_id as string, channel: r.channel as Channel, text: r.text as string, attempts: r.attempts as number })),
    outboxSent: (oId, now) => run('UPDATE outbox SET sent_at = ? WHERE account_id = ? AND id = ?', now, ACCOUNT, oId),
    outboxRetry: (oId, now, error) => {
      const row = get('SELECT attempts FROM outbox WHERE account_id = ? AND id = ? AND sent_at IS NULL AND failed_at IS NULL', ACCOUNT, oId)
      if (!row) return
      const attempts = (row.attempts as number) + 1
      run('UPDATE outbox SET attempts = ?, error = ?, next_at = ?, failed_at = ? WHERE id = ?',
        attempts, error, now + Math.min(5000 * 2 ** (attempts - 1), 300_000), attempts >= MAX_ATTEMPTS ? now : null, oId)
    },

    audit: (entity, entityId, event, detail = '') =>
      run('INSERT INTO audit_log (account_id, at, entity, entity_id, event, detail) VALUES (?, ?, ?, ?, ?, ?)', ACCOUNT, clock(), entity, entityId, event, detail),
    auditLog: entityId => all('SELECT at, entity, event, detail FROM audit_log WHERE account_id = ? AND entity_id = ? ORDER BY id', ACCOUNT, entityId)
      .map(r => ({ at: r.at as number, entity: r.entity as string, event: r.event as string, detail: r.detail as string })),
  }
  return store
}
