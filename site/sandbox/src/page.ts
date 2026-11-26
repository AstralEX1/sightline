/**
 * The sandbox page. The phone frame runs the real app (app.html: app/src/main.ts unchanged); this page plays the Even
 * app for it (host.ts, drawing the lens), runs the real server against a simulated exchange (backend.ts, market.ts),
 * and shows one scenario per tab (scenarios.ts).
 */
import './style.css'
import type { RenderedAlert } from '../../../app/src/view.ts'
import { CLOSE_SEED, TEMPLATES, VOICE_SEEDS } from '../../../server/src/registry.ts'
import type { AlertRecord } from '../../../server/src/types.ts'
import { createBackend, type Backend } from './backend.ts'
import { mountExchange } from './exchange.ts'
import { createHost, type Gesture } from './host.ts'
import { Lens } from './lens.ts'
import { Market } from './market.ts'
import { TABS, type Tab } from './scenarios.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids)
  return e
}

const canvas = $<HTMLCanvasElement>('lens')
const lens = new Lens(canvas, () => {
  const labels = lens.page.textObject?.filter(box => ['top', 'who', 'why', 'ask', 'terms', 'opt1', 'opt2'].includes(box.containerName))
    .map(box => box.content?.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const label = labels?.length ? `Even G2 display. ${labels.join('. ')}` : 'Even G2 display'
  if (canvas.getAttribute('aria-label') !== label) canvas.setAttribute('aria-label', label)
})
const host = createHost(lens, () => say('The glasses would ask to close the app here. The sandbox keeps it open.'))
const market = new Market()
let backend: Backend | undefined
let run = 0
const guideDefaults = new Map([
  ['gt.hiddenTemplates', [...new Set(TEMPLATES.map(t => t.category))].join(',')],
])

// What app-host.ts finds in the phone frame's parent.
const sandbox = {
  attach(w: Window, id: number) {
    if (id !== run || !backend) return false
    host.attach(w, () => id === run, tab.on ? guideDefaults : undefined)
    w.addEventListener('trade-shortcuts:rendered-alert', e => {
      if (id !== run) return
      renderedAlertId = (e as CustomEvent<RenderedAlert | null>).detail?.id
      spotlightAlert()
    })
    return true
  },
  fetch(input: RequestInfo | URL, init?: RequestInit, id = run) {
    if (id !== run || !backend) return Promise.resolve(new Response(null, { status: 409 }))
    return backend.fetch(input, init)
  },
}
;(window as unknown as { sandbox: typeof sandbox }).sandbox = sandbox

const exchange = mountExchange($('exchange'), market, () => {
  if (phase === 'move') spotlight('chart')
})
setInterval(() => market.refresh(), 500) // the app's trades change FakeExchange directly: show them
setInterval(() => { if (backend) market.drift() }, 1000) // time passes: the chart moves on its own

const phone = $<HTMLIFrameElement>('phone')
const panel = $('panel')
const play = $<HTMLButtonElement>('scenario-play')
const tabsEl = $('tabs')
const stepsEl = $('steps')
new ResizeObserver(([entry]) => {
  phone.style.setProperty('--phone-scale', String(entry.contentRect.width / 390))
}).observe(phone.parentElement!)

// ── tabs ──
let tab = TABS[0]
/** Where the visitor is: add the shortcut, move the price, answer the alert, done; or the alert ended unanswered. */
type Phase = 'add' | 'move' | 'answer' | 'executing' | 'done' | 'missed'
let phase: Phase = 'move'
let gliding = false
let enabledShortcutId: string | undefined
let currentAlertId: string | undefined
let renderedAlertId: string | undefined
/** A line under the current step: why it is still there. */
let note = ''
/** How the tab's own alert ended, when it ended without the action. */
let missed = ''
let status = ''

const spotlightTargets = { phone: play, chart: $('exchange'), glasses: panel.querySelector('.glasses')! }
function spotlight(target: keyof typeof spotlightTargets, reveal = false) {
  if (!tab.on) return
  panel.dataset.spotlight = target
  if (reveal && matchMedia('(max-width: 900px)').matches) {
    spotlightTargets[target].scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }
}

function spotlightAlert() {
  if (tab.on && currentAlertId && currentAlertId === renderedAlertId && panel.dataset.spotlight !== 'glasses') {
    spotlight('glasses', true)
    // The editor and chart receive focus on entry. Hand off their keys when the alert becomes visible.
    const focused = document.activeElement
    const editorFocused = focused === phone && phone.contentDocument?.activeElement?.matches('main[aria-label="Shortcut"]')
    if (editorFocused || spotlightTargets.chart.contains(focused)) canvas.focus({ preventScroll: true })
  }
}

const shortcutHash = (id: string) => `#/shortcut/${encodeURIComponent(id)}`
function flashShortcut(id: string, part: 'condition' | 'action') {
  const doc = phone.contentDocument
  if (doc?.location.hash !== shortcutHash(id)) return
  const card = doc.querySelector(`main:not([hidden]) [data-shortcut-part="${part}"]`)
  if (!card) return
  card.setAttribute('data-fired', '')
  setTimeout(() => card.removeAttribute('data-fired'), 1200)
}

/** A short line under the glasses window. */
const noteEl = $('note')
let noteTimer: ReturnType<typeof setTimeout> | undefined
function say(text: string) {
  noteEl.textContent = text
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => { noteEl.textContent = '' }, 4000)
}

