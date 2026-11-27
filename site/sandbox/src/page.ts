/**
 * The sandbox page. The phone frame runs the real app (app.html: app/src/main.ts unchanged); this page plays the Even
 * app for it (host.ts, drawing the lens), runs the real server against a simulated exchange (backend.ts, market.ts),
 * and shows one scenario per tab (scenarios.ts).
 */
import './style.css'
import './sl/playback/buttons.css'
import './sl/playback/buttons.js'
import { CARD_SETTLE_MS, type RenderedAlert } from '../../../app/src/view.ts'
import { TEMPLATES } from '../../../server/src/registry.ts'
import type { AlertRecord, Position } from '../../../server/src/types.ts'
import { createBackend, type Backend } from './backend.ts'
import { mountExchange } from './exchange.ts'
import { createHost, type Gesture } from './host.ts'
import { Lens } from './lens.ts'
import { Market } from './market.ts'
import { BUILD_WATCHES, TABS, scenarioPhase, type Phase, type Tab } from './scenarios.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids)
  return e
}

const canvas = $<HTMLCanvasElement>('lens')
const lens = new Lens(canvas, () => {
  const boxes = lens.page.textObject ?? []
  const labels = boxes.filter(box => ['top', 'who', 'why', 'ask', 'terms', 'opt1', 'opt2'].includes(box.containerName))
    .map(box => box.content?.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const lines = (name: string) => boxes.find(box => box.containerName === name)?.content?.split('\n').map(line => line.replace(/\s+/g, ' ').trim()) ?? []
  const [names, selected, prices, losses, gains, risks] = ['name', 'cur', 'price', 'loss', 'gain', 'flag'].map(lines)
  for (let i = 0; i < Math.max(names.length, selected.length); i++) {
    const position = selected[i] || names[i]
    if (!position) continue
    const roi = losses[i] ? `ROI minus ${losses[i].replace(/^▼\s*/, '')}` : gains[i] ? `ROI plus ${gains[i].replace(/^▲\s*/, '')}` : ''
    labels.push([selected[i] ? `Selected: ${position.replace(/^▶\s*/, '')}` : position, prices[i] && `mark ${prices[i]}`, roi, risks[i]].filter(Boolean).join(', '))
  }
  const label = labels.length ? `Even G2 display. ${labels.join('. ')}` : 'Even G2 display'
  if (canvas.getAttribute('aria-label') !== label) canvas.setAttribute('aria-label', label)
  updateGestureHint()
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
      updateGestureHint()
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
setInterval(() => { if (backend && story !== 'paused') market.drift() }, 1000) // time passes: the chart moves on its own

const phone = $<HTMLIFrameElement>('phone')
const panel = $('panel')
const play = $<HTMLButtonElement>('scenario-play')
const restart = $<HTMLButtonElement>('restart')
const result = $('result')
const board = $('exchange')
type View = 'phone' | 'chart' | 'glasses'
const narrow = matchMedia('(max-width: 760px)')
const viewButtons = Array.from($('views').querySelectorAll<HTMLButtonElement>('button'))
const gestureButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-gesture]'))
type Story = 'idle' | 'running' | 'paused' | 'done'
let story: Story = 'idle'
/** Playback's cue before a real alert guides the steps. */
let guidedStep: number | undefined
const tabsEl = $('tabs')
const stepsEl = $('steps')
new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect
  if (!width) return
  const scale = width / 390
  phone.style.setProperty('--phone-scale', String(scale))
  phone.style.height = `${height / scale}px`
}).observe(phone.parentElement!)

let tab = TABS[0]
let phase: Phase = 'move'
let gliding = false
let enabledShortcutId: string | undefined
/** The guided tab's own rule. It starts off; Play is the thing that switches it on. */
let scenarioShortcutId: string | undefined
let currentAlertId: string | undefined
let renderedAlertId: string | undefined
let notifyAlert = false
let positionBefore: Position | undefined
let completionPauseUntil = 0
/** A line under the current step: why it is still there. */
let note = ''
/** How the tab's own alert ended, when it ended without the action. */
let missed = ''
let status = ''

const STAGE_PAUSE_MS = 1800
const RULE_REVIEW_MS = STAGE_PAUSE_MS
const GLIDE_MS = 4200
const GESTURE_BEAT_MS = 2400

function updateViewButtons() {
  const active = narrow.matches ? panel.dataset.view : panel.dataset.side
  for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === active))
}
function selectView(target: View) {
  panel.dataset.view = target
  if (target !== 'glasses') panel.dataset.side = target
  updateViewButtons()
  updateGestureHint()
}
for (const button of viewButtons) button.onclick = () => selectView(button.dataset.view as View)
narrow.addEventListener('change', updateViewButtons)

