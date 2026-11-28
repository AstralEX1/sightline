/**
 * The exchange panel, laid out like a futures exchange's phone app: Charts (drag the chart to move the price, the
 * position, Buy and Sell) and Trade (order form, positions, orders).
 */
import './exchange.css'
import { SYMBOL, type Market } from './market.ts'
import type { Order, Position, Side } from '../../../server/src/types.ts'

const UP = '#55af72'
const DOWN = '#dc5250'
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, "Helvetica Neue", Arial, sans-serif' // as in exchange.css
const AXIS_W = 56
const TIME_H = 16
const BAR_W = 6
const MIN_QTY = 0.001 // BTCUSDT's quantity step and minimum
const FLASH_MS = 4000 // keep changed chart levels solid briefly

const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const signed = (n: number, d = 2) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n), d)
const num = (i: HTMLInputElement) => Number(i.value.replace(/,/g, '')) || 0

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  e.append(...kids)
  return e
}
const input = (name: string, value = '') => el('input', { name, inputmode: 'decimal', autocomplete: 'off', value, placeholder: ' ' })
/** A filled field with its caption floating above the value, and a unit on the right. */
const box = (caption: string, i: HTMLInputElement, unit = '') => el('label', { class: 'ex-box' }, i, el('span', {}, caption), ...(unit ? [el('i', {}, unit)] : []))
const cell = (k: string, v: string, cls = '') => el('div', { class: 'ex-cell' }, el('span', {}, k), el('b', { class: cls }, v))

/** Replaces the children only when what they show changed: a click survives the twice-a-second refresh. */
function swap(host: HTMLElement, kids: Node[]) {
  const next = el('div', {}, ...kids)
  if (next.innerHTML !== host.innerHTML) host.replaceChildren(...next.childNodes)
}

