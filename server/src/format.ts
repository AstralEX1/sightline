const fixed = (n: number, d: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

/** Signed dollars with cents: +$1,234.50, -$18.30 */
export function money(n: number): string {
  return `${n < 0 ? '-' : '+'}$${fixed(Math.abs(n), 2)}`
}

/** Price: no decimals from 1,000, 2 from 1, else 4. */
export function price(n: number): string {
  return fixed(n, n >= 1000 ? 0 : n >= 1 ? 2 : 4)
}

/** Unsigned dollars with cents, for balances: $1,234.50 */
export const dollars = (n: number) => `${n < 0 ? '-' : ''}$${fixed(Math.abs(n), 2)}`

/** Whole dollars for amounts the user set: $1,200 */
export function usd(n: number): string {
  return `$${n.toLocaleString('en-US')}`
}

export const coin = (symbol: string) => symbol.replace(/USDT$/, '')