function spotlight(target: View) {
  if (!tab.on) return
  selectView(target)
  panel.dataset.spotlight = target
  document.body.dataset.spotlight = target
  document.body.classList.add('is-shade')
}

function releaseSpotlight() {
  document.body.classList.remove('is-shade')
  delete panel.dataset.spotlight
  delete document.body.dataset.spotlight
}

function spotlightAlert() {
  if (!tab.on || phase !== 'answer' || !currentAlertId || currentAlertId !== renderedAlertId || panel.dataset.spotlight === 'glasses') return
  const focused = document.activeElement
  spotlight('glasses')
  if (focused === phone || board.contains(focused)) canvas.focus({ preventScroll: true })
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
    const next = TABS[(i + d + TABS.length) % TABS.length]
    void open(next)
    $(`tab-${next.id}`).focus()
  }
  return b
})
tabsEl.append(...buttons)

/** A tab starts from scratch: a new account, the server, and the app reloaded on the phone. */
async function open(t: Tab, autoplay = false) {
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
  phase = t.on ? 'add' : 'move'
  guidedStep = undefined
  notifyAlert = false
  positionBefore = undefined
  result.hidden = true
  result.textContent = ''
  stepsEl.replaceChildren()
  completionPauseUntil = 0
  delete board.dataset.light
  delete board.dataset.position
  note = missed = status = ''
  panel.toggleAttribute('data-guided', t.on)
  releaseSpotlight()
  selectView('phone')
  selectView(t.on ? 'glasses' : 'chart')
  say('')
  renderSteps()
  lens.showHints = !t.on
  lens.setPage({})
  market.reset()
  await t.before(market)
  if (id !== run) return
  // Only the free sandbox needs the shortcuts behind the glasses menu. A guided rule starts off.
  backend = createBackend(market.ex, t.on ? [structuredClone(t.template.draft)] : BUILD_WATCHES, !t.on)
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
  renderSteps()
  if (autoplay && await until(id, phoneReady)) {
    renderSteps()
    play.click()
  }
}

restart.onclick = () => void open(tab)

function sleep(ms: number, id = run) {
  return new Promise<void>(resolve => {
    let left = ms
    let then = performance.now()
    const tick = () => {
      const now = performance.now()
      if (story !== 'paused') left -= now - then
      then = now
      if (left <= 0 || id !== run) resolve()
      else setTimeout(tick, Math.min(60, Math.max(left, 16)))
    }
    tick()
  })
}
async function until(id: number, ready: () => boolean, ms = 8000) {
  for (let left = ms; id === run && !ready() && left > 0; left -= 50) await sleep(50, id)
  return id === run && ready()
}
function phoneReady() {
  const doc = phone.contentDocument
  return !!doc && new URL(doc.URL).searchParams.get('run') === String(run)
    && !!doc.querySelector('main:not([hidden]) .nav')
}
function canPlay(at: Phase = phase) {
  if (gliding || !phoneReady()) return false
  if (tab.on) return !!scenarioShortcutId && (at === 'add' || at === 'move')
  return at === 'move' && !!enabledShortcutId
}

function syncPlayback() {
  play.hidden = !tab.on && phase !== 'move'
  play.disabled = story === 'idle' && !canPlay()
  play.dataset.restLabel = story === 'done' ? 'Replay' : story === 'paused' || story === 'running' ? 'Resume' : tab.on ? 'Play demo' : 'Move price'
  playback.setPlaying(story === 'running')
}

function renderSteps() {
  syncPlayback()
  restart.hidden = tab.on
  const answer = phase === 'answer'
  const step = phase === 'done' ? tab.steps.length - 1
    : phase === 'executing' && tab.on ? 3
    : answer || phase === 'missed' || phase === 'executing' ? 2
    : guidedStep ?? (story === 'idle' || phase === 'add' ? 0 : 1)
  const lastVisibleStep = Math.min(step, tab.steps.length - 1)
  const title = phase === 'missed' ? 'Scenario ended'
    : answer && notifyAlert ? 'Alert on the glasses'
    : answer ? 'Confirm on the glasses'
    : step === 0 && phase === 'move' && story === 'running' && tab.on ? 'Rule enabled'
    : tab.steps[step]
  const detail = phase === 'missed' ? missed : phase === 'executing' ? status : note

  for (let index = 0; index <= lastVisibleStep; index++) {
    let li = stepsEl.querySelector<HTMLLIElement>(`li[data-step-index="${index}"]`)
    if (!li) {
      li = el('li', {},
        el('span', { className: 'step-n' }),
        el('span', { className: 'step-title' }),
      )
      li.dataset.stepIndex = String(index)
      stepsEl.append(li)
    }
    const current = index === step && phase !== 'done'
    li.dataset.state = index < step || phase === 'done' ? 'complete' : 'current'
    if (current) li.setAttribute('aria-current', 'step')
    else li.removeAttribute('aria-current')
    li.querySelector('.step-n')!.textContent = String(index + 1)
    li.querySelector('.step-title')!.textContent = index === step ? title : tab.steps[index]

    let noteEl = li.querySelector<HTMLElement>('.step-note')
    if (current && (detail || answer)) {
      if (!noteEl) {
        noteEl = el('span', { className: 'step-note' })
        li.append(noteEl)
      }
      noteEl.id = answer ? 'gesture-hint' : ''
      noteEl.textContent = detail
    } else noteEl?.remove()
  }
  for (const li of stepsEl.querySelectorAll<HTMLLIElement>('li[data-step-index]')) {
    if (Number(li.dataset.stepIndex) > lastVisibleStep) li.remove()
  }
  updateGestureHint()
}

