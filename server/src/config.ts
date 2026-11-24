import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Config, PriceAlert, Shortcut } from './types.ts'
import { DEFAULT_CONFIG, normalizePhrase } from './rules.ts'

const NUMBERS = ['dailyLossLimitUsd', 'maxActionUsd', 'liqWarnPct', 'marginTopUpUsd', 'stopLossPct', 'lockProfitPct', 'noStopGraceSec'] as const
const MAX_ALERTS = 20
const MAX_SHORTCUTS = 20
const COMMANDS = ['stop', 'lock', 'buy', 'sell']

const positive = (v: unknown, field: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`${field} must be a positive number`)
  return v
}

function alert(v: unknown, i: number): PriceAlert {
  const a = (v ?? {}) as Record<string, unknown>
  const at = `alerts[${i}]`
  if (typeof a.id !== 'string' || !a.id || a.id.length > 64) throw new Error(`${at}.id is required`)
  if (typeof a.symbol !== 'string' || !/^[A-Z0-9]{2,20}$/.test(a.symbol)) throw new Error(`${at}.symbol must look like BTCUSDT`)
  if (a.when !== 'above' && a.when !== 'below') throw new Error(`${at}.when must be above or below`)
  const out: PriceAlert = { id: a.id, symbol: a.symbol, when: a.when, price: positive(a.price, `${at}.price`) }
  if (a.orderUsd !== undefined) out.orderUsd = positive(a.orderUsd, `${at}.orderUsd`)
  if (a.side !== undefined) {
    if (a.side !== 'Buy' && a.side !== 'Sell') throw new Error(`${at}.side must be Buy or Sell`)
    out.side = a.side
  }
  return out
}

function shortcut(v: unknown, i: number): Shortcut {
  const s = (v ?? {}) as Record<string, unknown>
  const at = `shortcuts[${i}]`
  if (typeof s.phrase !== 'string' || !s.phrase || s.phrase.length > 40 || s.phrase !== normalizePhrase(s.phrase)) {
    throw new Error(`${at}.phrase must be up to 40 lowercase letters, digits and spaces`)
  }
  if (typeof s.command !== 'string' || !COMMANDS.includes(s.command)) throw new Error(`${at}.command must be stop, lock, buy or sell`)
  if (typeof s.symbol !== 'string' || !/^[A-Z0-9]{2,20}$/.test(s.symbol)) throw new Error(`${at}.symbol must look like BTCUSDT or ALL`)
  const out: Shortcut = { phrase: s.phrase, command: s.command as Shortcut['command'], symbol: s.symbol }
  if (out.command === 'buy' || out.command === 'sell') {
    if (out.symbol === 'ALL') throw new Error(`${at}: buy and sell need one symbol`)
    out.usd = positive(s.usd, `${at}.usd`)
  }
  return out
}

/** Trust boundary: the phone page sends this. Returns a clean copy with known fields only. */
export function validateConfig(input: unknown): Config {
  if (!input || typeof input !== 'object') throw new Error('config must be an object')
  const c = input as Record<string, unknown>
  const alerts = c.alerts ?? []
  if (!Array.isArray(alerts) || alerts.length > MAX_ALERTS) throw new Error(`alerts must be a list of up to ${MAX_ALERTS}`)
  const shortcuts = c.shortcuts ?? []
  if (!Array.isArray(shortcuts) || shortcuts.length > MAX_SHORTCUTS) throw new Error(`shortcuts must be a list of up to ${MAX_SHORTCUTS}`)
  const out = { alerts: alerts.map(alert), shortcuts: shortcuts.map(shortcut) } as Config
  for (const field of NUMBERS) out[field] = positive(c[field], field)
  if (out.stopLossPct >= 100) throw new Error('stopLossPct must be below 100') // 100% puts the stop at 0, which cancels it
  if (out.liqWarnPct > 100) throw new Error('liqWarnPct must be 100 or less')
  return out
}

/** The API token guards trading. Long on loopback too: CORS is open, so any web page can try tokens against localhost. */
export function tokenProblem(token: string): string | null {
  if (!token) return 'Set APP_TOKEN in .env (see .env.example).'
  if (token.length < 16) return 'APP_TOKEN must be at least 16 characters: openssl rand -hex 16'
  return null
}

export function loadConfig(path: string): Config {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(DEFAULT_CONFIG)
    throw e
  }
  return validateConfig({ ...DEFAULT_CONFIG, ...JSON.parse(raw) })
}

export function saveConfig(path: string, c: Config): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(c, null, 2))
}
