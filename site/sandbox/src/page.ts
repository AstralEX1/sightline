/** Guided scenes and the free sandbox share the real phone app, G2 bridge and paper market. */
import './style.css'
import { CARD_SETTLE_MS, type RenderedAlert } from '../../../app/src/view.ts'
import type { AlertRecord } from '../../../server/src/types.ts'
import { createBackend, type Backend } from './backend.ts'
import { mountExchange } from './exchange.ts'
import { createHost, type Gesture } from './host.ts'
import { Lens } from './lens.ts'
import { Market } from './market.ts'
import { mountScenarioTabs } from './scenario-tabs.ts'
import { openScenarioPosition, scenarioDrafts, TABS, type Tab } from './scenarios.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const phone = $<HTMLIFrameElement>('phone')
const panel = $('panel')
const play = $<HTMLButtonElement>('play')
const restart = $<HTMLButtonElement>('restart')
const progress = $('progress')
const chartStatus = $('chart-status')
const lensCanvas = $<HTMLCanvasElement>('lens')
const gestures = [...document.querySelectorAll<HTMLButtonElement>('[data-gesture]')]
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
const scenes = ['phone', 'chart', 'glasses'] as const
const sceneNames = ['Phone', 'BTC chart', 'Glasses']
type Scene = typeof scenes[number]
const sceneViews = [document.querySelector<HTMLElement>('.phone-col')!, document.querySelector<HTMLElement>('.chart-col')!,
  document.querySelector<HTMLElement>('.glasses')!]
const exchangeView = document.querySelector<HTMLElement>('.exchange-col')!

const initialId = location.hash === '#build' ? 'sandbox' : location.hash.slice(1)
const initialIndex = Math.max(0, TABS.findIndex(t => t.id === initialId))
let tab = TABS[initialIndex]
let run = 0
let scene: Scene = 'phone'
let backend: Backend | undefined
let playback: AbortController | undefined
let replayOnReady = false
let renderedAlert: RenderedAlert | null = null
const market = new Market()

const lens = new Lens(lensCanvas, () => {
  if (!lens.pagePaintedAt) return
  const labels = lens.page.textObject?.filter(box => ['top', 'who', 'why', 'ask', 'terms', 'opt1', 'opt2'].includes(box.containerName))
    .map(box => box.content?.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const name = labels?.length ? `Even G2 display. ${labels.join('. ')}` : 'Even G2 display'
  if (lensCanvas.getAttribute('aria-label') !== name) lensCanvas.setAttribute('aria-label', name)
})
const host = createHost(lens)
const exchange = mountExchange($('exchange'), market)
setInterval(() => market.refresh(), 500)
setInterval(() => { if (tab.target === null && backend) market.drift() }, 1000)

const sandbox = {
  attach(w: Window, id: number) {
    if (id !== run || !backend) return false
    host.attach(w, () => id === run)
    w.addEventListener('trade-shortcuts:rendered-alert', event => {
      const { detail } = event as CustomEvent<RenderedAlert | null>
      // The simulator commits bridge updates on the parent's next paint.
      requestAnimationFrame(() => { if (id === run) renderedAlert = detail })
    })
    return true
  },
  fetch(input: RequestInfo | URL, init?: RequestInit, id = run) {
    if (id !== run || !backend) return Promise.resolve(new Response(null, { status: 409 }))
    return backend.fetch(input, init)
  },
}
;(window as unknown as { sandbox: typeof sandbox }).sandbox = sandbox

new ResizeObserver(([entry]) => {
  phone.style.setProperty('--phone-scale', String(entry.contentRect.width / 390))
}).observe(phone.parentElement!)

$('tabs').append(...TABS.map((t, index) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.id = `tab-${t.id}`
  button.className = 'nv-button'
  button.setAttribute('role', 'tab')
  button.dataset.tab = String(index)
  button.textContent = t.title
  return button
}))
mountScenarioTabs($('workspace'), initialIndex, index => void open(TABS[index]))

function renderScene(next: Scene) {
  scene = next
  const free = tab.target === null
  const index = scenes.indexOf(next)
  panel.dataset.scene = free ? 'free' : next
  sceneViews.forEach((view, i) => { view.hidden = free ? i === 1 : i > index })
  exchangeView.hidden = !free
  for (const button of gestures) if (button.hasAttribute('data-free-control')) button.hidden = !free
  play.hidden = free || next !== 'phone' || Boolean(playback)
  play.disabled = true
  restart.hidden = !free && next === 'phone' && !playback
  restart.setAttribute('aria-label', free ? 'Reset sandbox' : 'Replay scenario')
  progress.hidden = free
  progress.setAttribute('aria-valuenow', String(index + 1))
  progress.setAttribute('aria-valuetext', sceneNames[index])
  $('scene-status').textContent = free ? '' : sceneNames[index]
  for (const [i, bar] of Array.from(progress.children).entries()) bar.toggleAttribute('data-reached', i <= index)
  spotlight(next, false)
}

