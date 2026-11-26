/**
 * The sandbox page. The phone frame runs the real app (app.html: app/src/main.ts unchanged); this page plays the Even
 * app for it (host.ts, drawing the lens), runs the real server against a simulated exchange (backend.ts, market.ts),
 * and shows one scenario per tab (scenarios.ts).
 */
import './style.css'
import { CLOSE_SEED, VOICE_SEEDS } from '../../../server/src/registry.ts'
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

const lens = new Lens($<HTMLCanvasElement>('lens'))
const host = createHost(lens, () => say('The glasses would ask to close the app here. The sandbox keeps it open.'))
const market = new Market()
let backend: Backend

// What app-host.ts finds in the phone frame's parent.
;(window as unknown as { sandbox: object }).sandbox = {
  attach: host.attach,
  fetch: (input: RequestInfo | URL, init?: RequestInit) => backend.fetch(input, init),
}

const exchange = mountExchange($('exchange'), market)
setInterval(() => market.refresh(), 500) // the app's trades change FakeExchange directly: show them
setInterval(() => market.drift(), 1000) // time passes: the chart moves on its own

const phone = $<HTMLIFrameElement>('phone')
const tabsEl = $('tabs')
const stepsEl = $('steps')

// ── tabs ──
let run = 0
let tab = TABS[0]
/** Where the visitor is: add the shortcut, move the price, answer the alert, done; or the alert ended unanswered. */
type Phase = 'add' | 'move' | 'answer' | 'done' | 'missed'
let phase: Phase = 'move'
let gliding = false
/** A line under the current step: why it is still there. */
let note = ''
/** How the tab's own alert ended, when it ended without the action. */
let missed = ''

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
async function open(t: Tab) {
  const id = ++run
  tab = t
  history.replaceState(null, '', `#${t.id}`)
  for (const b of buttons) {
    const on = b.id === `tab-${t.id}`
    b.setAttribute('aria-selected', String(on))
    b.tabIndex = on ? 0 : -1
  }
  $('panel').setAttribute('aria-labelledby', `tab-${t.id}`)
  backend?.stop()
  market.reset()
  await t.before(market)
  if (id !== run) return
  // the glasses menu's commands (Protect all, Lock profits, Close all) need their shortcuts, as in `npm run demo`
  backend = createBackend(market.ex, [...(t.on ? [structuredClone(t.template.draft)] : []), ...VOICE_SEEDS, CLOSE_SEED])
  // during the scenario the price stops 1% short of liquidation: a fast drag cannot skip the alert window
  const long = market.positions.find(x => x.side === 'Buy')
  market.floor = long ? long.liqPrice * 1.01 : 0
  // A new query reloads the app even when only the hash would change; build-your-own opens the template in the editor.
  phone.src = `app.html?run=${id}${t.on ? '' : `#/shortcut/new?tpl=${t.template.id}`}`
  exchange.start()
  phase = t.on ? 'move' : 'add'
  gliding = false
  note = missed = ''
  renderSteps()
}

$('restart').onclick = () => void open(tab)

// ── steps under the glasses ──
function renderSteps() {
  const order: Phase[] = tab.on ? ['move', 'answer', 'done'] : ['add', 'move', 'answer']
  // switched off on a tab where it starts on: the first step asks for it back
  const at = phase === 'done' ? order.length : phase === 'missed' ? order.indexOf('answer') : phase === 'add' && tab.on ? 0 : order.indexOf(phase)
  stepsEl.replaceChildren(...tab.steps.map((text, i) => {
    const li = el('li', { className: i < at ? 'done' : i === at ? 'now' : '' }, el('span', { className: 'step-n' }, i < at ? '✓' : String(i + 1)), el('span', {}, text))
    if (i === at && order[i] === 'move') {
      const play = el('button', { type: 'button', className: 'play', disabled: gliding }, '▶ Play')
      play.onclick = () => void playMove(play)
      li.append(el('span', { className: 'or' }, 'or'), play)
    }
    if (i === at && phase === 'answer') li.append(el('kbd', {}, 'Down'), el('span', { className: 'or' }, 'then'), el('kbd', {}, 'Click'))
    if (i === at && phase === 'add') li.append(el('span', { className: 'or' }, tab.on ? 'Switch the shortcut back on ← on the phone' : '← on the phone'))
    if (i === at && phase === 'missed') {
      const again = el('button', { type: 'button', className: 'play' }, '↺ Start over')
      again.onclick = () => void open(tab)
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
  gliding = true
  button.disabled = true
  await glide(tab.to, 2600, id)
  if (id !== run) return
  await backend.tick()
  await new Promise(r => setTimeout(r, 1200)) // the steps poll catches an alert in this time
  if (id !== run) return
  gliding = false
  // the rule did not fire here (an edited rule, or the position was closed): Play comes back with a reason
  if (phase === 'move') note = 'It did not fire at this price. Drag the chart further, or Start over.'
  renderSteps()
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
  const id = run
  try {
    const get = (path: string) => backend.fetch(path).then(r => r.json())
    type Tile = { id: string; enabled: boolean; voicePhrase?: string }
    type Alert = { shortcutId: string; status: string; simulated?: boolean }
    const [shortcuts, alerts] = (await Promise.all([get('/api/shortcuts'), get('/api/history')])) as [Tile[], Alert[]]
    if (id !== run) return
    // the tab's own rule: not the menu's voice shortcuts, and not a Test from the editor
    const own = shortcuts.filter(s => !s.voicePhrase)
    const alert = alerts.find(a => !a.simulated && own.some(s => s.id === a.shortcutId))
    // the app saves a new shortcut off: it counts once it is switched on
    const next: Phase = !own.some(s => s.enabled) && !alert ? 'add'
      : !alert ? 'move'
      : /^Waiting/.test(alert.status) ? 'answer'
      : /^(Sending|Submitted|Filled|Partly|Done|Shown)/.test(alert.status) ? 'done'
      : 'missed' // expired, dismissed, skipped, withdrawn, rejected: nothing happened on the exchange
    if (next === 'missed') missed = alert!.status.split(' · ')[0].toLowerCase()
    if (next === 'done' || next === 'missed') market.floor = 0 // the scenario is over: the market is free again
    if (next !== phase) { phase = next; if (next !== 'move') note = ''; renderSteps() }
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
  if (!g) return
  e.preventDefault()
  press(g)
})

void open(TABS.find(t => `#${t.id}` === location.hash) ?? TABS[0])
