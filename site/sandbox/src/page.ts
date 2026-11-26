/**
 * The sandbox page. The phone frame runs the real app (app.html: app/src/main.ts unchanged); this page plays the Even
 * app for it (host.ts, drawing the lens), runs the real server against a simulated exchange (backend.ts, market.ts),
 * and shows one scenario per tab (scenarios.ts).
 */
import './style.css'
import './sl/playback/buttons.css'
import './sl/playback/buttons.js'
import type { RenderedAlert } from '../../../app/src/view.ts'
import { TEMPLATES } from '../../../server/src/registry.ts'
import type { AlertRecord } from '../../../server/src/types.ts'
import { createBackend, type Backend } from './backend.ts'
import { mountExchange } from './exchange.ts'
import { createHost, type Gesture } from './host.ts'
import { Lens } from './lens.ts'
import { Market } from './market.ts'
import { BUILD_WATCHES, TABS, type Tab } from './scenarios.ts'
import { transcript } from './voice.ts'

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
const host = createHost(lens, () => say('The glasses would ask to close the app here. The sandbox keeps it open.'), { voice: true })
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
panel.addEventListener('pointerdown', () => { void host.allowMic() }, { capture: true })
const play = $<HTMLButtonElement>('scenario-play')
const actions = $('story-actions')
const replay = $<HTMLButtonElement>('scenario-replay')
type Story = 'idle' | 'running' | 'paused' | 'done'
let story: Story = 'idle'
let paused = false
/** Guided step on screen: 0 setup, 1 trigger, 2 alert, 3 the exchange. It lags the server so each stage can rest. */
let guidedStep = 0
let exchangeShown = false
let stagesDone = false
/** The other scenarios stay hidden until this story reaches Replay. */
let moreStories = false
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
/** The guided tab's own rule. It starts off; Play is the thing that switches it on. */
let scenarioShortcutId: string | undefined
let currentAlertId: string | undefined
let renderedAlertId: string | undefined
/** A line under the current step: why it is still there. */
let note = ''
/** How the tab's own alert ended, when it ended without the action. */
let missed = ''
let status = ''

const spotlightTargets = { phone: play, chart: $('exchange'), glasses: panel.querySelector('.glasses')! }
const BEAT_MS = 3400
const GLIDE_MS = 4200
/** Hold the finished stage on screen before the next one begins. Long enough to see what just happened. */
const STAGE_PAUSE_MS = 4000
/** Read the lens line, then the ring button, before the demo presses it. */
const GESTURE_BEAT_MS = 2800
/** How long a result ring stays. The phone's own frame lasts the whole opening stage. */
const RING_MS = 2800
let shadeGen = 0
let ringTimer = 0
function clearRing() {
  clearTimeout(ringTimer)
  for (const old of document.querySelectorAll('.is-ring')) old.classList.remove('is-ring')
}
/** An amber frame on one result, then it goes. A later ring replaces the earlier one. */
function ring(el: Element | null | undefined, ms = RING_MS) {
  clearRing()
  if (!el) return
  el.classList.add('is-ring')
  ringTimer = window.setTimeout(clearRing, ms)
}
function spotlight(target: keyof typeof spotlightTargets, reveal = false) {
  if (!tab.on) return
  shadeGen++
  panel.dataset.spotlight = target
  document.body.dataset.spotlight = target
  document.body.classList.add('is-shade')
  void reveal
}
/** The story is over: the dimming fades, then the frames drop back into the page. */
function releaseShade() {
  if (!document.body.classList.contains('is-shade')) return
  const id = run
  const token = ++shadeGen
  document.body.classList.remove('is-shade')
  const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700
  window.setTimeout(() => {
    if (token !== shadeGen || id !== run) return
    delete panel.dataset.spotlight
    delete document.body.dataset.spotlight
    clearRing()
    delete $('exchange').dataset.light
  }, ms)
}

function spotlightAlert() {
  if (!tab.on || phase === 'executing' || phase === 'done' || phase === 'missed') return
  if (currentAlertId && currentAlertId === renderedAlertId && panel.dataset.spotlight !== 'glasses') {
    spotlight('glasses', true)
    // Back and the switch leave the keys inside the phone. Hand them to the glasses with the alert.
    const focused = document.activeElement
    if (focused === phone || spotlightTargets.chart.contains(focused)) canvas.focus({ preventScroll: true })
  }
}