async function playMove() {
  const id = run
  const server = backend
  if (!server || story !== 'idle' || !canPlay()) return
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  story = 'running'
  gliding = true
  note = ''
  guidedStep = tab.on ? 0 : undefined
  renderSteps()
  try {
    if (tab.on) {
      spotlight('phone')
      const doc = phone.contentDocument
      const back = doc?.querySelector<HTMLButtonElement>('main:not([hidden]) [aria-label="Back to Shortcuts"]')
      const toggle = () => doc?.querySelector<HTMLButtonElement>('main:not([hidden]) .tile__switch')
      if (back) {
        await sleep(reduceMotion ? 0 : RULE_REVIEW_MS, id)
        if (id !== run) return
        back.click()
        if (!await until(id, () => !!toggle())) return
      }
      if (toggle()?.getAttribute('aria-checked') === 'false') {
        toggle()?.click()
        if (!await until(id, () => toggle()?.getAttribute('aria-checked') === 'true' && !toggle()?.hasAttribute('data-busy'))) return
      }
      await server.tick() // Price-change rules need one observation before the scripted move.
      if (id !== run) return
      guidedStep = 1
      renderSteps()
      spotlight('chart')
      await sleep(STAGE_PAUSE_MS, id)
      if (id !== run) return
    }
    server.hold(true)
    if (reduceMotion) market.setPrice(tab.to)
    else await glide(tab.to, GLIDE_MS, id)
    if (id !== run) return
    if (tab.on) {
      guidedStep = 2
      spotlight('glasses')
      renderSteps()
      await sleep(STAGE_PAUSE_MS, id)
      if (id !== run) return
    }
    server.hold(false)
    await server.tick()
    if (!await until(id, () => phase !== 'add' && phase !== 'move', 1500) && id === run) {
      note = 'The rule did not fire at this price. Drag the chart to try again.'
      selectView('chart')
    }
  } finally {
    server.hold(false)
    if (id === run) {
      gliding = false
      if (!tab.on || phase === 'add' || phase === 'move') {
        story = 'idle'
        guidedStep = undefined
        releaseSpotlight()
      }
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
      if (story === 'paused') {
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

function targetPosition(alert: AlertRecord) {
  const [kind, symbol, index] = alert.targetKey.split(':')
  if (kind === 'pos') return market.positions.find(p => p.symbol === symbol && String(p.positionIdx) === index)
}

function showResult(alert: AlertRecord) {
  const before = positionBefore
  const after = targetPosition(alert)
  const size = before && alert.actionType === 'CLOSE_POSITION' && before.size !== (after?.size ?? 0)
  const stops = before && after && (alert.actionType === 'MOVE_SL' || alert.actionType === 'SET_SL') && before.stopLoss !== after.stopLoss
  const price = (value: number) => value ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'
  result.textContent = size ? `Position size · ${before.size.toFixed(3)} → ${(after?.size ?? 0).toFixed(3)} BTC`
    : stops ? `Stop loss · ${price(before.stopLoss)} → ${price(after.stopLoss)} USDT`
    : alert.status
  result.hidden = false
  if (after && (size || stops)) {
    board.dataset.light = size ? 'size' : 'stops'
    board.dataset.position = String(after.positionIdx)
  }
  if (tab.on && (size || stops)) selectView('chart')
}

/** Follow the real alert and execution so the UI shows a result only once confirmed. */
setInterval(async () => {
  const server = backend
  if (!server) return
  const id = run
  try {
    const get = (path: string) => server.fetch(path).then(r => r.json())
    type Tile = { id: string; enabled: boolean; voicePhrase?: string }
    const [shortcuts, alerts] = (await Promise.all([get('/api/shortcuts'), get('/api/history')])) as [Tile[], AlertRecord[]]
    if (id !== run) return
    const own = shortcuts.filter(s => !s.voicePhrase)
    const alert = alerts.find(a => !a.simulated && own.some(s => s.id === a.shortcutId))
    enabledShortcutId = own.find(s => s.enabled)?.id
    const next = scenarioPhase(!!enabledShortcutId, alert?.status)
    const latest = alert?.status ?? ''
    const alertChanged = alert?.id !== currentAlertId
    if (phase === 'executing' && next === 'done' && performance.now() < completionPauseUntil) return
    if (next === phase && latest === status && !alertChanged) {
      if (story === 'idle') play.disabled = !canPlay()
      return
    }
    const entered = next !== phase || alertChanged
    phase = next
    status = latest
    currentAlertId = alert?.id
    notifyAlert = alert?.actionType === 'NOTIFY'
    if (next !== 'move') note = ''
    if (alert && alertChanged) {
      const position = targetPosition(alert)
      positionBefore = position && { ...position }
    }
    if (alert && next === 'answer' && entered) {
      spotlightAlert()
      if (tab.on && (story === 'running' || story === 'paused')) void answerGlasses(id, alert.id, notifyAlert)
    }
    if (next === 'executing' && entered && tab.on) {
      spotlight('chart')
      completionPauseUntil = performance.now() + STAGE_PAUSE_MS
    }
    if (alert && (next === 'done' || next === 'missed') && entered) {
      market.floor = 0
      story = 'done'
      guidedStep = undefined
      if (next === 'done') {
        showResult(alert)
        if (tab.on) {
          spotlight(alert.actionType === 'NOTIFY' ? 'glasses' : 'chart')
          const left = completionPauseUntil ? Math.max(0, completionPauseUntil - performance.now()) : STAGE_PAUSE_MS
          if (left) window.setTimeout(() => { if (id === run) releaseSpotlight() }, left)
          else releaseSpotlight()
        } else releaseSpotlight()
      } else {
        missed = alert.status
        releaseSpotlight()
      }
    }
    renderSteps()
  } catch { /* the tab is being replaced */ }
}, 400)

for (const b of gestureButtons) {
  b.onmousedown = e => e.preventDefault() // keep focus off the button, so Enter and the arrows still reach the glasses
  b.onclick = () => press(b.dataset.gesture as Gesture)
}
function selectedChoice() {
  if (phase !== 'answer' || !currentAlertId || renderedAlertId !== currentAlertId) return ''
  return lens.page.textObject?.find(box =>
    (box.containerName === 'opt1' || box.containerName === 'opt2') && box.content?.trim().startsWith('>'))?.content?.trim() ?? ''
}
function nextGesture(): Gesture | undefined {
  const choice = selectedChoice()
  return choice ? choice === '> Dismiss' ? 'down' : 'tap' : undefined
}
function updateGestureHint() {
  const next = nextGesture()
  for (const button of gestureButtons) button.classList.toggle('is-next', button.dataset.gesture === next)
  const hint = document.getElementById('gesture-hint')
  const action = next === 'down' ? 'Down to select the action'
    : next === 'tap' ? (notifyAlert ? 'Click to acknowledge' : 'Click to confirm') : 'Check the glasses'
  if (hint && hint.textContent !== action) hint.textContent = action
}

/** The automatic demo uses the same settled lens gestures as the visitor. */
async function answerGlasses(id: number, alertId: string, notify: boolean) {
  const current = () => id === run && phase === 'answer' && currentAlertId === alertId
  const readyToTap = () => notify ? selectedChoice() === '> OK' : /^>\s*(Close|Move|Set)\b/i.test(selectedChoice())
  const beat = matchMedia('(prefers-reduced-motion: reduce)').matches ? CARD_SETTLE_MS : GESTURE_BEAT_MS
  if (!await until(id, () => renderedAlertId === alertId && !!nextGesture()) || !current()) return
  await sleep(beat, id)
  if (!current() || renderedAlertId !== alertId) return
  if (nextGesture() === 'down') {
    press('down')
    if (!await until(id, () => readyToTap() || !current()) || !current()) return
    await sleep(beat, id)
  }
  if (current() && readyToTap()) press('tap')
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
    if (story === 'done') { void open(tab, true); return }
    if (story === 'idle') { if (playing) void playMove(); return }
    story = playing ? 'running' : 'paused'
    renderSteps()
  },
})
play.disabled = true

const scenario = { '#sandbox': '#build', '#profit': '#volume' }[location.hash] ?? location.hash
void open(TABS.find(t => `#${t.id}` === scenario) ?? TABS[0])