const buttons = TABS.map((t, i) => {
  const b = el('button', { type: 'button', id: `tab-${t.id}`, className: 'tab', role: 'tab' } as Partial<HTMLButtonElement>,
    el('span', { className: 'tab-n' }, String(i + 1)),
    el('span', { className: 'tab-t' }, el('b', {}, t.title), el('small', {}, t.sub)))
  b.setAttribute('aria-controls', 'panel')
  b.onmousedown = e => e.preventDefault() // a click must not keep focus here: Enter and the arrows belong to the glasses
  b.onclick = () => void open(t)
  b.onkeydown = e => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    const next = TABS[(i + d + TABS.length) % TABS.length]
    void open(next)
    $(`tab-${next.id}`).focus()
  }
  return b
})
tabsEl.append(...buttons)

/** A tab starts from scratch: a new account, the server, and the app reloaded on the phone. */
async function open(t: Tab, revealPhone = false) {
  const id = ++run
  tab = t
  history.replaceState(null, '', `#${t.id}`)
  for (const b of buttons) {
    const on = b.id === `tab-${t.id}`
    b.setAttribute('aria-selected', String(on))
    b.tabIndex = on ? 0 : -1
  }
  panel.setAttribute('aria-labelledby', `tab-${t.id}`)
  backend?.stop()
  backend = undefined
  gliding = false
  enabledShortcutId = currentAlertId = renderedAlertId = undefined
  play.hidden = !t.on
  play.disabled = true
  if (t.on) spotlight('phone', revealPhone)
  else delete panel.dataset.spotlight
  stepsEl.replaceChildren()
  say('')
  lens.showHints = !t.on
  lens.setPage({})
  market.reset()
  await t.before(market)
  if (id !== run) return
  // Only the free sandbox needs the shortcuts behind the glasses menu.
  backend = createBackend(market.ex, t.on ? [structuredClone(t.template.draft)] : [...VOICE_SEEDS, CLOSE_SEED])
  // during the scenario the price stops 1% short of liquidation: a fast drag cannot skip the alert window
  const long = market.positions.find(x => x.side === 'Buy')
  market.floor = long ? long.liqPrice * 1.01 : 0
  // A new query reloads the app even when only the hash would change; build-your-own opens the template in the editor.
  phone.src = `app.html?run=${id}${t.on ? '' : `#/shortcut/new?tpl=${t.template.id}`}`
  exchange.start()
  phase = t.on ? 'move' : 'add'
  note = missed = status = ''
  renderSteps()
}

play.onclick = () => void playMove(play)
$('restart').onclick = () => void open(tab, true)

// ── steps under the glasses ──
function renderSteps() {
  play.hidden = !tab.on || (phase !== 'add' && phase !== 'move')
  play.disabled = phase !== 'move' || gliding || !enabledShortcutId
  const order: Phase[] = tab.on ? ['move', 'answer', 'done'] : ['add', 'move', 'answer']
  // switched off on a tab where it starts on: the first step asks for it back
  const at = phase === 'done' ? order.length : phase === 'missed' || phase === 'executing' ? order.indexOf('answer')
    : phase === 'add' && tab.on ? 0 : order.indexOf(phase)
  stepsEl.replaceChildren(...tab.steps.map((text, i) => {
    const li = el('li', { className: i < at ? 'done' : i === at ? 'now' : '' }, el('span', { className: 'step-n' }, i < at ? '✓' : String(i + 1)), el('span', {}, text))
    if (i === at) li.setAttribute('aria-current', 'step')
    if (!tab.on && i === at && order[i] === 'move') {
      const play = el('button', { type: 'button', className: 'play', disabled: gliding }, el('span', { ariaHidden: 'true' }, '▶'), ' Play')
      play.onclick = () => void playMove(play)
      li.append(el('span', { className: 'or' }, 'or'), play)
    }
    if (i === at && phase === 'answer') li.append(el('kbd', {}, 'Down'), el('span', { className: 'or' }, 'then'), el('kbd', {}, 'Click'))
    if (i === at && phase === 'executing') li.append(el('span', { className: 'step-note' }, status))
    if (i === at && phase === 'add') li.append(el('span', { className: 'or' }, tab.on ? 'Switch the shortcut back on ← on the phone' : '← on the phone'))
    if (i === at && phase === 'missed') {
      const again = el('button', { type: 'button', className: 'play' }, '↺ Start over')
      again.onclick = () => void open(tab, true)
      li.className = 'now missed'
      li.append(el('span', { className: 'step-note' }, `Not done: ${missed}.`), again)
    }
    if (i === at && note && phase === 'move') li.append(el('span', { className: 'step-note' }, note))
    return li
  }))
  for (const g of ['down', 'tap']) document.querySelector(`[data-gesture="${g}"]`)?.classList.toggle('hint', phase === 'answer')
}