const shortcutHash = (id: string) => `#/shortcut/${encodeURIComponent(id)}`

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
    if (!moreStories) return
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
  enabledShortcutId = scenarioShortcutId = currentAlertId = renderedAlertId = undefined
  story = 'idle'
  paused = false
  guidedStep = 0
  exchangeShown = false
  stagesDone = false
  delete play.dataset.restLabel
  clearRing()
  delete $('exchange').dataset.light
  shadeGen++
  document.body.classList.remove('is-shade')
  delete panel.dataset.spotlight
  delete document.body.dataset.spotlight
  if (revealPhone) actions.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  stepsEl.replaceChildren()
  say('')
  lens.showHints = !t.on
  lens.setPage({})
  market.reset()
  await t.before(market)
  if (id !== run) return
  // Only the free sandbox needs the shortcuts behind the glasses menu. A guided rule starts off.
  backend = createBackend(market.ex, t.on ? [structuredClone(t.template.draft)] : BUILD_WATCHES, !t.on, () => transcript())
  // during the scenario the price stops 1% short of liquidation: a fast drag cannot skip the alert window
  const long = market.positions.find(x => x.side === 'Buy')
  market.floor = long ? long.liqPrice * 1.01 : 0
  let route = ''
  if (t.on) {
    const list = await backend.fetch('/api/shortcuts').then(r => r.json()) as { id: string; voicePhrase?: string }[]
    if (id !== run) return
    scenarioShortcutId = list.find(s => !s.voicePhrase)?.id
    if (scenarioShortcutId) route = shortcutHash(scenarioShortcutId)
  }
  // A new query reloads the app even when only the hash would change.
  phone.src = `app.html?run=${id}${route}`
  exchange.start()
  phase = t.on ? 'add' : 'move'
  note = missed = status = ''
  playback.setPlaying(false)
  renderSteps()
}

$('restart').onclick = () => void open(tab, true)
replay.onclick = () => void open(tab, true)

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    let left = ms
    let then = performance.now()
    const tick = () => {
      const now = performance.now()
      if (!paused) left -= now - then
      then = now
      if (left <= 0) resolve()
      else setTimeout(tick, Math.min(60, Math.max(left, 16)))
    }
    tick()
  })
}
async function until(id: number, ready: () => boolean, ms = 8000) {
  const start = performance.now()
  while (id === run && !ready() && performance.now() - start < ms) await sleep(50)
  return id === run && ready()
}
function phoneReady() {
  return !!phone.contentDocument?.querySelector('main:not([hidden]) .nav')
}
function canPlay(at: Phase = phase) {
  if (gliding || !phoneReady()) return false
  if (tab.on) return !!scenarioShortcutId && (at === 'add' || at === 'move')
  return at === 'move' && !!enabledShortcutId
}

// ── steps under the glasses ──
function renderSteps() {
  actions.hidden = !tab.on
  actions.classList.toggle('is-split', story === 'running' || story === 'paused')
  actions.classList.toggle('is-replay', story === 'done')
  if (story === 'running' || story === 'paused') play.dataset.restLabel = 'Resume'
  else delete play.dataset.restLabel
  if (story === 'idle') play.disabled = !canPlay()
  const order: Phase[] = tab.on ? ['move', 'answer', 'done'] : ['add', 'move', 'answer']
  const at = tab.on
    ? phase === 'missed' ? 2
      : stagesDone ? tab.steps.length
      : guidedStep
    : phase === 'done' ? order.length : phase === 'missed' || phase === 'executing' ? order.indexOf('answer')
      : order.indexOf(phase)
  stepsEl.replaceChildren(...tab.steps.map((text, i) => {
    const li = el('li', { className: i < at ? 'done' : i === at ? 'now' : '' }, el('span', { className: 'step-n' }, i < at ? '✓' : String(i + 1)), el('span', {}, text))
    if (i === at) li.setAttribute('aria-current', 'step')
    if (!tab.on && i === at && order[i] === 'move') {
      const play = el('button', { type: 'button', className: 'play', disabled: gliding }, el('span', { ariaHidden: 'true' }, '▶'), ' Play')
      play.onclick = () => void playMove(play)
      li.append(el('span', { className: 'or' }, 'or'), play)
    }
    if (i === at && phase === 'answer') {
      li.append(el('kbd', {}, 'Say yes'), el('span', { className: 'or' }, 'or'), el('kbd', {}, 'Down'), el('span', { className: 'or' }, 'then'), el('kbd', {}, 'Click'))
      if (!host.micDenied()) li.append(el('span', { className: 'step-note' }, 'Heard in this tab. The browser turns the word into text.'))
    }
    if (i === at && phase === 'executing') li.append(el('span', { className: 'step-note' }, status))
    if (i === at && phase === 'add' && !tab.on) li.append(el('span', { className: 'or' }, '← on the phone'))
    if (i === at && phase === 'missed') {
      const again = el('button', { type: 'button', className: 'play' }, '↺ Start over')
      again.onclick = () => void open(tab, true)
      li.className = 'now missed'
      li.append(el('span', { className: 'step-note' }, `Not done: ${missed}.`), again)
    }
    if (i === at && note && phase === 'move') li.append(el('span', { className: 'step-note' }, note))
    return li
  }))
}