function spotlight(device: Scene, scroll = true) {
  const free = tab.target === null
  sceneViews.forEach((view, index) => {
    const dimmed = !free && !view.hidden && scenes[index] !== device
    if (dimmed && view.contains(document.activeElement)) panel.focus({ preventScroll: true })
    view.toggleAttribute('data-dimmed', dimmed)
    view.inert = dimmed
  })
  if (scroll && matchMedia('(max-width: 640px)').matches) {
    sceneViews[scenes.indexOf(device)].scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }
}

/** Switching or replaying discards the previous paper account and reloads the app against a fresh one. */
async function open(next: Tab, replay = false) {
  const id = ++run
  playback?.abort()
  playback = undefined
  replayOnReady = replay
  tab = next
  history.replaceState(null, '', `#${next.id}`)
  if (document.activeElement === restart) panel.focus({ preventScroll: true })
  backend?.stop()
  backend = undefined
  renderedAlert = null
  chartStatus.hidden = true
  lens.showHints = next.target === null
  lens.setPage({})
  lensCanvas.setAttribute('aria-label', 'Even G2 display')
  renderScene('phone')
  market.reset()
  await openScenarioPosition(next, market)
  if (id !== run) return
  backend = createBackend(market.ex, scenarioDrafts(next))
  exchange.start()
  phone.src = `app.html?run=${id}`
}

restart.onclick = () => void open(tab, tab.target !== null)
play.onclick = () => void playScenario()

/** The in-frame app controls the real shortcut. Wait until its enabled tile is present before offering playback. */
setInterval(() => {
  if (tab.target === null || scene !== 'phone' || playback || !backend) return
  const link = activeShortcut()
  play.disabled = !link
  if (link && replayOnReady) {
    replayOnReady = false
    void playScenario()
  }
}, 150)

function activeShortcut() {
  const frame = phone.contentDocument
  const current = frame?.URL && new URL(frame.URL).searchParams.get('run') === String(run)
  if (!current) return null
  const enabled = frame.querySelector('main[aria-label="Shortcuts"]:not([hidden]) .tile__switch[aria-checked=true]')
  return enabled?.closest('.tile')?.querySelector<HTMLAnchorElement>('.tile__body') ?? null
}

const line = document.querySelector<SVGPolylineElement>('#price-line')!
const clip = document.querySelector<SVGRectElement>('#plot-clip')!
const change = $('price-change')
const prices = [0, .021, .031, .024, .114, .18, .163, .33, .48, .44, .62, .78, .74, 1]
const cash = (price: number) => Math.round(price).toLocaleString('en-US')
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

type EditorPart = 'condition' | 'action'
const editorPart = (part: EditorPart) => phone.contentDocument?.querySelector<HTMLElement>(
  `main[aria-label="Shortcut"]:not([hidden]) [data-shortcut-part="${part}"]`,
)

async function flashEditor(part: EditorPart, signal: AbortSignal) {
  const row = editorPart(part)
  if (!row || signal.aborted) return
  spotlight('phone')
  const view = row.ownerDocument.defaultView
  const box = row.getBoundingClientRect()
  if (view && (box.top < 12 || box.bottom > view.innerHeight - 12)) {
    view.scrollTo({ top: view.scrollY + box.top - 24, behavior: 'instant' })
  }
  row.setAttribute('data-fired', '')
  try { await delay(760) } finally { row.removeAttribute('data-fired') }
}

async function historyOf(server: Backend): Promise<AlertRecord[]> {
  const response = await server.fetch('/api/history')
  return response.ok ? response.json() : []
}

async function watchAction(server: Backend, id: string, signal: AbortSignal) {
  while (!signal.aborted) {
    const alert = (await historyOf(server)).find(item => item.id === id)
    if (!alert || signal.aborted) return
    if (/^(Shown on Even G2|Filled|Done)(?:\s|$)/.test(alert.status)) {
      // The confirmation or notification has reached the simulated account or G2.
      await delay(650)
      if (signal.aborted) return
      await flashEditor('action', signal)
      if (!signal.aborted) spotlight('glasses')
      return
    }
    if (!/^(Waiting|Sending|Submitted|Partly filled)/.test(alert.status)) return
    await delay(400)
  }
}

