/// <reference types="vite/client" />
import type { AlertRecord, Candle, Execution, ExecutionStatus, Order, Position, ServerState, Settings } from '../../server/src/types.ts'
import type { catalog, ShortcutRule, Template } from '../../server/src/registry.ts'
import type { EditableShortcut, Validation } from '../../server/src/validate.ts'
import type { Command } from '../../server/src/session.ts'
import { createStorage } from './storage.ts'
import { serverAddress } from './server-address.ts'
import { tipsShown } from './view.ts'

/** Dev uses the Vite proxy. The packer supplies the remote origin for installed builds. */
export const DEFAULT_SERVER: string = import.meta.env.VITE_TRADE_SHORTCUTS_BACKEND_ORIGIN ?? ''
const TIMEOUT_MS = 4000
const VOICE_TIMEOUT_MS = 20_000 // upload plus transcription
// Dev server only: in a build DEV is false and the bundler drops the token.
const devToken: string = import.meta.env.DEV ? import.meta.env.VITE_APP_TOKEN ?? '' : ''
// The public demo server's token, set only for the hosted phone page; a token typed in Settings wins.
const demoToken: string = import.meta.env.VITE_DEMO_TOKEN ?? ''

const store = createStorage(['gt.server', 'gt.token', 'gt.hints', 'gt.launches', 'gt.voice', 'gt.hiddenTemplates'], (() => { try { return localStorage } catch { return null } })())
/** Call once the Even bridge is up: the settings live in its storage, not in the WebView's. */
export const loadSettings = store.load

export function getSettings() {
  if (import.meta.env.MODE === 'paper') return { server: '', token: '' } // the local proxy connects to the isolated paper account
  // The dev token wins: a token saved by an earlier run outlives a new APP_TOKEN in .env and would get 401.
  return { server: store.get('gt.server') || DEFAULT_SERVER, token: devToken || store.get('gt.token') || demoToken }
}

export function saveSettings(server: string, token: string) {
  store.set('gt.server', serverAddress(server))
  store.set('gt.token', token)
}

const launches = () => Number(store.get('gt.launches')) || 0
/** Optional gesture tips on the lens: the phone switch, or on for the first launches. */
export const hintsOn = () => tipsShown(store.get('gt.hints'), launches())
export const setHints = (on: boolean) => store.set('gt.hints', on ? 'on' : 'off')
/** The mic opens for 5 s when an alert arrives, so a spoken yes or no answers it. On unless switched off on the phone. */
export const voiceAnswersOn = () => store.get('gt.voice') !== 'off'
export const setVoiceAnswers = (on: boolean) => store.set('gt.voice', on ? 'on' : 'off')
/** Template categories collapsed on Shortcuts, by name; every category is open until collapsed. The key keeps its first name, so a saved choice still applies. */
export const collapsedCategories = () => new Set(store.get('gt.hiddenTemplates').split(',').filter(Boolean))
export function setCategoryOpen(category: string, open: boolean) {
  const collapsed = collapsedCategories()
  if (open) collapsed.delete(category)
  else collapsed.add(category)
  store.set('gt.hiddenTemplates', [...collapsed].join(','))
}
/** Once per start, after the bridge's storage is read. */
export const countLaunch = () => store.set('gt.launches', String(launches() + 1))

/** A failed call: `status` is the HTTP status, `body` the server's answer (`issues` for an invalid shortcut). */
export type ApiError = Error & { status?: number; body?: { error?: string; issues?: Validation['issues'] } }

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  const { server, token } = getSettings()
  const raw = body instanceof Uint8Array
  const res = await fetch(serverAddress(server) + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
    body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, body: json })
  return json as T
}

const id = (s: string) => encodeURIComponent(s)
type Reply = { ok: boolean; message: string }

// ── lens ──────────────────────────────────────────────────
export const getState = () => request<ServerState>('GET', '/api/state')
/** The only call that trades. A resend with the same key gets the same execution back, never a second order. */
export const confirm = (proposalId: string, idempotencyKey: string) =>
  request<Reply & { executionId?: string; status?: ExecutionStatus }>('POST', `/api/proposals/${id(proposalId)}/confirm`, { idempotencyKey })
export const dismiss = (proposalId: string, by: 'glasses' | 'app' = 'glasses') => request<Reply>('POST', `/api/proposals/${id(proposalId)}/dismiss`, { by })
/** Until the lens moves to confirm/dismiss: a tap on the card's action, or on its safe choice. One key per card. */
/** Open on the lens: the size and leverage from the card's picks; the reply names the proposal Review shows. */
export const pick = (proposalId: string, size: number, leverage: number) =>
  request<Reply & { proposalId?: string }>('POST', `/api/proposals/${id(proposalId)}/pick`, { size, leverage })
