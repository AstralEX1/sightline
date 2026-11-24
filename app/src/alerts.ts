import type { PriceAlert } from '../../server/src/types.ts'
import { coin, price, usd } from '../../server/src/format.ts'

export const alertLine = (a: PriceAlert) =>
  `${a.symbol} ${a.when} ${a.price}${a.orderUsd && a.side ? ` ${a.side.toLowerCase()} ${a.orderUsd}` : ''}`

/** "BTCUSDT above 60000 buy 200" → PriceAlert. Throws naming the bad line. */
export function parseAlerts(text: string): PriceAlert[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(/^([A-Za-z0-9]+)\s+(above|below)\s+([\d.]+)(?:\s+(buy|sell)\s+([\d.]+))?$/i)
    if (!m) throw new Error(`Cannot read alert "${line}". Example: BTCUSDT above 60000 buy 200`)
    const [, sym, when, px, side, amount] = m
    const symbol = sym.toUpperCase()
    const w = when.toLowerCase() as PriceAlert['when']
    const a: PriceAlert = { id: `${symbol}-${w}-${px}`, symbol, when: w, price: Number(px) }
    if (side && amount) {
      a.side = side.toLowerCase() === 'buy' ? 'Buy' : 'Sell'
      a.orderUsd = Number(amount)
    }
    return a
  })
}

/** An alert read back in words under the text box, so a typo shows before it costs anything. */
export const describeAlert = (a: PriceAlert) =>
  `When ${coin(a.symbol)} goes ${a.when} ${price(a.price)}: ${a.orderUsd && a.side ? `offer to ${a.side.toLowerCase()} ${usd(a.orderUsd)} at market` : 'let me know'}`