function showPrice(from: number, target: number, fraction: number) {
  const i = fraction * (prices.length - 1)
  const prior = Math.min(prices.length - 2, Math.floor(i))
  const offset = prices[prior] + (prices[prior + 1] - prices[prior]) * (i - prior)
  market.setPrice(from + (target - from) * offset)
  const pct = (market.price / from - 1) * 100
  $('chart-price').textContent = cash(market.price)
  change.textContent = `${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%`
  change.toggleAttribute('data-falling', pct < 0)
  clip.setAttribute('width', String(4 + 474 * fraction))
}

async function playScenario() {
  const { target } = tab
  const server = backend
  const link = activeShortcut()
  if (target === null || !server || !link || play.disabled || scene !== 'phone' || playback) return
  const shortcutId = decodeURIComponent(link.hash.slice('#/shortcut/'.length))
  const controller = new AbortController()
  const { signal } = controller
  playback = controller
  if (document.activeElement === play) panel.focus({ preventScroll: true })
  renderScene('phone')
  phone.contentWindow!.location.hash = link.hash
  try {
    await server.tick() // establish the reference price before the simulated move
    const editorDeadline = performance.now() + 3000
    while (!signal.aborted && !editorPart('condition') && performance.now() < editorDeadline) await delay(50)
    await delay(650)
    if (signal.aborted) return
    const startedAt = Date.now()
    const from = market.price
    const falling = target < from
    $('price-start').textContent = `${cash(from)} USDT`
    $('price-end').textContent = `${cash(target)} USDT`
    line.toggleAttribute('data-falling', falling)
    line.setAttribute('points', prices.map((v, i) => `${3 + 474 * i / (prices.length - 1)},${falling ? 20 + 151 * v : 171 - 151 * v}`).join(' '))
    showPrice(from, target, 0)
    renderScene('chart')
    spotlight('chart')
    if (reduceMotion.matches) showPrice(from, target, 1)
    else await new Promise<void>(done => {
      const startedAt = performance.now()
      const frame = (now: number) => {
        if (signal.aborted) return done()
        const fraction = Math.min(1, (now - startedAt) / 2400)
        showPrice(from, target, fraction)
        if (fraction === 1) done()
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    if (signal.aborted) return
    await server.tick()
    await delay(reduceMotion.matches ? 900 : 300)
    if (signal.aborted) return
    const alerts = await historyOf(server)
    const fired = new Set(alerts.filter(a => a.shortcutId === shortcutId && a.createdAt >= startedAt && !a.simulated).map(a => a.id))
    const expires = performance.now() + 5500
    if (fired.size) await flashEditor('condition', signal)
    while (fired.size && !signal.aborted && performance.now() < expires && !lensReady(fired)) await delay(80)
    if (signal.aborted) return
    const alert = lensReady(fired) && renderedAlert
    if (alert) {
      renderScene('glasses')
      spotlight('glasses')
      await watchAction(server, alert.id, signal)
    } else {
      spotlight('chart')
      chartStatus.hidden = false
    }
  } finally {
    if (playback === controller) playback = undefined
  }
}

/** Present actual lens content. Do not synthesize an alert if an edited rule did not fire. */
function lensReady(fired: ReadonlySet<string>) {
  return renderedAlert && fired.has(renderedAlert.id) && lens.pagePaintedAt > 0 &&
    (!renderedAlert.actionable || performance.now() - lens.pagePaintedAt >= CARD_SETTLE_MS)
}

function press(gesture: Gesture) {
  if (tab.target !== null && scene !== 'glasses') return
  host.gesture(gesture)
  const button = gestures.find(button => button.dataset.gesture === gesture)
  button?.classList.add('pressed')
  setTimeout(() => button?.classList.remove('pressed'), 160)
}
for (const button of gestures) {
  button.onmousedown = event => event.preventDefault()
  button.onclick = () => press(button.dataset.gesture as Gesture)
}
lensCanvas.onclick = () => press('tap')
const keys: Record<string, Gesture> = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'tap', ' ': 'tap', Escape: 'double', Backspace: 'double', m: 'menu' }
document.addEventListener('keydown', event => {
  if (tab.target !== null && scene !== 'glasses') return
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select, button, canvas:not(#lens)') || event.metaKey || event.ctrlKey || event.altKey) return
  const gesture = keys[event.key]
  if (!gesture || (tab.target !== null && !['up', 'down', 'tap'].includes(gesture))) return
  event.preventDefault()
  press(gesture)
})

void open(tab)
