export type Side = 'Buy' | 'Sell'

export interface Position {
  symbol: string
  side: Side
  size: number
  entryPrice: number
  markPrice: number
  /** 0 = no liquidation price */
  liqPrice: number
  unrealisedPnl: number
  /** 0 = no stop */
  stopLoss: number
  isolated: boolean
  positionIdx: number
  openedAt: number
}

export interface Fill {
  id: string
  symbol: string
  side: Side
  qty: number
  price: number
  time: number
}

export interface PriceAlert {
  id: string
  symbol: string
  when: 'above' | 'below'
  price: number
  orderUsd?: number
  side?: Side
}

export interface Shortcut {
  /** Lowercase words, compared after normalizePhrase */
  phrase: string
  command: 'stop' | 'lock' | 'buy' | 'sell'
  /** BTCUSDT, or ALL for stop / lock */
  symbol: string
  /** buy / sell only */
  usd?: number
}

export interface Config {
  dailyLossLimitUsd: number
  maxActionUsd: number
  liqWarnPct: number
  marginTopUpUsd: number
  stopLossPct: number
  lockProfitPct: number
  noStopGraceSec: number
  alerts: PriceAlert[]
  shortcuts: Shortcut[]
}

export type Action =
  | { type: 'setStop'; symbol: string; positionIdx: number; price: number }
  | { type: 'addMargin'; symbol: string; positionIdx: number; usd: number }
  | { type: 'transfer'; usd: number }
  | { type: 'order'; symbol: string; side: Side; usd: number }

export interface Card {
  id: string
  key: string
  title: string
  detail: string
  question: string
  action: Action
  createdAt: number
  expiresAt: number
}

export interface Snapshot {
  positions: Position[]
  dayPnl: number
  prices: Record<string, number>
  now: number
}

/** Trading account: total value, and what a new order or margin top-up can still draw on. */
export interface Balance {
  equity: number
  available: number
}

export interface SessionState {
  positions: Position[]
  /** null until the first read, or while the exchange does not answer it */
  balance: Balance | null
  dayPnl: number
  dailyLossLimitUsd: number
  locked: boolean
  card: Card | null
  pending: number
  toast: string | null
  error: string | null
  updatedAt: number
}

/** What /api/state sends: the session plus facts only the server knows. A missing field (older server) reads as "on". */
export interface ServerState extends SessionState {
  /** false: no speech-to-text key, so the glasses must not open the mic */
  voice?: boolean
  /** Which account is behind the numbers, e.g. "Bybit testnet" or "Demo data" */
  source?: string
}

export interface Exchange {
  balance(): Promise<Balance>
  positions(): Promise<Position[]>
  closedPnlSince(ms: number): Promise<number>
  fillsSince(ms: number): Promise<Fill[]>
  lastPrice(symbol: string): Promise<number>
  setStop(symbol: string, positionIdx: number, price: number): Promise<void>
  addMargin(symbol: string, positionIdx: number, usd: number): Promise<void>
  transferToTrading(usd: number): Promise<void>
  marketOrder(symbol: string, side: Side, usd: number): Promise<void>
}