export function mountExchange(root: HTMLElement, m: Market, onChartInput: () => void) {
  root.classList.add('bx')

  const viewTabs = (['Charts', 'Trade'] as const).map(v => {
    const b = el('button', { type: 'button', role: 'tab' }, v)
    b.onclick = () => show(v)
    return b
  })
  const badge = el('span', { class: 'ex-badge' })
  const lastSmall = el('b', { class: 'ex-pair-last' })
  const pair = el('div', { class: 'ex-pair' }, el('b', {}, SYMBOL), el('span', { class: 'ex-tag' }, 'Perp'), badge, lastSmall)

  const last = el('strong', { class: 'ex-last' })
  const canvas = el('canvas', { class: 'ex-canvas', tabindex: '0', 'aria-label': 'BTC chart. Drag up or down, or use the arrow keys, to move the price.' })
  const hint = el('div', { class: 'ex-drag' }, '⇕ Drag the price')
  const slot = el('div', { class: 'ex-slot' })
  const ctas = (['Buy', 'Sell'] as const).map(s => {
    const b = el('button', { type: 'button', class: `ex-btn ex-btn-${s.toLowerCase()}` }, s)
    b.onclick = () => { setSide(s); show('Trade') }
    return b
  })
  const quick = (['Buy', 'Sell'] as const).flatMap(side => [0.01, 0.05].map(qty => {
    const b = el('button', { type: 'button', class: `ex-quick ex-btn-${side === 'Buy' ? 'buy' : 'sell'}` }, `${side === 'Buy' ? 'Long' : 'Short'} ${qty}`)
    b.onclick = async () => {
      const opposite = m.positions.find(p => p.side !== side)
      if (opposite) await m.close(opposite) // one-way: a new side replaces the open position
      await m.open(side, qty, leverage)
    }
    return b
  }))
  const charts = el('div', { class: 'ex-view ex-charts' },
    last,
    el('div', { class: 'ex-tf' }, el('b', {}, '1m')),
    el('div', { class: 'ex-plot' }, canvas, hint),
    slot,
    el('div', { class: 'ex-quickbar' }, ...quick),
    el('div', { class: 'ex-cta' }, ...ctas))

  let side: Side = 'Buy'
  let leverage = 10
  let pending = leverage
  const levPill = el('button', { type: 'button', class: 'ex-pill', 'aria-expanded': 'false', 'aria-label': 'Leverage' })
  const levOut = el('output', {})
  const levRange = el('input', { type: 'range', min: '1', max: '100', 'aria-label': 'Leverage' })
  const levMinus = el('button', { type: 'button', 'aria-label': 'Lower leverage' }, '−')
  const levPlus = el('button', { type: 'button', 'aria-label': 'Raise leverage' }, '+')
  const levOk = el('button', { type: 'button', class: 'ex-confirm' }, 'Confirm')
  const levBox = el('div', { class: 'ex-levbox', hidden: '' },
    el('div', { class: 'ex-levrow' }, levMinus, levOut, levPlus),
    levRange,
    el('div', { class: 'ex-ticks' }, ...[1, 25, 50, 75, 100].map(n => el('span', {}, `${n}x`))),
    levOk)
  const setPending = (n: number) => { pending = Math.min(100, Math.max(1, Math.round(n))); levRange.value = String(pending); levOut.value = `${pending.toFixed(2)}x` }
  const levOpen = (open: boolean) => { levBox.hidden = !open; levPill.setAttribute('aria-expanded', String(open)); setPending(leverage) }
  levPill.onclick = () => {
    if (m.positions.length) return void (error.textContent = 'Close the position to change its leverage.')
    levOpen(levPill.getAttribute('aria-expanded') !== 'true')
  }
  levRange.oninput = () => setPending(Number(levRange.value))
  levMinus.onclick = () => setPending(pending - 1)
  levPlus.onclick = () => setPending(pending + 1)
  levOk.onclick = () => { leverage = pending; levOpen(false); info() }

  const sideBtns = (['Buy', 'Sell'] as const).map(s => {
    const b = el('button', { type: 'button', class: `ex-side-${s.toLowerCase()}` }, s)
    b.onclick = () => setSide(s)
    return b
  })
  const typeSel = el('select', { 'aria-label': 'Order type' }, el('option', { value: 'Market' }, 'Market'), el('option', { value: 'Limit' }, 'Limit'))
  const priceIn = input('price', fmt(m.price).replace(/,/g, ''))
  const qtyIn = input('qty', '0.05')
  const tpIn = input('tp')
  const slIn = input('sl')
  const priceBox = box('Price', priceIn, 'USDT')
  priceBox.hidden = true
  typeSel.onchange = () => { priceBox.hidden = typeSel.value !== 'Limit'; info() }
  const fill = el('i', {})
  const dots = [0, 25, 50, 75, 100].map(pct => {
    const b = el('button', { type: 'button', style: `left:${pct}%`, 'aria-label': `${pct}% of the most you can open` })
    b.onclick = () => { qtyIn.value = pct ? (Math.floor(maxQty() * pct * 10) / 1000).toFixed(3) : ''; error.textContent = ''; info() }
    return b
  })
  const avail = el('b', {})
  const value = el('b', {})
  const margin = el('b', {})
  const tpslOn = el('input', { type: 'checkbox' })
  const tpsl = el('div', { class: 'ex-two', hidden: '' }, box('Take Profit', tpIn), box('Stop Loss', slIn))
  tpslOn.onchange = () => { tpsl.hidden = !tpslOn.checked }
  const error = el('p', { class: 'ex-err', role: 'alert' })
  const submit = el('button', { type: 'submit', class: 'ex-btn' })
  const form = el('form', { class: 'ex-form', novalidate: '' },
    el('div', { class: 'ex-pills' }, el('span', { class: 'ex-pill' }, 'Isolated'), levPill),
    levBox,
    el('div', { class: 'ex-side' }, ...sideBtns),
    el('div', { class: 'ex-line' }, el('span', {}, 'Available'), avail),
    el('label', { class: 'ex-select' }, typeSel),
    priceBox,
    box('Quantity', qtyIn, 'BTC'),
    el('div', { class: 'ex-slider' }, fill, ...dots),
    el('div', { class: 'ex-line' }, el('span', {}, 'Order Value'), value),
    el('div', { class: 'ex-line' }, el('span', {}, 'Margin'), margin),
    el('label', { class: 'ex-check' }, tpslOn, 'TP/SL'),
    tpsl,
    error,
    submit)

  function setSide(s: Side) {
    side = s
    sideBtns.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (s === 'Buy'))))
    submit.textContent = s === 'Buy' ? 'Buy / Long' : 'Sell / Short'
    submit.className = `ex-btn ex-btn-${s.toLowerCase()}`
    info()
  }
  const at = () => (typeSel.value === 'Limit' ? num(priceIn) : m.price)
  const available = () => m.ex.available // the wallet the server reads too
  const maxQty = () => (at() > 0 ? (available() * leverage) / at() : 0)
  function info() {
    const qty = num(qtyIn)
    if (m.positions.length) leverage = m.positions[0].leverage // an open position fixes the leverage
    levPill.textContent = `${leverage.toFixed(2)}x`
    avail.textContent = `${fmt(available(), 2)} USDT`
    value.textContent = `${fmt(qty * at(), 2)} USDT`
    margin.textContent = `${fmt((qty * at()) / leverage, 2)} USDT`
    const pct = Math.min(100, (qty / maxQty()) * 100 || 0)
    fill.style.width = `${pct}%`
    dots.forEach((d, i) => d.classList.toggle('on', i * 25 <= pct + 0.5))
  }
  form.addEventListener('input', () => { error.textContent = ''; info() })
  form.addEventListener('submit', async e => {
    e.preventDefault()
    const qty = Math.floor(num(qtyIn) / MIN_QTY + 1e-9) * MIN_QTY
    const price = at()
    // a limit the market already reaches fills at once, at the market: an exchange does not wait for it
    const type = typeSel.value === 'Limit' && !(side === 'Buy' ? price >= m.price : price <= m.price) ? 'Limit' : 'Market'
    const tp = tpslOn.checked ? num(tpIn) : 0
    const sl = tpslOn.checked ? num(slIn) : 0
    const long = side === 'Buy'
    if (!(qty >= MIN_QTY)) return void (error.textContent = `The least you can order is ${MIN_QTY} BTC.`)
    if (!(price > 0)) return void (error.textContent = 'Enter a price.')
    const opposite = m.positions.find(p => p.side !== side)
    const held = opposite?.size ?? 0 // read before the reduce changes it
    const opening = Math.max(0, qty - held)
    if ((opening * (type === 'Limit' ? price : m.price)) / leverage > available() + 1e-9) return void (error.textContent = 'Not enough available balance.')
    if (tp && (long ? tp <= price : tp >= price)) return void (error.textContent = `Take profit must be ${long ? 'above' : 'below'} the price.`)
    if (sl && (long ? sl >= price : sl <= price)) return void (error.textContent = `Stop loss must be ${long ? 'below' : 'above'} the price.`)
    try {
      if (type === 'Limit') {
        if (!m.positions.length) m.ex.leverage[SYMBOL] = leverage // the leverage the order fills at
        m.limit(side, qty, price, Date.now(), tp, sl)
      } else {
        // one-way mode: an opposite order reduces first, the rest opens the other side
        if (opposite) await m.close(opposite, Math.min(qty, held))
        const rest = Math.round((qty - held) * 1e6) / 1e6
        if (rest > 0) await m.open(side, rest, leverage, tp, sl)
      }
      tab = type === 'Limit' ? 'orders' : 'positions'
      m.refresh()
    } catch (err) {
      error.textContent = (err as Error).message
    }
  })

  let tab: 'positions' | 'orders' = 'positions'
  let editing: Position | null = null
  const listTabs = (['positions', 'orders'] as const).map(t => {
    const b = el('button', { type: 'button', role: 'tab' })
    b.onclick = () => { tab = t; renderLists() }
    return b
  })
  const list = el('div', { class: 'ex-list' })
  const trade = el('div', { class: 'ex-view ex-trade' }, form, el('div', { class: 'ex-tabs', role: 'tablist' }, ...listTabs), list)

  root.append(el('div', { class: 'ex-views', role: 'tablist' }, ...viewTabs), pair, charts, trade)

  const changedAt = new Map<string, number>()
  let seen: Map<string, string> | null = null
  const ageOf = (...keys: string[]) => Date.now() - Math.max(...keys.map(k => changedAt.get(k) ?? -Infinity))
  function track() {
    const now = new Map<string, string>()
    const p = m.positions[0]
    now.set('pos', p ? p.side : '')
    if (p) for (const [k, v] of Object.entries({ size: p.size, entry: p.entryPrice, liq: p.liqPrice, tp: p.takeProfit, sl: p.stopLoss })) now.set(k, String(v))
    for (const o of m.orders) now.set(`o:${o.orderId}`, String(o.leavesQty))
    if (seen) for (const [k, v] of now) if (seen.get(k) !== v) changedAt.set(k, Date.now())
    seen = now
  }
  const empty = (text: string) => el('p', { class: 'ex-empty' }, text)
  const noPositions = () => empty('No open positions')
  function posCard(p: Position, i: number) {
    const long = p.side === 'Buy'
    const pnl = p.unrealisedPnl
    const roi = p.positionIM ? (pnl / p.positionIM) * 100 : 0
    const tone = pnl >= 0 ? 'ex-up' : 'ex-down'
    const size = cell('Size (BTC)', fmt(p.size, 3))
    const stops = cell('TP/SL', `${p.takeProfit ? fmt(p.takeProfit) : '--'} / ${p.stopLoss ? fmt(p.stopLoss) : '--'}`)
    if (root.dataset.position === String(p.positionIdx)) {
      size.classList.toggle('ex-result', root.dataset.light === 'size')
      stops.classList.toggle('ex-result', root.dataset.light === 'stops')
    }
    const card = el('div', { class: 'ex-card' },
      el('div', { class: 'ex-card-head' }, el('b', {}, SYMBOL), el('span', { class: 'ex-tag' }, 'Perp'),
        el('span', { class: `ex-tag ex-tag-${long ? 'up' : 'down'}` }, `${long ? 'Long' : 'Short'} ${p.leverage.toFixed(2)}x`)),
      el('div', { class: 'ex-pnl' },
        cell('Unrealized P&L (USDT)', signed(pnl), tone),
        cell('ROI', `${signed(roi)}%`, tone)),
      el('div', { class: 'ex-grid' },
        size, cell('Entry Price', fmt(p.entryPrice)), cell('Mark Price', fmt(p.markPrice)),
        cell('Liq. Price', p.liqPrice ? fmt(p.liqPrice) : '--', 'ex-warn'),
        stops))
    if (editing === p) card.append(editor(p))
    else card.append(el('div', { class: 'ex-card-btns' },
      el('button', { type: 'button', 'data-act': 'tpsl', 'data-i': String(i) }, 'TP/SL'),
      el('button', { type: 'button', 'data-act': 'close', 'data-i': String(i) }, 'Close')))
    return card
  }
  function editor(p: Position) {
    const tp = input('tp', p.takeProfit ? String(p.takeProfit) : '')
    const sl = input('sl', p.stopLoss ? String(p.stopLoss) : '')
    const f = el('form', { class: 'ex-edit', novalidate: '' },
      el('div', { class: 'ex-two' }, box('Take Profit', tp), box('Stop Loss', sl)),
      el('div', { class: 'ex-card-btns' }, el('button', { type: 'button', 'data-act': 'stop-edit' }, 'Cancel'), el('button', { type: 'submit', class: 'ex-primary' }, 'Confirm')))
    const bad = el('p', { class: 'ex-err', role: 'alert' })
    f.insertBefore(bad, f.lastChild)
    f.onsubmit = e => {
      e.preventDefault()
      const long = p.side === 'Buy'
      const [t, s] = [num(tp), num(sl)]
      if (t && (long ? t <= p.markPrice : t >= p.markPrice)) return void (bad.textContent = `Take profit must be ${long ? 'above' : 'below'} the mark price.`)
      if (s && (long ? s >= p.markPrice : s <= p.markPrice)) return void (bad.textContent = `Stop loss must be ${long ? 'below' : 'above'} the mark price.`)
      if (s && p.liqPrice && (long ? s <= p.liqPrice : s >= p.liqPrice)) return void (bad.textContent = 'Stop loss must come before liquidation.')
      m.setStops(p, t, s)
      editing = null
      renderLists()
    }
    return f
  }
  function orderCard(o: Order, i: number) {
    const buy = o.side === 'Buy'
    return el('div', { class: 'ex-card' },
      el('div', { class: 'ex-card-head' }, el('b', {}, SYMBOL), el('span', { class: 'ex-tag' }, 'Perp'),
        el('span', { class: `ex-tag ex-tag-${buy ? 'up' : 'down'}` }, `Limit / ${buy ? 'Buy' : 'Sell'}`),
        el('button', { type: 'button', class: 'ex-cancel', 'data-act': 'cancel', 'data-i': String(i) }, 'Cancel')),
      el('div', { class: 'ex-grid' },
        cell('Filled / Total (BTC)', `${fmt(o.qty - o.leavesQty, 3)} / ${fmt(o.qty, 3)}`),
        cell('Order Price', fmt(o.price)),
        cell('Margin (USDT)', fmt((o.leavesQty * o.price) / (m.ex.leverage[SYMBOL] ?? 10), 2))))
  }
  function renderLists() {
    if (editing && !m.positions.includes(editing)) editing = null
    listTabs[0].textContent = `Positions(${m.positions.length})`
    listTabs[1].textContent = `Orders(${m.orders.length})`
    listTabs.forEach((b, i) => b.setAttribute('aria-selected', String((i === 0) === (tab === 'positions'))))
    swap(slot, m.positions.length ? [posCard(m.positions[0], 0)] : [noPositions()])
    swap(list, tab === 'orders'
      ? m.orders.length ? m.orders.map(orderCard) : [empty('No open orders')]
      : m.positions.length ? m.positions.map(posCard) : [noPositions()])
  }
  // card buttons resolve their position or order on click, so a refresh in between cannot point them at a stale one
  root.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
    if (!b) return
    const i = Number(b.dataset.i)
    const act = b.dataset.act
    if (act === 'tpsl' && m.positions[i]) editing = m.positions[i]
    if (act === 'stop-edit') editing = null
    if (act === 'close' && m.positions[i]) void m.close(m.positions[i]).then(() => m.refresh())
    if (act === 'cancel' && m.orders[i]) m.cancel(m.orders[i])
    renderLists()
  })

  function show(v: 'Charts' | 'Trade') {
    charts.hidden = v !== 'Charts'
    trade.hidden = v !== 'Trade'
    root.dataset.view = v
    viewTabs.forEach(b => b.setAttribute('aria-selected', String(b.textContent === v)))
  }

  const g = canvas.getContext('2d')!
  let size = { w: 0, h: 0 }
  let frozen: { lo: number; hi: number } | null = null
  let drag: { pointerId: number; y: number; price: number; perPx: number } | null = null

  new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect()
    const dpr = Math.min(2, devicePixelRatio || 1)
    size = { w: r.width, h: r.height }
    canvas.width = r.width * dpr
    canvas.height = r.height * dpr
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    paint()
  }).observe(canvas)

  const levels = () => {
    const out: { price: number; label: string; color: string; key: string }[] = []
    for (const p of m.positions) {
      out.push({ price: p.entryPrice, label: 'Entry', color: '#a1a4a5', key: 'entry' })
      if (p.takeProfit) out.push({ price: p.takeProfit, label: 'TP', color: UP, key: 'tp' })
      if (p.stopLoss) out.push({ price: p.stopLoss, label: 'SL', color: DOWN, key: 'sl' })
      if (p.liqPrice) out.push({ price: p.liqPrice, label: 'Liq.', color: '#d4d6da', key: 'liq' })
    }
    for (const o of m.orders) out.push({ price: o.price, label: o.side === 'Buy' ? 'Buy limit' : 'Sell limit', color: '#b6b8bc', key: `o:${o.orderId}` })
    return out
  }
  const visible = () => m.bars.slice(-Math.floor((size.w - AXIS_W) / BAR_W))

  function range(bars: typeof m.bars) {
    if (frozen) return frozen
    const near = levels().map(l => l.price).filter(p => Math.abs(p / m.price - 1) < 0.06)
    let lo = Math.min(...bars.map(b => b.l), m.price, ...near)
    let hi = Math.max(...bars.map(b => b.h), m.price, ...near)
    const pad = Math.max((hi - lo) * 0.12, m.price * 0.002)
    lo -= pad
    hi += pad
    return { lo, hi }
  }

  function paint() {
    const { w, h } = size
    if (!w) return
    const plotW = w - AXIS_W
    const plotH = h - TIME_H
    const bars = visible()
    const { lo, hi } = range(bars)
    const y = (p: number) => plotH - ((p - lo) / (hi - lo)) * plotH
    const xOf = (i: number) => plotW - (bars.length - i) * BAR_W
    g.clearRect(0, 0, w, h)
    g.font = `10px ${FONT}`
    g.textBaseline = 'middle'
    // grid, price axis, time axis
    const step = niceStep((hi - lo) / 5)
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) {
      g.fillStyle = '#1b1b21'
      g.fillRect(0, Math.round(y(p)), plotW, 1)
      g.fillStyle = '#77787a'
      g.fillText(fmt(p, 0), plotW + 6, y(p))
    }
    g.textAlign = 'center'
    bars.forEach((b, i) => {
      const d = new Date(b.t)
      if (d.getMinutes() % 10 || i < 2) return
      g.fillStyle = '#77787a'
      g.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, xOf(i) + BAR_W / 2, plotH + TIME_H / 2)
    })
    g.textAlign = 'left'
    // candles
    bars.forEach((b, i) => {
      const x = xOf(i)
      g.fillStyle = b.c >= b.o ? UP : DOWN
      g.fillRect(x + BAR_W / 2 - 0.5, y(b.h), 1, Math.max(1, y(b.l) - y(b.h)))
      g.fillRect(x + 1, Math.min(y(b.o), y(b.c)), BAR_W - 2, Math.max(1, Math.abs(y(b.o) - y(b.c))))
    })
    // the visible high and low, pointed at from the side with room
    if (bars.length) {
      const hiI = bars.reduce((k, b, i) => (b.h > bars[k].h ? i : k), 0)
      const loI = bars.reduce((k, b, i) => (b.l < bars[k].l ? i : k), 0)
      marker(fmt(bars[hiI].h), xOf(hiI) + BAR_W / 2, y(bars[hiI].h), plotW)
      marker(fmt(bars[loI].l), xOf(loI) + BAR_W / 2, y(bars[loI].l), plotW)
    }
    // position and order levels; their tags step apart when two prices sit close
    const shown = levels().filter(l => l.price >= lo && l.price <= hi).sort((a, b) => b.price - a.price)
    let below = -Infinity
    for (const l of shown) {
      const hot = ageOf(l.key) < FLASH_MS // a level that just moved draws solid and bold
      g.strokeStyle = l.color
      g.lineWidth = hot ? 2 : 1
      g.setLineDash(hot ? [] : [4, 4])
      g.beginPath()
      g.moveTo(0, y(l.price))
      g.lineTo(plotW, y(l.price))
      g.stroke()
      g.setLineDash([])
      g.lineWidth = 1
      below = Math.max(y(l.price), below + 18)
      tag(`${l.label} ${fmt(l.price, 0)}`, plotW - 4, below, l.color, '#100f13', 'right')
    }
    // last price, and the seconds until the candle closes
    const last = bars[bars.length - 1]
    const color = last && last.c >= last.o ? UP : DOWN
    g.strokeStyle = color
    g.setLineDash([2, 3])
    g.beginPath()
    g.moveTo(0, y(m.price))
    g.lineTo(plotW, y(m.price))
    g.stroke()
    g.setLineDash([])
    const at = Math.min(Math.max(y(m.price), 9), plotH - 26)
    handle(plotW - 104, y(m.price), color)
    tag(fmt(m.price), plotW + 1, at, color, '#ffffff', 'left', AXIS_W - 2)
    tag(`00:${String(60 - (Math.floor(Date.now() / 1000) % 60)).padStart(2, '0')}`, plotW + 1, at + 17, '#26272a', '#a1a4a5', 'left', AXIS_W - 2)
  }

  /** A grip on the price line: the price is what you grab. */
  function handle(x: number, at: number, color: string) {
    g.fillStyle = color
    g.beginPath()
    g.arc(x, at, 11, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#ffffff'
    for (const d of [-1, 1]) { // ▲ above, ▼ below
      g.beginPath()
      g.moveTo(x - 4, at + d * 2)
      g.lineTo(x + 4, at + d * 2)
      g.lineTo(x, at + d * 6)
      g.fill()
    }
  }

  function marker(text: string, x: number, at: number, plotW: number) {
    const right = x < plotW / 2
    const tw = g.measureText(text).width
    g.fillStyle = '#a1a4a5'
    g.fillRect(right ? x + 2 : x - 16, Math.round(at), 14, 1)
    g.fillText(text, right ? x + 19 : x - 19 - tw, Math.max(6, Math.min(at, size.h - TIME_H - 6)))
  }

  function tag(text: string, x: number, at: number, bg: string, ink: string, align: 'left' | 'right', width = 0) {
    const tw = width || g.measureText(text).width + 8
    const left = align === 'left' ? x : x - tw
    g.fillStyle = bg
    g.beginPath()
    g.roundRect(left, at - 8, tw, 16, 2)
    g.fill()
    g.fillStyle = ink
    g.fillText(text, left + 4, at + 0.5)
  }

  // a mouse drag must not focus the chart: the arrow keys and Enter then still reach the glasses (Tab still focuses it)
  canvas.addEventListener('mousedown', e => e.preventDefault())
  canvas.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0) return
    onChartInput()
    let { lo, hi } = range(visible())
    if (hi - lo > m.price * 0.08) { lo = m.price * 0.96; hi = m.price * 1.04 } // a wide view would make the hand too fast
    frozen = { lo, hi } // the scale holds still under the hand
    drag = { pointerId: e.pointerId, y: e.clientY, price: m.price, perPx: (hi - lo) / (size.h - TIME_H) }
    canvas.setPointerCapture(e.pointerId)
    canvas.classList.add('is-grabbing')
    hint.hidden = true
  })
  canvas.addEventListener('pointermove', e => {
    if (drag?.pointerId === e.pointerId) m.setPrice(drag.price + (drag.y - e.clientY) * drag.perPx)
  })
  const release = (pointerId: number) => {
    if (drag?.pointerId !== pointerId) return
    drag = null
    frozen = null
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
    canvas.classList.remove('is-grabbing')
    paint()
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    canvas.addEventListener(event, e => release(e.pointerId))
  }
  canvas.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    onChartInput()
    hint.hidden = true
    m.setPrice(m.price * (e.key === 'ArrowUp' ? 1.002 : 0.998))
  })
  setInterval(paint, 1000) // the candle countdown

  let queued = false
  const render = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      track()
      const bar = m.bars[m.bars.length - 1]
      const up = bar && bar.c >= bar.o ? 'ex-up' : 'ex-down'
      last.textContent = lastSmall.textContent = fmt(m.price)
      last.className = `ex-last ${up}`
      lastSmall.className = `ex-pair-last ${up}`
      const pct = (m.price / m.bars[0].o - 1) * 100 // change over the history on the chart
      badge.textContent = `${signed(pct)}%`
      badge.className = `ex-badge ${pct >= 0 ? 'ex-badge-up' : 'ex-badge-down'}`
      paint()
      if (!editing || !m.positions.includes(editing)) renderLists() // an open TP/SL form keeps its typing
      if (typeSel.value === 'Market' && document.activeElement !== priceIn) priceIn.value = m.price.toFixed(1)
      info()
    })
  }
  setSide('Buy')
  show('Charts')
  m.onChange(render)
  render()
  return {
    /** A tab's fresh start: the chart, and what the tab's setup changed is not lit as news. */
    start() {
      if (drag) release(drag.pointerId)
      show('Charts')
      hint.hidden = false
      seen = null
      changedAt.clear()
      leverage = 10
      typeSel.value = 'Market'
      priceBox.hidden = true
      qtyIn.value = '0.05'
      tpIn.value = slIn.value = ''
      tpslOn.checked = false
      tpsl.hidden = true
      error.textContent = ''
      editing = null
      setSide('Buy')
    },
    refresh() { render() },
  }
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw) ?? raw
}
