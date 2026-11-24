/// <reference types="vite/client" />
import type { Config, ServerState } from '../../server/src/types.ts'
import { createStorage } from './storage.ts'

/** Empty = this page's own origin: the Vite dev server forwards /api to the trading server. */
export const DEFAULT_SERVER = ''
const TIMEOUT_MS = 4000
const VOICE_TIMEOUT_MS = 20_000 // upload plus transcription
// Dev server only: in a build DEV is false and the bundler drops the token.
const devToken: string = import.meta.env.DEV ? import.meta.env.VITE_APP_TOKEN ?? '' : ''

const store = createStorage(['gt.server', 'gt.token'], (() => { try { return localStorage } catch { return null } })())
/** Call once the Even bridge is up: the settings live in its storage, not in the WebView's. */
export const loadSettings = store.load

export function getSettings() {
  return { server: store.get('gt.server') || DEFAULT_SERVER, token: store.get('gt.token') || devToken }
}

export function saveSettings(server: string, token: string) {
  store.set('gt.server', server.replace(/\/+$/, ''))
  store.set('gt.token', token)
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  const { server, token } = getSettings()
  const raw = body instanceof Uint8Array
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
    body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status })
  return json as T
}

export const getState = () => request<ServerState>('GET', '/api/state')
export const answer = (cardId: string, yes: boolean) => request<{ ok: boolean; message: string }>('POST', '/api/answer', { cardId, yes })
export const getConfig = () => request<Config>('GET', '/api/config')
export const putConfig = (c: Config) => request<Config>('PUT', '/api/config', c)
/** Glasses menu: queue stop cards for every position (`stop`) or entry stops for those in profit (`lock`). */
export const command = (kind: 'stop' | 'lock') => request<{ ok: boolean; message: string }>('POST', '/api/command', { command: kind })
export const voice = (pcm: Uint8Array) =>
  request<{ heard: string; ok: boolean; message: string }>('POST', '/api/voice', pcm, VOICE_TIMEOUT_MS)