async function playMove(button: HTMLButtonElement) {
  const id = run
  const server = backend
  if (!server || gliding || phase !== 'move') return
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  gliding = true
  button.disabled = true
  try {
    const phoneLocation = phone.contentDocument?.location
    if (tab.on && enabledShortcutId && phoneLocation && (!phoneLocation.hash || phoneLocation.hash === '#/')) {
      spotlight('phone')
      phoneLocation.hash = shortcutHash(enabledShortcutId)
      if (!reduceMotion) await new Promise(r => setTimeout(r, 550)) // let the visitor see the rule open
    }
    if (id !== run || phase !== 'move') return
    spotlight('chart', true)
    if (reduceMotion) market.setPrice(tab.to)
    else await glide(tab.to, 2600, id)
    if (id !== run) return
    await server.tick()
    await new Promise(r => setTimeout(r, 1200)) // the steps poll catches an alert in this time
    // An edited rule, or a closed position: Play comes back with a reason.
    if (id === run && phase === 'move') note = 'It did not fire at this price. Drag the chart further, or Start over.'
  } finally {
    if (id === run) {
      gliding = false
      renderSteps()
    }
  }
}

/** Eases the price to `to`, one step a frame, so the chart, the server's polls and the lens all see the move. */
function glide(to: number, ms: number, id: number) {
  const from = market.price
  const t0 = performance.now()
  return new Promise<void>(done => {
    const frame = (now: number) => {
      if (id !== run) return done()
      const k = Math.min(1, (now - t0) / ms)
      market.setPrice(from + (to - from) * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2))
      if (k < 1) requestAnimationFrame(frame)
      else done()
    }
    requestAnimationFrame(frame)
  })
}

/** The steps follow the server: a shortcut exists, an alert is waiting for the glasses, it was answered. */
setInterval(async () => {
  const server = backend
  if (!server) return
  const id = run
  try {
    const get = (path: string) => server.fetch(path).then(r => r.json())
    type Tile = { id: string; enabled: boolean; voicePhrase?: string }
    const [shortcuts, alerts] = (await Promise.all([get('/api/shortcuts'), get('/api/history')])) as [Tile[], AlertRecord[]]
    if (id !== run) return
    // the tab's own rule: not the menu's voice shortcuts, and not a Test from the editor
    const own = shortcuts.filter(s => !s.voicePhrase)
    const alert = alerts.find(a => !a.simulated && own.some(s => s.id === a.shortcutId))
    // the app saves a new shortcut off: it counts once it is switched on
    enabledShortcutId = own.find(s => s.enabled)?.id
    const next: Phase = !enabledShortcutId && !alert ? 'add'
      : !alert ? 'move'
      : /^Waiting/.test(alert.status) ? 'answer'
      : /^(Sending|Submitted|Partly filled)/.test(alert.status) ? 'executing'
      : /^(Filled|Done|Shown|Logged)/.test(alert.status) ? 'done'
      : 'missed' // expired, dismissed, skipped, withdrawn, rejected: nothing happened on the exchange
    if (next === 'missed') missed = alert!.status.split(' · ')[0].toLowerCase()
    if (next === 'done' || next === 'missed') market.floor = 0 // the scenario is over: the market is free again
    const latest = alert?.status ?? ''
    if (tab.on && alert && !alert.skip) {
      if (alert.id !== currentAlertId && alert.matched.length) flashShortcut(alert.shortcutId, 'condition')
      if (next === 'done' && (phase !== 'done' || alert.id !== currentAlertId)) flashShortcut(alert.shortcutId, 'action')
    }
    currentAlertId = alert?.id
    spotlightAlert()
    if (next === 'add' && phase !== 'add') spotlight('phone')
    play.disabled = next !== 'move' || gliding || !enabledShortcutId
    if (next !== phase || latest !== status) {
      phase = next
      status = latest
      if (next !== 'move') note = ''
      renderSteps()
    }
  } catch { /* the tab is being replaced */ }
}, 400)

// ── glasses input: buttons, the lens itself, the keyboard ──
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-gesture]')) {
  b.onmousedown = e => e.preventDefault() // keep focus off the button, so Enter and the arrows still reach the glasses
  b.onclick = () => host.gesture(b.dataset.gesture as Gesture)
}
/** A gesture from the keyboard or the lens also flashes its ring button, so the visitor sees what they did. */
function press(g: Gesture) {
  host.gesture(g)
  const b = document.querySelector(`[data-gesture="${g}"]`)
  b?.classList.add('pressed')
  setTimeout(() => b?.classList.remove('pressed'), 160)
}
$('lens').onclick = () => press('tap')
const KEYS: Record<string, Gesture> = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'tap', ' ': 'tap', Escape: 'double', Backspace: 'double', m: 'menu' }
document.addEventListener('keydown', e => {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, select, button, canvas:not(#lens)') || e.metaKey || e.ctrlKey || e.altKey) return
  const g = KEYS[e.key]
  if (!g || (tab.on && g === 'menu')) return
  e.preventDefault()
  press(g)
})

const scenario = location.hash === '#sandbox' ? '#build' : location.hash
void open(TABS.find(t => `#${t.id}` === scenario) ?? TABS[0])
