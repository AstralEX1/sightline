import { createHmac, randomUUID } from 'node:crypto'
import type { Exchange, Fill, Position, Side } from './types.ts'
import { coin } from './format.ts'

const RECV_WINDOW = '5000'
const TIMEOUT_MS = 8000
const MARGIN_MODE_TTL_MS = 60_000
const TESTNET_HOSTS = ['api-testnet.bybit.com', 'api-demo.bybit.com']

export function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/** Money safety: testnet only, so a mainnet host stops the server. */
export function assertTestnet(base: string): void {
  const host = new URL(base).hostname
  if (!TESTNET_HOSTS.includes(host)) throw new Error(`Refusing non-testnet Bybit host ${host}`)
}

/** Steps stay strings as the API sends them: String(1e-7) would be "1e-7" and lose the decimals. */
type Instrument = { tickSize: string; qtyStep: string; minOrderQty: number }
type Row = Record<string, string | number>

// Bybit's own server errors leave the result unknown; every other non-zero code is a clear "no".
const UNKNOWN_CODES = [10000, 10016]
/** Codes seen on testnet (110007, 110076, 131212) or documented for the key and rate checks. */
const FRIENDLY: Record<number, string> = {
  110004: 'Not enough balance', 110007: 'Not enough balance', 110012: 'Not enough balance',
  131212: 'Not enough in Funding',
  110076: 'Add margin works on isolated margin only',
  10003: 'API key is invalid', 10005: 'API key lacks this permission', 10010: 'This IP is not allowed for the API key',
  10006: 'Too many requests, try again shortly',
}
/** The exchange said no, so nothing was written and the action is safe to offer again. */
const rejected = (message: string) => Object.assign(new Error(message), { name: 'ExchangeRejected' })

// Bybit runs nothing on a rate limit (HTTP 403 "access too frequent", 429, or retCode 10006), so a resend is safe for writes too.
// The waits stay short: a card tap must still answer within the app's 4 s request timeout.
// shortcut: fixed waits, not X-Bapi-Limit-Reset-Timestamp; read that header if the limit keeps hitting
const RATE_LIMIT_WAITS_MS = [250, 750]
const RATE_LIMITED_HTTP = [403, 429]
const RATE_LIMITED_CODE = 10006

const num = (v: unknown) => Number(v) || 0
/** Rounds to a step and prints without float noise: 0.003, 60760 */
const toStep = (v: number, step: string, round: (x: number) => number) => {
  const decimals = (step.split('.')[1] ?? '').length
  const steps = round(Number((v / Number(step)).toFixed(9))) // toFixed(9) drops noise like 2.9999999999999996
  const out = (steps * Number(step)).toFixed(decimals)
  return decimals ? out.replace(/0+$/, '').replace(/\.$/, '') : out
}