export const answer = (cardId: string, yes: boolean) => (yes ? confirm(cardId, `lens:${cardId}`) : dismiss(cardId, 'glasses'))
export const getChart = (symbol: string) => request<Candle[]>('GET', `/api/chart?symbol=${encodeURIComponent(symbol)}`)
export const getExecution = (executionId: string) => request<Execution>('GET', `/api/executions/${id(executionId)}`)
/** Glasses menu: raise the seeded "protect all" (`stop`), "lock profits" (`lock`) or "close all" (`close`) shortcut; `position` keeps one. */
export const command = (kind: Command, position?: { symbol: string; positionIdx: number }) => request<Reply>('POST', '/api/command', { command: kind, position })
/** The lens's answer to its alert: `answer` is null for silence or anything that is not a plain yes or no. */
export const voice = (pcm: Uint8Array) => request<{ heard: string; answer: 'yes' | 'no' | null }>('POST', '/api/voice', pcm, VOICE_TIMEOUT_MS)

// ── phone: shortcuts, editor, history, settings ───────────
export type Catalog = ReturnType<typeof catalog>
/** A Shortcuts tile: the rule plus its derived title and its When (`summary`) and Do lines. */
export type Tile = ShortcutRule & { title: string; summary: string; doSummary: string }
/** A template with the same two lines. */
export type TemplateTile = Template & Pick<Tile, 'summary' | 'doSummary'>
export type Preview = { key: string; label: string; values: Record<string, number | null> }
export type SettingsPage = {
  settings: Settings
  bybit: { source: string; status: string; apiKey: { readOnly: boolean; trade: boolean; withdraw: boolean } | null; apiKeyError?: string; liveTrading: false }
  telegram: { configured: boolean; linked: boolean; name?: string }
}

export const getCatalog = () => request<Catalog>('GET', '/api/catalog')
export const getTemplates = () => request<TemplateTile[]>('GET', '/api/templates')
export const listShortcuts = () => request<Tile[]>('GET', '/api/shortcuts')
/** Issues for the editor, plus the targets it matches now and each condition's value on them. `id` when editing. */
export const validate = (draft: EditableShortcut & { id?: string }) => request<Validation & { targets?: Preview[] }>('POST', '/api/shortcuts/validate', draft)
export const createFromTemplate = (templateId: string) => request<Tile>('POST', '/api/shortcuts', { templateId })
export const createShortcut = (draft: EditableShortcut & { enabled?: boolean }) => request<Tile>('POST', '/api/shortcuts', draft)
/** Fails with 409 when someone saved a newer version meanwhile. */
export const updateShortcut = (shortcutId: string, draft: EditableShortcut, version: number) => request<Tile>('PUT', `/api/shortcuts/${id(shortcutId)}`, { ...draft, version })
export const deleteShortcut = (shortcutId: string, version: number) => request<null>('DELETE', `/api/shortcuts/${id(shortcutId)}?version=${version}`)
export const setEnabled = (shortcutId: string, enabled: boolean, version: number) =>
  request<Tile>('POST', `/api/shortcuts/${id(shortcutId)}/${enabled ? 'enable' : 'pause'}`, { version })
/** A simulated alert and proposal: confirming it never reaches the exchange. */
export const testShortcut = (shortcutId: string) => request<Reply & { alertId?: string; proposalId?: string }>('POST', `/api/shortcuts/${id(shortcutId)}/test`, {})
export const getPositions = () => request<(Position & { epoch: string })[]>('GET', '/api/positions')
export const getOpenOrders = () => request<Order[]>('GET', '/api/orders/open')
/** Every symbol the exchange trades, sorted. */
export const getSymbols = () => request<string[]>('GET', '/api/symbols')
/** Newest first; pass the last line's createdAt for the next page. */
export const getHistory = (before?: number) => request<AlertRecord[]>('GET', `/api/history${before ? `?before=${before}` : ''}`)
/** New alerts for the in-app banner; polling it also tells the server the app is open. */
export const getNotifications = (after: number) => request<AlertRecord[]>('GET', `/api/notifications?after=${after}`)
export const getAccountSettings = () => request<SettingsPage>('GET', '/api/settings')
export const putAccountSettings = (s: Settings) => request<Settings>('PUT', '/api/settings', s)
/** A one-time code and the bot link t.me/<bot>?start=<code>. */
export const linkTelegram = () => request<{ code: string; url: string }>('POST', '/api/settings/telegram', {})
export const unlinkTelegram = () => request<null>('DELETE', '/api/settings/telegram')