async function playMove(button: HTMLButtonElement) {
  void host.allowMic() // in this click, so the prompt is up before the alert opens the mic
  const id = run
  const server = backend
  if (!server || story !== 'idle' || !canPlay()) return
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const look = reduceMotion ? 0 : BEAT_MS
  story = 'running'
  play.dataset.restLabel = 'Resume'
  gliding = true
  if (button !== play) button.disabled = true
  renderSteps()
  try {
    if (tab.on) spotlight('phone') // the amber frame is the opening: look here
    if (tab.on && scenarioShortcutId) {
      const doc = phone.contentDocument
      const back = doc?.querySelector<HTMLButtonElement>('main:not([hidden]) [aria-label="Back to Shortcuts"]')
      if (back) {
        spotlight('phone')
        await sleep(look)
        if (id !== run) return
        back.click()
        await until(id, () => !!doc?.querySelector('main[aria-label="Shortcuts"]:not([hidden]) .tile__switch'))
        if (id !== run) return
      }
      const sw = doc?.querySelector<HTMLButtonElement>('main:not([hidden]) .tile__switch[aria-checked="false"]')
      if (sw) {
        spotlight('phone')
        await sleep(reduceMotion ? 0 : 1100)
        if (id !== run) return
        sw.click()
        const on = await until(id, () => {
          const box = doc?.querySelector('.tile__switch')
          return box?.getAttribute('aria-checked') === 'true' && !box.hasAttribute('data-busy')
        })
        if (!on) return
        if (!reduceMotion) await sleep(500)
        if (id !== run) return
      }
    }
    if (id !== run) return
    await sleep(reduceMotion ? 0 : STAGE_PAUSE_MS) // stage 1 rests before the trigger
    if (id !== run) return
    guidedStep = 1
    renderSteps()
    server.hold(true) // the price may reach the trigger; the alert waits until the glasses have the room
    spotlight('chart', true)
    if (reduceMotion) market.setPrice(tab.to)
    else await glide(tab.to, GLIDE_MS, id)
    if (id !== run) return
    ring(document.querySelector('.exchange-col > .phone')) // the price has reached the line
    await sleep(reduceMotion ? 0 : STAGE_PAUSE_MS) // the trigger stays on the chart
    if (id !== run) return
    guidedStep = 2
    renderSteps()
    spotlight('glasses', true)
    await sleep(reduceMotion ? 0 : STAGE_PAUSE_MS) // the glasses are in view before the alert exists
    if (id !== run) return
    server.hold(false)
    await server.tick()
    await sleep(reduceMotion ? 400 : 800) // the steps poll catches an alert in this time
    // An edited rule, or a closed position: Play comes back with a reason.
    if (id === run && phase === 'move') note = 'It did not fire at this price. Drag the chart further, or Start over.'
  } finally {
    server.hold(false)
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
  let hold = 0
  let heldAt = 0
  return new Promise<void>(done => {
    const frame = (now: number) => {
      if (id !== run) return done()
      if (paused) {
        if (!heldAt) heldAt = now
        requestAnimationFrame(frame)
        return
      }
      if (heldAt) { hold += now - heldAt; heldAt = 0 }
      const k = Math.min(1, (now - t0 - hold) / ms)
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
    currentAlertId = alert?.id
    spotlightAlert()
    if (next === 'answer' && phase !== 'answer') {
      if (host.micDenied()) say('Microphone blocked. Down, then Click still confirms.')
      if (tab.on) void answerGlasses(id)
    }
    if (next === 'add' && phase !== 'add') spotlight('phone')
    if (tab.on && (next === 'executing' || next === 'done') && !exchangeShown) {
      exchangeShown = true
      const finished = id
      void (async () => {
        await sleep(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : STAGE_PAUSE_MS)
        if (finished !== run) return
        const filled = await until(finished, () => phase === 'done' || phase === 'missed', 12_000)
        if (!filled || phase !== 'done') return
        guidedStep = 3
        renderSteps()
        spotlight('chart', true)
        const field = tab.id === 'profit' ? 'stops' : 'size'
        const board = $('exchange')
        board.dataset.light = field
        window.setTimeout(() => { if (board.dataset.light === field) delete board.dataset.light }, STAGE_PAUSE_MS)
      })()
    }
    if ((next === 'done' || next === 'missed') && phase !== next) {
      story = 'done'
      moreStories = true
      tabsEl.classList.add('is-open')
      paused = false
      const finished = run
      window.setTimeout(() => {
        if (finished !== run) return
        stagesDone = true
        renderSteps()
        releaseShade()
      }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : STAGE_PAUSE_MS + 1800)
    }
    if (story === 'idle') play.disabled = !canPlay(next)
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
  b.onclick = () => press(b.dataset.gesture as Gesture)
}
let answering = false
/** The visitor does not have to hunt for Down and Click: show each, then press it. A spoken yes answers first. */
async function answerGlasses(id: number) {
  if (answering || id !== run || tab.voice) return
  answering = true
  try {
    const beat = matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : GESTURE_BEAT_MS
    const label = () => canvas.getAttribute('aria-label') ?? ''
    await until(id, () => /Dismiss/i.test(label()))
    if (id !== run || phase !== 'answer') return
    // The mic opens with the card, after its blink. Wait for a yes before pressing anything.
    await until(id, () => host.voiceBusy() || phase !== 'answer', 5000)
    if (id !== run || phase !== 'answer') return
    if (host.voiceBusy()) {
      await until(id, () => !host.voiceBusy() || phase !== 'answer', 16_000)
      if (id !== run || phase !== 'answer' || host.voiceBusy()) return
    }
    if (!/>\s*(Close|Move|Set)/i.test(label())) {
      ring(document.querySelector('[data-gesture="down"]'))
      await sleep(beat)
      if (id !== run || phase !== 'answer' || host.voiceBusy()) return
      // The card ignores the first gesture while it is still settling.
      for (let i = 0; i < 3 && id === run && phase === 'answer' && !host.voiceBusy() && !/>\s*(Close|Move|Set)/i.test(label()); i++) {
        press('down')
        await sleep(500)
      }
      if (id !== run || phase !== 'answer' || host.voiceBusy() || !/>\s*(Close|Move|Set)/i.test(label())) return
    }
    clearRing() // the choice is selected; Click stays dark until the line has been read
    await sleep(beat)
    if (id !== run || phase !== 'answer' || host.voiceBusy()) return
    ring(document.querySelector('[data-gesture="tap"]'))
    await sleep(beat)
    if (id !== run || phase !== 'answer' || host.voiceBusy()) return
    press('tap')
  } finally {
    answering = false
  }
}
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

type Playback = { setPlaying(value: boolean): void; reset(): void; destroy(): void }
const playback = (window as unknown as { MattePlayback: { mount(button: HTMLButtonElement, opts?: { onChange?: (detail: { playing: boolean }) => void }): Playback } }).MattePlayback.mount(play, {
  onChange({ playing }) {
    if (story === 'idle') {
      if (!playing) return
      if (!canPlay()) playback.setPlaying(false)
      else void playMove(play)
      return
    }
    if (story === 'running' && !playing) { paused = true; story = 'paused'; renderSteps(); return }
    if (story === 'paused' && playing) { paused = false; story = 'running'; renderSteps() }
  },
})
play.disabled = true

const scenario = location.hash === '#sandbox' ? '#build' : location.hash
if (scenario && scenario !== '#liquidation') {
  moreStories = true
  tabsEl.classList.add('is-open')
}
void open(TABS.find(t => `#${t.id}` === scenario) ?? TABS[0])
