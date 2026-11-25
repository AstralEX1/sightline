/** The exchange panel: price, a chart you drag to move the price, an order ticket, positions and orders. */
import { liqOf, SYMBOL, type Market } from './market.ts'
import type { Position } from '../../../server/src/types.ts'

const UP = '#20b26c'
const DOWN = '#ef454a'
const AXIS_W = 66
const BAR_W = 7

const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const signed = (n: number, d = 2) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n), d)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  e.append(...kids)
  return e
}

export function mountExchange(root: HTMLElement, m: Market) {
  const startPrice = m.price
  const price = el('strong', { class: 'ex-price' })
  const change = el('span', { class: 'ex-change' })
  const canvas = el('canvas', { class: 'ex-canvas', tabindex: '0', 'aria-label': 'BTC chart. Drag up or down, or use the arrow keys, to move the price.' })
  const hint = el('div', { class: 'ex-hint' }, '⇕ Drag to move the price')
  const ticket = el('form', { class: 'ex-ticket', novalidate: '' })
  const tabs = el('div', { class: 'ex-tabs', role: 'tablist' })
  const list = el('div', { class: 'ex-list' })
  root.append(
    el('header', { class: 'ex-head' }, el('b', {}, SYMBOL), el('span', { class: 'ex-muted' }, 'Perpetual'), price, change),
    el('div', { class: 'ex-chart' }, canvas, hint),
    ticket, tabs, list,
  )

  // ── chart ──
  const g = canvas.getContext('2d')!
  let size = { w: 0, h: 0 }
  let frozen: { lo: number; hi: number } | null = null
  let drag: { y: number; price: number; perPx: number } | null = null

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
    const out: { price: number; label: string; color: string }[] = []
    for (const p of m.positions) {
      out.push({ price: p.entryPrice, label: 'Entry', color: '#8a919c' })
      if (p.takeProfit) out.push({ price: p.takeProfit, label: 'TP', color: UP })
      if (p.stopLoss) out.push({ price: p.stopLoss, label: 'SL', color: DOWN })
      if (p.liqPrice) out.push({ price: p.liqPrice, label: 'Liq.', color: '#ffb11a' })
    }
    for (const o of m.orders) out.push({ price: o.price, label: o.side === 'Buy' ? 'Buy limit' : 'Sell limit', color: '#5b8def' })
    return out
  }

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
    const bars = m.bars.slice(-Math.floor(plotW / BAR_W))
    const { lo, hi } = range(bars)
    const y = (p: number) => h - ((p - lo) / (hi - lo)) * h
    g.clearRect(0, 0, w, h)
    g.font = '11px Manrope, system-ui, sans-serif'
    g.textBaseline = 'middle'
    // grid and axis
    const step = niceStep((hi - lo) / 5)
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) {
      g.fillStyle = '#232830'
      g.fillRect(0, Math.round(y(p)), plotW, 1)
      g.fillStyle = '#5c636e'
      g.fillText(fmt(p, 0), plotW + 8, y(p))
    }
    // candles
    bars.forEach((b, i) => {
      const x = plotW - (bars.length - i) * BAR_W
      g.fillStyle = b.c >= b.o ? UP : DOWN
      g.fillRect(x + 3, y(b.h), 1, Math.max(1, y(b.l) - y(b.h)))
      g.fillRect(x + 1, Math.min(y(b.o), y(b.c)), BAR_W - 2, Math.max(1, Math.abs(y(b.o) - y(b.c))))
    })
    // position and order levels; their tags step apart when two prices sit close
    const shown = levels().filter(l => l.price >= lo && l.price <= hi).sort((a, b) => b.price - a.price)
    let below = -Infinity
    for (const l of shown) {
      g.strokeStyle = l.color
      g.setLineDash([4, 4])
      g.beginPath()
      g.moveTo(0, y(l.price))
      g.lineTo(plotW, y(l.price))
      g.stroke()
      g.setLineDash([])
      below = Math.max(y(l.price), below + 19)
      tag(`${l.label} ${fmt(l.price, 0)}`, plotW - 4, below, l.color, 'right')
    }
    // last price
    const last = bars[bars.length - 1]
    const color = last && last.c >= last.o ? UP : DOWN
    g.strokeStyle = color
    g.setLineDash([2, 3])
    g.beginPath()
    g.moveTo(0, y(m.price))
    g.lineTo(plotW, y(m.price))
    g.stroke()
    g.setLineDash([])
    tag(fmt(m.price), plotW + 2, y(m.price), color, 'left')
  }

  function tag(text: string, x: number, at: number, bg: string, align: 'left' | 'right') {
    const tw = g.measureText(text).width + 10
    const left = align === 'left' ? x : x - tw
    g.fillStyle = bg
    g.beginPath()
    g.roundRect(left, at - 9, tw, 18, 3)
    g.fill()
    g.fillStyle = '#0b0e11'
    g.fillText(text, left + 5, at + 0.5)
  }

  canvas.addEventListener('pointerdown', e => {
    const { lo, hi } = range(m.bars.slice(-Math.floor((size.w - AXIS_W) / BAR_W)))
    frozen = { lo, hi } // the scale holds still under the hand
    drag = { y: e.clientY, price: m.price, perPx: (hi - lo) / size.h }
    canvas.setPointerCapture(e.pointerId)
    hint.hidden = true
  })
  canvas.addEventListener('pointermove', e => { if (drag) m.setPrice(drag.price + (drag.y - e.clientY) * drag.perPx) })
  const release = () => { drag = null; frozen = null; paint() }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  canvas.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    hint.hidden = true
    m.setPrice(m.price * (e.key === 'ArrowUp' ? 1.002 : 0.998))
  })

  // ── ticket ──
  let type: 'Market' | 'Limit' = 'Market'
  const seg = el('div', { class: 'ex-seg' }, ...(['Market', 'Limit'] as const).map(t => {
    const b = el('button', { type: 'button', 'aria-pressed': String(t === type) }, t)
    b.onclick = () => { type = t; for (const x of seg.children) x.setAttribute('aria-pressed', String(x === b)); limitRow.hidden = t !== 'Limit'; info() }
    return b
  }))
  const input = (name: string, value = '', placeholder = '') => el('input', { name, inputmode: 'decimal', autocomplete: 'off', value, placeholder })
  const priceIn = input('price', fmt(m.price, 1).replace(/,/g, ''))
  const qtyIn = input('qty', '0.05')
  const tpIn = input('tp', '', 'Optional')
  const slIn = input('sl', '', 'Optional')
  const lev = el('input', { type: 'range', min: '1', max: '100', value: '10', 'aria-label': 'Leverage' })
  const levOut = el('output', {}, '10×')
  const limitRow = el('label', { class: 'ex-field' }, el('span', {}, 'Price'), priceIn, el('i', {}, 'USDT'))
  limitRow.hidden = true
  const cost = el('p', { class: 'ex-cost' })
  const error = el('p', { class: 'ex-error', role: 'alert' })
  const buy = el('button', { type: 'submit', class: 'ex-buy', value: 'Buy' }, 'Buy / Long')
  const sell = el('button', { type: 'submit', class: 'ex-sell', value: 'Sell' }, 'Sell / Short')
  ticket.append(
    seg,
    el('label', { class: 'ex-lev' }, el('span', {}, 'Leverage'), lev, levOut),
    limitRow,
    el('label', { class: 'ex-field' }, el('span', {}, 'Qty'), qtyIn, el('i', {}, 'BTC')),
    el('div', { class: 'ex-tpsl' },
      el('label', { class: 'ex-field' }, el('span', {}, 'TP'), tpIn),
      el('label', { class: 'ex-field' }, el('span', {}, 'SL'), slIn)),
    cost, error,
    el('div', { class: 'ex-sides' }, buy, sell),
  )
  const num = (i: HTMLInputElement) => Number(i.value.replace(/,/g, '')) || 0
  function info() {
    const at = type === 'Limit' ? num(priceIn) : m.price
    const leverage = Number(lev.value)
    levOut.value = `${leverage}×`
    cost.textContent = `Margin ${fmt((num(qtyIn) * at) / leverage, 2)} USDT · Long liq. ${fmt(liqOf('Buy', at, leverage), 0)}`
  }
  ticket.addEventListener('input', () => { error.textContent = ''; info() })
  ticket.addEventListener('submit', async e => {
    e.preventDefault()
    const side = ((e as SubmitEvent).submitter as HTMLButtonElement).value as 'Buy' | 'Sell'
    const qty = num(qtyIn)
    const at = type === 'Limit' ? num(priceIn) : m.price
    const tp = num(tpIn)
    const sl = num(slIn)
    const long = side === 'Buy'
    if (!(qty > 0)) return void (error.textContent = 'Enter a quantity.')
    if (!(at > 0)) return void (error.textContent = 'Enter a price.')
    if (tp && (long ? tp <= at : tp >= at)) return void (error.textContent = `Take profit must be ${long ? 'above' : 'below'} the price.`)
    if (sl && (long ? sl >= at : sl <= at)) return void (error.textContent = `Stop loss must be ${long ? 'below' : 'above'} the price.`)
    try {
      if (type === 'Limit') m.limit(side, qty, at)
      else {
        const opposite = m.positions.find(p => p.side !== side)
        // one-way mode: an opposite order reduces first, the rest opens the other side
        if (opposite && qty >= opposite.size) await m.close(opposite)
        else if (opposite) await m.ex.placeOrder({ symbol: SYMBOL, side, qty: String(qty), orderLinkId: crypto.randomUUID(), positionIdx: 0, reduceOnly: true })
        const rest = opposite ? Math.round((qty - opposite.size) * 1e6) / 1e6 : qty
        if (rest > 0) await m.open(side, rest, Number(lev.value), tp, sl)
      }
      m.refresh()
    } catch (err) {
      error.textContent = (err as Error).message
    }
  })

  // ── positions and orders ──
  let tab: 'positions' | 'orders' = 'positions'
  let editing: Position | null = null
  function renderList() {
    tabs.replaceChildren(...(['positions', 'orders'] as const).map(t => {
      const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(t === tab) }, `${t === 'positions' ? 'Positions' : 'Orders'} (${t === 'positions' ? m.positions.length : m.orders.length})`)
      b.onclick = () => { tab = t; renderList() }
      return b
    }))
    if (tab === 'orders') {
      list.replaceChildren(...(m.orders.length ? m.orders.map(o => {
        const cancel = el('button', { type: 'button', class: 'ex-link' }, 'Cancel')
        cancel.onclick = () => m.cancel(o)
        return el('div', { class: 'ex-row' },
          el('div', { class: 'ex-row-head' }, el('b', { class: o.side === 'Buy' ? 'up' : 'down' }, `${o.side === 'Buy' ? 'Buy' : 'Sell'} limit`), el('span', {}, `${o.leavesQty} / ${o.qty} BTC @ ${fmt(o.price)}`), cancel))
      }) : [el('p', { class: 'ex-empty' }, 'No open orders')]))
      return
    }
    if (!m.positions.length) return void list.replaceChildren(el('p', { class: 'ex-empty' }, 'No open positions'))
    list.replaceChildren(...m.positions.map(p => {
      const long = p.side === 'Buy'
      const pnl = p.unrealisedPnl
      const roi = p.positionIM ? (pnl / p.positionIM) * 100 : 0
      const close = el('button', { type: 'button', class: 'ex-link' }, 'Close')
      close.onclick = () => void m.close(p)
      const edit = el('button', { type: 'button', class: 'ex-link' }, 'TP/SL')
      edit.onclick = () => { editing = editing === p ? null : p; renderList() }
      const row = el('div', { class: 'ex-row' },
        el('div', { class: 'ex-row-head' }, el('b', { class: long ? 'up' : 'down' }, `${long ? 'Long' : 'Short'} ${p.leverage}×`), el('span', {}, `${p.size} BTC`), edit, close),
        el('dl', {},
          el('dt', {}, 'Entry'), el('dd', {}, fmt(p.entryPrice)),
          el('dt', {}, 'Mark'), el('dd', {}, fmt(p.markPrice)),
          el('dt', {}, 'Liq.'), el('dd', { class: 'warn' }, p.liqPrice ? fmt(p.liqPrice) : '—'),
          el('dt', {}, 'PnL'), el('dd', { class: pnl >= 0 ? 'up' : 'down' }, signed(pnl)),
          el('dt', {}, 'ROI'), el('dd', { class: pnl >= 0 ? 'up' : 'down' }, `${signed(roi)}%`),
          el('dt', {}, 'TP / SL'), el('dd', {}, `${p.takeProfit ? fmt(p.takeProfit, 0) : '—'} / ${p.stopLoss ? fmt(p.stopLoss, 0) : '—'}`)))
      if (editing === p) {
        const tp = input('tp', p.takeProfit ? String(p.takeProfit) : '', 'TP')
        const sl = input('sl', p.stopLoss ? String(p.stopLoss) : '', 'SL')
        const save = el('button', { type: 'submit', class: 'ex-link' }, 'Save')
        const f = el('form', { class: 'ex-edit' }, tp, sl, save)
        f.onsubmit = e => { e.preventDefault(); m.setStops(p, num(tp), num(sl)); editing = null; renderList() }
        row.append(f)
      }
      return row
    }))
  }

  let queued = false
  const render = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      const last = m.bars[m.bars.length - 1]
      price.textContent = fmt(m.price)
      price.className = `ex-price ${last && last.c >= last.o ? 'up' : 'down'}`
      const pct = (m.price / startPrice - 1) * 100
      change.textContent = `${signed(pct)}%`
      change.className = `ex-change ${pct >= 0 ? 'up' : 'down'}`
      paint()
      if (editing && !m.positions.includes(editing)) editing = null
      if (!editing) renderList() // an open TP/SL form keeps its typing
      if (type === 'Market' && document.activeElement !== priceIn) priceIn.value = m.price.toFixed(1)
      info()
    })
  }
  m.onChange(render)
  render()
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw) ?? raw
}