export function createBybit(o: {
  key: string; secret: string; base: string
  fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>
}): Exchange {
  const doFetch = o.fetch ?? fetch
  const now = o.now ?? Date.now
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const instruments = new Map<string, Instrument>()
  let marginMode: { value: string; at: number } | null = null

  async function call<T>(method: 'GET' | 'POST', path: string, params: Record<string, string | number>): Promise<T> {
    const query = method === 'GET' ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : ''
    // Built once: a resend carries the same orderLinkId or transferId, so Bybit cannot run it twice.
    const body = method === 'POST' ? JSON.stringify(params) : undefined
    for (let attempt = 0; ; attempt++) {
      const ts = String(now())
      const res = await doFetch(`${o.base}${path}${query ? `?${query}` : ''}`, {
        method,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'X-BAPI-API-KEY': o.key,
          'X-BAPI-TIMESTAMP': ts,
          'X-BAPI-RECV-WINDOW': RECV_WINDOW,
          'X-BAPI-SIGN': sign(o.secret, ts + o.key + RECV_WINDOW + (body ?? query)),
        },
      })
      const json = res.ok ? ((await res.json()) as { retCode: number; retMsg: string; result: T }) : null
      const limited = RATE_LIMITED_HTTP.includes(res.status) || json?.retCode === RATE_LIMITED_CODE
      if (limited && attempt < RATE_LIMIT_WAITS_MS.length) {
        await sleep(RATE_LIMIT_WAITS_MS[attempt])
        continue
      }
      if (!json) {
        const message = `Bybit HTTP ${res.status}`
        throw RATE_LIMITED_HTTP.includes(res.status) ? rejected(message) : new Error(message)
      }
      if (json.retCode !== 0) {
        // The lens fits ~88 characters: a known code reads as a sentence, with the Bybit code last so a cut drops it first.
        const friendly = FRIENDLY[json.retCode]
        const message = friendly ? `${friendly} (Bybit ${json.retCode})` : `Bybit ${json.retCode}: ${json.retMsg}`
        throw UNKNOWN_CODES.includes(json.retCode) ? new Error(message) : rejected(message)
      }
      return json.result
    }
  }

  const list = async (path: string, params: Record<string, string | number>) =>
    (await call<{ list: Row[] }>('GET', path, { category: 'linear', ...params })).list

  async function instrument(symbol: string): Promise<Instrument> {
    const cached = instruments.get(symbol)
    if (cached) return cached
    const [row] = (await list('/v5/market/instruments-info', { symbol })) as unknown as {
      priceFilter: { tickSize: string }; lotSizeFilter: { qtyStep: string; minOrderQty: string }
    }[]
    if (!row) throw rejected(`Unknown symbol ${symbol}`)
    const info = { tickSize: row.priceFilter.tickSize, qtyStep: row.lotSizeFilter.qtyStep, minOrderQty: num(row.lotSizeFilter.minOrderQty) }
    instruments.set(symbol, info)
    return info
  }

  async function lastPrice(symbol: string) {
    const [row] = await list('/v5/market/tickers', { symbol })
    if (!row) throw rejected(`Unknown symbol ${symbol}`)
    return num(row.lastPrice)
  }

  return {
    async balance() {
      const [a] = (await call<{ list: Row[] }>('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' })).list
      return { equity: num(a?.totalEquity), available: num(a?.totalAvailableBalance) }
    },

    async positions(): Promise<Position[]> {
      const rows = await list('/v5/position/list', { settleCoin: 'USDT', limit: 200 })
      // Unified accounts set isolated margin account-wide; tradeMode stays 0 there.
      if (!marginMode || now() - marginMode.at > MARGIN_MODE_TTL_MS) {
        const info = await call<{ marginMode?: string }>('GET', '/v5/account/info', {})
        marginMode = { value: info.marginMode ?? '', at: now() }
      }
      const accountIsolated = marginMode.value === 'ISOLATED_MARGIN'
      return rows.filter(r => num(r.size) > 0).map(r => ({
        symbol: String(r.symbol),
        side: r.side as Side,
        size: num(r.size),
        entryPrice: num(r.avgPrice),
        markPrice: num(r.markPrice),
        liqPrice: num(r.liqPrice),
        unrealisedPnl: num(r.unrealisedPnl),
        stopLoss: num(r.stopLoss),
        isolated: accountIsolated || Number(r.tradeMode) === 1,
        positionIdx: Number(r.positionIdx),
        // Not createdTime: that belongs to the position slot and stays from the symbol's first ever trade (seen live: 16 min stale
        // on a position opened 2 s ago). updatedTime moves on every open, add and stop change, so the no-stop grace counts from it.
        openedAt: num(r.updatedTime),
      }))
    },

    async closedPnlSince(ms) {
      // shortcut: first page only (100 trades per day), page with the cursor if a trader closes more
      const rows = await list('/v5/position/closed-pnl', { startTime: ms, limit: 100 })
      return rows.reduce((sum, r) => sum + num(r.closedPnl), 0)
    },

    async fillsSince(ms): Promise<Fill[]> {
      const rows = await list('/v5/execution/list', { startTime: ms })
      // Funding payments are listed too; liquidation (BustTrade) and ADL fills stay, the trader must see those.
      return rows.filter(r => r.execType !== 'Funding').map(r => ({ id: String(r.execId), symbol: String(r.symbol), side: r.side as Side, qty: num(r.execQty), price: num(r.execPrice), time: num(r.execTime) }))
    },

    lastPrice,

    async setStop(symbol, positionIdx, price) {
      const { tickSize } = await instrument(symbol)
      const stopLoss = toStep(price, tickSize, Math.round)
      if (!(Number(stopLoss) > 0)) throw rejected('Bad stop price') // "0" would cancel the stop
      await call('POST', '/v5/position/trading-stop', { category: 'linear', symbol, stopLoss, tpslMode: 'Full', positionIdx })
    },

    async addMargin(symbol, positionIdx, usd) {
      await call('POST', '/v5/position/add-margin', { category: 'linear', symbol, margin: String(usd), positionIdx })
    },

    async transferToTrading(usd) {
      await call('POST', '/v5/asset/transfer/inter-transfer', { transferId: randomUUID(), coin: 'USDT', amount: String(usd), fromAccountType: 'FUND', toAccountType: 'UNIFIED' })
    },

    async marketOrder(symbol, side, usd) {
      const [{ qtyStep, minOrderQty }, px] = await Promise.all([instrument(symbol), lastPrice(symbol)])
      const qty = toStep(usd / px, qtyStep, Math.floor)
      if (Number(qty) < minOrderQty) throw rejected(`Amount too small: min ${minOrderQty} ${coin(symbol)} is about $${Math.ceil(minOrderQty * px)}`)
      // orderLinkId: a resend after a rate limit is refused as a duplicate (110072) instead of opening a second order.
      await call('POST', '/v5/order/create', { category: 'linear', symbol, side, orderType: 'Market', qty, orderLinkId: randomUUID() })
    },
  }
}
