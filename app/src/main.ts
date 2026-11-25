import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  AudioInputSource,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { Candle, ExecutionStatus, Proposal, ServerState } from '../../server/src/types.ts'
import { previewText, screen, rankPositions, clampFocus, type Layout, type Outcome, type Screen } from './view.ts'
import * as api from './api.ts'
import { png, svg, chartPng, titlePng, type IconName } from './icons.ts'
import { startPhonePage } from './phone/index.ts'
import { LIFECYCLE, createDedupe, exitStep, type Exit } from './lifecycle.ts'
import { WearTracker } from './wear.ts'

const POLL_MS = 1000
const BRIDGE_TIMEOUT_MS = 10_000
const SETTINGS_WAIT_MS = 1500 // how long the first request waits for the bridge's storage; a plain browser has none
const EXIT_WAIT_MS = 3000 // the exit dialogue shows ~100 ms after the request; past this it never will
const LISTEN_MS = 5000
const COUNTDOWN_MS = 5000 // after a spoken yes, before the confirm goes out: any gesture or a "no" stops it
const COUNTDOWN_LISTEN_MS = 3500 // the mic closes early so a "no" is transcribed before the countdown ends
const MIN_AUDIO_BYTES = 9600 // 0.3 s of 16 kHz s16le
const NOTE_MS = 5000
// shortcut: a fixed guess, measure how long the lens takes to redraw on real glasses and tune it
const CARD_SETTLE_MS = 1000
const PAUSE_MS = 15 * 60_000
const BLINK_MS = 400 // one on/off step of the new-alert blink (matic-even H1 used 400 ms)
const SWIPE_GATE_MS = 700 // one long swipe arrives as several scroll events (matic-even H12)
const CURSOR_IDLE_MS = 8000 // `>` left on an action goes back to Dismiss: a stray swipe must not arm the next tap
// shortcut: the state has no status for a card that left the queue, so one that leaves this close to its expiry counts as expired
// (server tick 2 s + lens poll 1 s); ask the server for the card's last status if a withdrawn card must say why
const EXPIRY_SLACK_MS = 3000
/** Results that no longer change: polling the execution stops. */
const FINAL: ExecutionStatus[] = ['FILLED', 'APPLIED', 'REJECTED', 'SIMULATED']
/** Results that went through: the lens goes back to Main on its own after NOTE_MS. */
const DONE: ExecutionStatus[] = ['FILLED', 'APPLIED']
/** How long a done result waits for its receipt (the server reads Bybit's position on its next 2 s poll). */
const RECEIPT_WAIT_MS = 6000
/** When the result on the lens turned done; 0 until then. */
let doneAt = 0
/** Polling the execution stops at a final status, and for a done one once its receipt is in or RECEIPT_WAIT_MS passed. */
const settled = (o: Outcome) => {
  const e = o.execution
  if (!e || !FINAL.includes(e.status)) return false
  return !DONE.includes(e.status) || !!e.receipt || (doneAt > 0 && Date.now() - doneAt > RECEIPT_WAIT_MS)
}

let state: ServerState | null = null
let offline = false
let pageSince = 0
let pausedUntil = 0
let needToken = false
let focus = 0
/** The focused position as symbol:positionIdx: the list is re-sorted every poll, so an index alone drifts to another coin. */
let focusKey = ''
let detailOpen = false
let lastSwipe = 0
let blinked = ''
let listenEnds = 0
let listenMs = LISTEN_MS
/** The alert the open mic is listening for; its answer only counts while that alert is still on the lens. */
let listenFor = ''
let countdown: { card: Proposal; ends: number } | null = null
let countdownTimer: ReturnType<typeof setInterval> | undefined
let bridge: EvenAppBridge | null = null
let exiting: Exit = 'none'
const repeated = createDedupe()
/** Resolves once the settings are read from the bridge, or the bridge turned out to be absent. */
let settingsLoaded!: () => void
const settingsReady = Promise.race([new Promise<void>(r => (settingsLoaded = r)), new Promise(r => setTimeout(r, SETTINGS_WAIT_MS))])
/** Page on the lens, from pageKey(); '' means unknown, so the next draw rebuilds. */
let page = ''
let shown: Record<string, string> = {}
/** Brightness the lens draws each box at right now, like `shown` for text. */
let shownTone: Record<string, number> = {}
let shownIcon = ''
/** The choices on the lens: when they change, the page counts as new for CARD_SETTLE_MS (a tap meant for "Sent" must not hit OK). */
let shownChoices = ''
/** After the user said Yes in the exit dialogue: nothing more goes to the lens until it comes back. */
let quit = false
let outcome: Outcome | null = null
let execId = ''
let review = ''
/** An Open's size, picked on its size page; the leverage page comes next */
let pick: { id: string; size: number } | undefined
let picking = false
let hide = ''
let cursor = { key: '', at: 0 }
let mic: 'off' | 'starting' | 'on' | 'stopping' | 'sending' = 'off'
let micAttempt = 0
let audio: Uint8Array[] = []
let listenTimer: ReturnType<typeof setTimeout> | undefined
let voiceNote = { text: '', until: 0 }
const note = (text: string, ms = NOTE_MS) => { voiceNote = { text, until: Date.now() + ms } }
const pausedMin = () => Math.max(0, Math.ceil((pausedUntil - Date.now()) / 60_000))
/** The server has no speech key: the menu loses Speak (a rebuild sets the menu, so it is part of the page key). */
const noVoice = () => state?.voice === false
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const CALL_MS = 3000 // a BLE reply can get lost; without a cap one lost reply froze the lens for good
/** A bridge call that does not answer in time counts as failed, so the next draw can try again. */
const timed = <T>(call: Promise<T>, ms = CALL_MS) =>
  Promise.race([call, sleep(ms).then((): never => { throw new Error('No reply from the glasses') })])
let queue: Promise<unknown> = Promise.resolve()
/**
 * Every bridge call goes through here, one at a time (glasses-ui: concurrent render and storage calls can drop the link).
 * The cap counts from when the call starts, not from when it was queued.
 * shortcut: a timed-out call is not cancelled, so the next one may overlap a late reply; the SDK has no cancel
 */
function call<T>(f: () => Promise<T>, ms = CALL_MS): Promise<T> {
  const run = queue.then(() => timed(f(), ms))
  queue = run.catch(() => {})
  return run
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// ── glasses ────────────────────────────────────────────────

/** `capture`: the one box that takes input; it holds one line, so a swipe has nothing to scroll. */
type Box = { name: string; x: number; y: number; w: number; h: number; capture?: true }
// docs/glasses-shortcuts.md §4: 8 px grid, 16 px edge inset, 27 px a text line. Padding is 2 px, not the spec's 4:
// a 32 px box with 4 px padding is shorter than a line, and the simulator draws a scroll bar on it. Widths match view.ts INNER_PX.
const HINT: Box = { name: 'hint', x: 16, y: 248, w: 544, h: 32 }
const LAYOUTS: Record<Layout, Box[]> = {
  // A header-less table, one box per column so rows line up; losses and gains are separate boxes, so a loss can be brighter.
  main: [
    { name: 'top', x: 16, y: 16, w: 544, h: 32, capture: true },
    { name: 'name', x: 16, y: 56, w: 144, h: 144 },
    { name: 'cur', x: 16, y: 56, w: 144, h: 144 }, // the selected row's name, brighter, in the same column
    { name: 'price', x: 160, y: 56, w: 128, h: 144 },
    { name: 'loss', x: 288, y: 56, w: 104, h: 144 },
    { name: 'gain', x: 288, y: 56, w: 104, h: 144 },
    { name: 'flag', x: 392, y: 56, w: 168, h: 144 },
    HINT,
  ],
  // Big coin and side left (TITLE_AT), PnL as big right (PNL_AT) with the stop and liq distances under it, the hour under them (CHART_AT): glasses-shortcuts §4.
  detail: [
    { name: 'lev', x: 16, y: 56, w: 272, h: 32, capture: true },
    { name: 'table', x: 320, y: 56, w: 240, h: 32 },
    HINT,
  ],
  // The frame is the notification; declared first, so it sits behind the text it holds. The choices sit under it.
  alert: [
    { name: 'frame', x: 16, y: 16, w: 544, h: 96 },
    { name: 'who', x: 96, y: 32, w: 384, h: 32 },
    { name: 'why', x: 96, y: 64, w: 384, h: 32 },
    { name: 'queue', x: 480, y: 24, w: 72, h: 32 },
    { name: 'opt1', x: 16, y: 136, w: 544, h: 32, capture: true },
    { name: 'opt2', x: 16, y: 168, w: 544, h: 32 },
    HINT,
  ],
  review: [
    { name: 'frame', x: 16, y: 16, w: 544, h: 112 },
    { name: 'ask', x: 96, y: 24, w: 456, h: 32 },
    { name: 'terms', x: 96, y: 56, w: 456, h: 64 },
    { name: 'opt1', x: 16, y: 152, w: 544, h: 32, capture: true },
    { name: 'opt2', x: 16, y: 184, w: 544, h: 32 },
    HINT,
  ],
}
const ICON_AT: Partial<Record<Layout, { x: number; y: number }>> = { alert: { x: 32, y: 40 }, review: { x: 32, y: 48 } }
const TITLE_AT = { x: 16, y: 12, w: 288, h: 44 }
const PNL_AT = { x: 320, y: 12, w: 240, h: 44 } // its left edge lines up with the distances under it
/** Detail's last hour across the lens; two slices, since one image is at most 288 × 144. */
const CHART_AT = { x: 16, y: 96, w: 544, h: 144 }
const CHART_SLICE = 272
/** The server reads new closes at most once a minute, so asking more often gets the same ones. */
const CHART_MS = 60_000
const PAD = 2
const FRAME_COLOR = 11 // brightness 3 of 4 on the border's 0–15 scale, like the text it holds
const MENU_PAUSE = 1
// 2 was Speak, hidden with the voice phrases
const MENU_PROTECT = 3
const MENU_LOCK = 4
const MENU_CLOSE = 5 // Detail: the position on the lens
const MENU_CLOSE_ALL = 6
const NAMES = Object.values(LAYOUTS).flat().map(b => b.name).filter((n, i, all) => all.indexOf(n) === i)
const idOf = (name: string) => 1 + NAMES.indexOf(name)
const ICON = { id: NAMES.length + 1, name: 'icon', px: 48 } // after the text ids, so a new box can never take an image's id
const CHART = [0, 1].map(i => ({ id: NAMES.length + 2 + i, name: `chart${i}`, dx: i * CHART_SLICE }))
const TITLE = { id: NAMES.length + 4, name: 'title' }
const PNL = { id: NAMES.length + 5, name: 'pnl' }

/** Ten cells, full at the start, empty when the time is up. */
const bar = (leftMs: number, totalMs: number) => {
  const on = Math.max(0, Math.min(10, Math.ceil((leftMs / totalMs) * 10)))
  return '━'.repeat(on) + '─'.repeat(10 - on)
}
/** The countdown after a spoken yes, the open mic's bar, or the latest voice or menu note. */
function voiceText(): string {
  if (countdown) {
    const left = countdown.ends - Date.now()
    return `Sending in ${Math.max(0, Math.ceil(left / 1000))}  ${bar(left, COUNTDOWN_MS)}  tap or say no: stop`
  }
  if (mic === 'on') return `● Say yes or no  ${bar(listenEnds - Date.now(), listenMs)}`
  return Date.now() < voiceNote.until ? voiceNote.text : ''
}

const posKey = (p: { symbol: string; positionIdx: number }) => `${p.symbol}:${p.positionIdx}`
/** Where the focused position sits in today's order; the old index when it is gone. */
function focusIndex(): number {
  const ranked = state ? rankPositions(state.positions) : []
  const i = ranked.findIndex(p => posKey(p) === focusKey)
  return i >= 0 ? i : clampFocus(focus, ranked.length)
}
const current = () => screen(state, {
  offline, voice: voiceText(), pausedMin: pausedMin(), focus: focusIndex(), detail: detailOpen, needToken, hints: api.hintsOn(), now: Date.now(),
  outcome: outcome ?? undefined, review, pick, hide, cursor,
})
/** A new key needs a rebuild: another layout or card, and a rebuild is the only way to set the menu. */
const pageKey = (sc: Screen) => `${sc.layout}:${sc.key}:${pausedMin() > 0 ? 'paused' : ''}${noVoice() ? ':novoice' : ''}`

/** Container name → content. A blank is ' ': an empty string is not a safe update. */
function boxText(sc: Screen): Record<string, string> {
  return Object.fromEntries(LAYOUTS[sc.layout].map(b => [b.name, sc.text[b.name] || ' ']))
}

/** Tap then long press opens this menu (Even Hub docs, Contextual Menu). Labels stay under 16 characters, verbs first (Even Hub docs). */
// Each close is a card to confirm, by tap or a spoken yes, like every other trade.
const menu = (on: Layout) => new MenuContainerProperty({
  menuItems: [
    ...(on === 'detail' ? [new MenuItemProperty({ itemID: MENU_CLOSE, itemName: 'Close position' })] : []),
    new MenuItemProperty({ itemID: MENU_PROTECT, itemName: 'Protect all' }),
    new MenuItemProperty({ itemID: MENU_LOCK, itemName: 'Lock profits' }),
    ...(on === 'main' ? [new MenuItemProperty({ itemID: MENU_CLOSE_ALL, itemName: 'Close all' })] : []),
    new MenuItemProperty({ itemID: MENU_PAUSE, itemName: pausedMin() > 0 ? 'Resume cards' : 'Pause 15 min' }),
    // shortcut: Speak (voice phrases) is hidden while voice only answers alerts; add it back with the phrases
  ],
})

/** Hard on/off blink of a new alert's first line: the glasses have no speaker, and this is what catches the eye (matic-even H1). */
async function blink(who: string) {
  const set = async (textColor: number) => {
    delete shownTone.who // a lost response can leave the line at either brightness
    if (!(await call(() => bridge!.textContainerUpgrade(new TextContainerUpgrade({ containerID: idOf('who'), containerName: 'who', content: who, textColor, contentOffset: 0, contentLength: 0 }))))) {
      throw new Error('Glasses rejected alert brightness')
    }
    shownTone.who = textColor
  }
  try {
    for (let i = 0; i < 2; i++) { await set(0); await sleep(BLINK_MS); await set(4); await sleep(BLINK_MS) }
  } catch {
    await set(4).catch(() => {}) // never leave the line dark
  }
}

/** The whole page with its text already in it: rebuilding and then updating would show two jumps. */
function layout(sc: Screen, text: Record<string, string>) {
  const boxes = LAYOUTS[sc.layout]
  const at = ICON_AT[sc.layout]
  const big = sc.layout === 'detail' // the title and the chart
  return {
    containerTotalNum: boxes.length + (at ? 1 : 0) + (big ? 2 + CHART.length : 0),
    textObject: boxes.map(b => new TextContainerProperty({
      xPosition: b.x, yPosition: b.y, width: b.w, height: b.h, paddingLength: PAD,
      ...(b.name === 'frame' ? { borderWidth: 2, borderColor: FRAME_COLOR, borderRadius: 4 } : { borderWidth: 0 }),
      containerID: idOf(b.name), containerName: b.name, content: text[b.name], isEventCapture: b.capture ? 1 : 0, textColor: sc.tone[b.name],
    })),
    ...(at && { imageObject: [new ImageContainerProperty({ xPosition: at.x, yPosition: at.y, width: ICON.px, height: ICON.px, containerID: ICON.id, containerName: ICON.name })] }),
    ...(big && { imageObject: [
      new ImageContainerProperty({ xPosition: TITLE_AT.x, yPosition: TITLE_AT.y, width: TITLE_AT.w, height: TITLE_AT.h, containerID: TITLE.id, containerName: TITLE.name }),
      new ImageContainerProperty({ xPosition: PNL_AT.x, yPosition: PNL_AT.y, width: PNL_AT.w, height: PNL_AT.h, containerID: PNL.id, containerName: PNL.name }),
      ...CHART.map(c => new ImageContainerProperty({ xPosition: CHART_AT.x + c.dx, yPosition: CHART_AT.y, width: CHART_SLICE, height: CHART_AT.h, containerID: c.id, containerName: c.name })),
    ] }),
    menuObject: menu(sc.layout),
  }
}

/** A failed transfer leaves the text usable and is retried on the next draw. */
async function sendIcon(name: IconName) {
  try {
    const imageData = await png(name, ICON.px)
    const result = await call(() => bridge!.updateImageRawData(new ImageRawDataUpdate({ containerID: ICON.id, containerName: ICON.name, imageData })))
    if (result === ImageRawDataUpdateResult.success) shownIcon = name
  } catch { /* the placeholder stays empty */ }
}

/** Detail's coin and side; resent only when they change. */
let shownTitle = ''
async function sendTitle(text: string) {
  shownTitle = ''
  try {
    const imageData = await titlePng(text, TITLE_AT.w, TITLE_AT.h)
    const result = await call(() => bridge!.updateImageRawData(new ImageRawDataUpdate({ containerID: TITLE.id, containerName: TITLE.name, imageData })))
    if (result === ImageRawDataUpdateResult.success) shownTitle = text
  } catch { /* the leverage and the phone still say which position */ }
}

/** Detail's PnL, as big as the title; resent only when its coarse text changes. */
let shownPnl = ''
async function sendPnl(text: string) {
  shownPnl = ''
  try {
    const imageData = await titlePng(text, PNL_AT.w, PNL_AT.h)
    const result = await call(() => bridge!.updateImageRawData(new ImageRawDataUpdate({ containerID: PNL.id, containerName: PNL.name, imageData })))
    if (result === ImageRawDataUpdateResult.success) shownPnl = text
  } catch { /* retried on the next draw */ }
}

/** Detail's chart: the server's candles and when they were asked for; the picture on the lens, as what it was drawn from. */
let closes = { symbol: '', at: 0, list: [] as Candle[] }
let shownChart = ''
async function sendChart(c: NonNullable<Screen['chart']>) {
  if (c.symbol !== closes.symbol || Date.now() - closes.at >= CHART_MS) {
    // A failed read leaves no chart for this symbol until the next minute: never another coin's line under this one.
    closes = { symbol: c.symbol, at: Date.now(), list: await api.getChart(c.symbol).catch(() => []) }
  }
  // Too few candles: blank slices, never the last coin's line under this one.
  const key = closes.list.length < 2 ? `blank:${c.symbol}` : JSON.stringify([closes.at, c])
  if (key === shownChart) return
  shownChart = '' // after a timeout the lens may show either picture
  try {
    for (const s of CHART) {
      const imageData = await chartPng(closes.list, c, CHART_AT.w, CHART_AT.h, s.dx, CHART_SLICE)
      const result = await call(() => bridge!.updateImageRawData(new ImageRawDataUpdate({ containerID: s.id, containerName: s.name, imageData })))
      if (result !== ImageRawDataUpdateResult.success) return
    }
    shownChart = key
  } catch { /* the table still says every level in words */ }
}

let drawing = false
let redraw = false
async function draw() {
  const now = current()
  $('preview').textContent = previewText(now)
  const icon = $('preview-icon')
  if (icon.dataset.icon !== now.icon) { icon.dataset.icon = now.icon; icon.innerHTML = now.icon ? svg(now.icon) : '' }
  if (!bridge || !page || quit) return // page is set once the start-up page exists
  if (drawing) { redraw = true; return } // one pass at a time, so an older pass never overwrites a newer one
  drawing = true
  try {
    do {
      redraw = false
      const sc = current()
      const want = boxText(sc)
      const key = pageKey(sc)
      if (key !== page) {
        page = '-' // unknown while it is being sent; a failed rebuild is retried on the next poll
        if (!(await call(() => bridge!.rebuildPageContainer(new RebuildPageContainer(layout(sc, want)))))) continue
        page = key
        shown = want
        shownTone = { ...sc.tone }
        shownIcon = '' // a rebuild empties image containers
        shownTitle = ''
        shownPnl = ''
        shownChart = ''
        pageSince = Date.now() // the page just reached the lens, with `>` on Dismiss
        shownChoices = sc.choices.join()
        if (sc.icon) await sendIcon(sc.icon)
        if (sc.title) await sendTitle(sc.title)
        if (sc.pnl) await sendPnl(sc.pnl)
        if (sc.chart) await sendChart(sc.chart)
        if (sc.layout === 'alert' && sc.card && sc.card.id !== blinked) {
          blinked = sc.card.id // once per alert
          await blink(want.who)
          // only an alert with an action asks; an Open with picks needs its size and leverage chosen by hand
          if (sc.choices.length > 1 && !sc.card.picks && api.voiceAnswersOn()) void startListening(LISTEN_MS, sc.card.id)
        }
        continue
      }
      // Blanks first: a row that moves between the loss and gain boxes never shows twice, even for one update.
      const changed = LAYOUTS[sc.layout].map(b => b.name)
        .filter(n => shown[n] !== want[n] || shownTone[n] !== sc.tone[n])
        .sort((a, b) => Number(want[b] === ' ') - Number(want[a] === ' '))
      for (const name of changed) {
        delete shown[name] // a timed-out update may have reached the glasses
        const ok = await call(() => bridge!.textContainerUpgrade(new TextContainerUpgrade({ containerID: idOf(name), containerName: name, content: want[name], textColor: sc.tone[name], contentOffset: 0, contentLength: 0 })))
        if (!ok) break // keep the rest of the text in order and retry on the next draw
        shown[name] = want[name]
        shownTone[name] = sc.tone[name]
      }
      // New choices on the same page ("Sent" turning into OK): they settle like a new page before a tap counts.
      if (sc.choices.join() !== shownChoices && shown.opt1 === want.opt1) { shownChoices = sc.choices.join(); pageSince = Date.now() }
      if (sc.icon && sc.icon !== shownIcon) await sendIcon(sc.icon) // the picture last, so text never waits on it
      if (sc.title && sc.title !== shownTitle) await sendTitle(sc.title)
      if (sc.pnl && sc.pnl !== shownPnl) await sendPnl(sc.pnl)
      if (sc.chart) await sendChart(sc.chart)
    } while (redraw)
  } catch {
    // a failed or unanswered BLE call: `shown` and `page` keep what is known, so the next poll sends the rest again
  } finally {
    drawing = false
  }
}

const wear = new WearTracker()
let polling = false
/** `force`: the phone page asked, so the glasses being off does not matter. */
async function poll(force = false) {
  await settingsReady
  if (polling || quit || (!force && !wear.inUse)) return // off or in the case: nobody sees the lens
  if (cursor.at && Date.now() - lastSwipe > CURSOR_IDLE_MS) cursor = { key: '', at: 0 }
  polling = true
  const was = current().card // the alert on the lens before this state
  try {
    state = await api.getState(Boolean(bridge && page && page !== '-' && wear.inUse))
    offline = false
    needToken = false
  } catch (e) {
    needToken = (e as { status?: number }).status === 401 // the server is up, the token is not set or wrong
    offline = !needToken
  } finally {
    polling = false
  }
  // It left the queue unanswered and not for a newer version of itself: its time ran out.
  if (was && !outcome && state && state.card?.id !== was.id && state.card?.supersedes !== was.id && was.id !== hide &&
    was.expiresAt <= state.updatedAt + EXPIRY_SLACK_MS) outcome = { card: was, expired: true }
  const o = outcome
  if (o && execId && !settled(o)) {
    try {
      o.execution = await api.getExecution(execId)
      if (DONE.includes(o.execution.status)) doneAt ||= Date.now()
      if (settled(o) && DONE.includes(o.execution.status)) setTimeout(() => { if (outcome === o) void closeOutcome() }, NOTE_MS) // back to Main in 5 s
    } catch { /* the next poll asks again */ }
  }
  // Its position closed: Detail goes back to Main, never on to the next coin.
  if (detailOpen && state && !state.positions.some(p => posKey(p) === focusKey)) detailOpen = false
  const n = state?.positions.length ?? 0
  $('source').textContent = needToken || offline ? 'Not connected'
    : [state?.source, `${n} position${n === 1 ? '' : 's'}`, noVoice() ? 'Voice off' : ''].filter(Boolean).join(' · ')
  $('server-state').textContent = needToken ? 'Needs token' : offline ? 'Offline' : 'Connected'
  if (needToken || offline) $<HTMLDetailsElement>('server-box').open = true // a problem opens it; it never closes under you
  await draw()
}

// ── voice: the mic opens when an alert arrives; yes starts a countdown, no dismisses ──

async function startListening(ms: number, cardId: string) {
  if (!bridge || mic !== 'off' || document.hidden || noVoice()) return
  mic = 'starting'
  listenMs = ms
  listenFor = cardId
  const attempt = ++micAttempt
  audio = []
  const ok = await call(() => bridge!.audioControl(true, AudioInputSource.Glasses)).catch(() => false) // a lost reply must not leave the mic 'starting' for good
  if (attempt !== micAttempt) return
  if (!ok) {
    await stopListening('Microphone unavailable')
  } else {
    mic = 'on'
    listenEnds = Date.now() + ms
    listenTimer = setTimeout(() => void sendVoice(), ms)
    const tick = setInterval(() => (mic === 'on' ? void draw() : clearInterval(tick)), 500) // the bar shrinks
  }
  return draw()
}

async function stopListening(message = 'Recording interrupted · try again') {
  if (mic !== 'starting' && mic !== 'on') return
  micAttempt++
  mic = 'stopping'
  clearTimeout(listenTimer)
  audio = []
  note(message)
  if (bridge) await call(() => bridge!.audioControl(false)).catch(() => {})
  mic = 'off'
}

async function sendVoice() {
  if (mic !== 'on') return
  if (document.hidden) return stopListening()
  mic = 'sending'
  clearTimeout(listenTimer)
  if (bridge) await call(() => bridge!.audioControl(false)).catch(() => {})
  const pcm = new Uint8Array(audio.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of audio) { pcm.set(c, at); at += c.length }
  audio = []
  let r: Awaited<ReturnType<typeof api.voice>> | null = null
  if (pcm.length >= MIN_AUDIO_BYTES) {
    if (!countdown) note('Thinking…', Infinity)
    await draw()
    try {
      r = await api.voice(pcm)
      note('', 0)
    } catch (e) {
      note(`Voice: ${(e as Error).message}`)
    }
  }
  mic = 'off'
  if (r) await onAnswer(listenFor, r)
  return poll()
}

/** A spoken answer, for the alert the mic opened for; a gesture since then already answered it. */
async function onAnswer(cardId: string, r: { heard: string; answer: 'yes' | 'no' | null }) {
  if (countdown) return r.answer === 'no' ? stopCountdown() : undefined // a yes while counting changes nothing
  const sc = current()
  if (sc.layout !== 'alert' || sc.card?.id !== cardId) return
  if (r.answer === 'no') return dismissCard(sc.card)
  if (r.answer === 'yes' && sc.choices.length > 1 && !sc.card.picks) return startCountdown(sc.card) // stale data offers only Dismiss: yes does nothing
  note(r.heard ? `Heard "${r.heard}" · tap to answer` : 'Heard nothing · tap to answer')
}

/** Spoken yes: every action waits COUNTDOWN_MS on the lens before the confirm goes out, as a misheard word is likelier than a stray tap. */
function startCountdown(card: Proposal) {
  countdown = { card, ends: Date.now() + COUNTDOWN_MS }
  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    if (!countdown) return
    if (current().card?.id !== card.id) return stopCountdown('') // expired, replaced or answered elsewhere: nothing goes out
    if (Date.now() < countdown.ends || mic === 'on' || mic === 'sending') return void draw() // a "no" still on its way wins
    countdown = null
    clearInterval(countdownTimer)
    void confirmCard(card)
  }, 250)
  void startListening(COUNTDOWN_LISTEN_MS, card.id)
  return draw()
}

function stopCountdown(message = 'Stopped · nothing sent') {
  countdown = null
  clearInterval(countdownTimer)
  void stopListening('')
  note(message, message ? 2000 : 0)
  return draw()
}

// CLICK_EVENT is 0 and protobuf drops zero fields, so a tap arrives with eventType undefined.
// Resolve the default inside the envelope check (pattern from the Even Hub minimal template).
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

async function onMenu(id?: number) {
  if (id === MENU_PROTECT || id === MENU_LOCK || id === MENU_CLOSE || id === MENU_CLOSE_ALL) {
    // Detail's position, read now: the menu was built for the page, a swipe since may have moved it.
    const p = id === MENU_CLOSE && state ? rankPositions(state.positions)[focusIndex()] : undefined
    if (id === MENU_CLOSE && !p) return draw()
    pausedUntil = 0 // you asked for these alerts: show them
    note('One moment…', Infinity)
    await draw()
    try {
      await api.command(id === MENU_PROTECT ? 'stop' : id === MENU_LOCK ? 'lock' : 'close', p && { symbol: p.symbol, positionIdx: p.positionIdx })
      note('', 0) // the server's toast says what it queued
    } catch (e) {
      note(`Menu: ${(e as Error).message}`)
    }
    return poll()
  }
  if (id === MENU_PAUSE) pausedUntil = pausedMin() > 0 ? 0 : Date.now() + PAUSE_MS
  return draw()
}

async function onEvent(event: Parameters<Parameters<EvenAppBridge['onEvenHubEvent']>[0]>[0]) {
  wear.inUse = true // anything from the glasses means someone is using them
  if (event.audioEvent) {
    if (mic === 'starting' || mic === 'on') audio.push(event.audioEvent.audioPcm)
    return
  }
  if (event.menuItemClickEvent) return onMenu(event.menuItemClickEvent.itemID)
  const types = [eventTypeOf(event.sysEvent), eventTypeOf(event.textEvent)]
  const is = (t: OsEventTypeList) => types.includes(t)

  if (is(OsEventTypeList.ABNORMAL_EXIT_EVENT)) {
    void stopListening()
    page = '-' // the host dropped the page: the next draw rebuilds it
    return
  }
  const life = LIFECYCLE.find(is)
  if (life !== undefined) {
    if (repeated(life, Date.now())) return // the firmware sends one transition twice
    const { next, act } = exitStep(exiting, life)
    exiting = next
    if (act === 'quit') {
      quit = true // polling and drawing stop: the page is gone
      void stopListening()
      return
    }
    if (quit && life === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      quit = false // the host kept the WebView and opened the app again
      shown = {}
      page = '-'
      return poll()
    }
    if (act === 'pass' && life === OsEventTypeList.FOREGROUND_EXIT_EVENT) void stopListening()
    if (act === 'ignore') return // the exit dialogue just appeared: a rebuild behind it only loses the images
    if (act === 'show' || act === 'resume') {
      if (act === 'show') {
        shown = {}
        page = '-' // rebuild from scratch: an alert comes back on Dismiss with a fresh settle time
      }
      return poll() // `resume` only redraws what changed: opening the contextual menu sends ENTER, and a rebuild beneath it closes the menu
    }
  }
  const gesture = [OsEventTypeList.CLICK_EVENT, OsEventTypeList.DOUBLE_CLICK_EVENT, OsEventTypeList.SCROLL_TOP_EVENT, OsEventTypeList.SCROLL_BOTTOM_EVENT].some(is)
  if (gesture && countdown) return stopCountdown() // any gesture stops a spoken yes, and does nothing else
  if (gesture && (mic === 'starting' || mic === 'on')) void stopListening('') // the hand answers instead of the voice
  const swipe = is(OsEventTypeList.SCROLL_TOP_EVENT) ? 0 : is(OsEventTypeList.SCROLL_BOTTOM_EVENT) ? 1 : null
  const sc = current()
  if (sc.layout === 'main') {
    if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
      // Exit is for Main: a root-page double tap must open the host's exit dialogue (Even Hub review).
      if (exiting === 'asked') return // the dialogue is already on its way
      void stopListening()
      exiting = 'asked'
      setTimeout(() => { if (exiting === 'asked') exiting = 'none' }, EXIT_WAIT_MS)
      if (bridge) call(() => bridge!.shutDownPageContainer(1)).then(ok => { if (!ok) exiting = 'none' }, () => { exiting = 'none' })
      return
    }
    if (offline || needToken) return // only the problem line is on screen: a tap or swipe must not move the hidden table
    if (is(OsEventTypeList.CLICK_EVENT)) {
      const n = state?.positions.length ?? 0
      if (!n) return // nothing to open; Speak is on the menu
      focusKey = posKey(rankPositions(state!.positions)[focusIndex()])
      detailOpen = true
      return draw()
    }
    if (swipe !== null) return moveFocus(swipe ? 1 : -1)
    return
  }
  if (sc.layout === 'detail') {
    if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) { detailOpen = false; return draw() }
    if (swipe !== null) return moveFocus(swipe ? 1 : -1)
    return
  }
  // Only the page on the lens, once it has settled: a tap meant for the previous alert cannot answer a new one.
  if (page !== pageKey(sc) || Date.now() - pageSince < CARD_SETTLE_MS) return
  if (swipe !== null) {
    if (sc.choices.length < 2 || Date.now() - lastSwipe < SWIPE_GATE_MS) return
    lastSwipe = Date.now()
    cursor = { key: sc.key, at: Math.max(0, Math.min(sc.choices.length - 1, sc.at + (swipe ? 1 : -1))) } // up toward Dismiss, down toward the action
    return draw()
  }
  if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    // The leverage page goes back to the size page, the rest back to the alert, on Dismiss like every rebuilt page
    if (sc.layout === 'review' && sc.card) {
      if (sc.key.endsWith(':leverage') && pick?.id === sc.card.id) pick = undefined
      else review = ''
      cursor = { key: '', at: 0 }
      return draw()
    }
    if (outcome && !sc.choices.length) return closeOutcome() // "Sent": the server carries on, the lens goes back
    return act(sc, 0) // Dismiss, or OK on a result
  }
  if (is(OsEventTypeList.CLICK_EVENT)) {
    const want = boxText(sc)
    // A swipe changes the app's cursor before the glasses acknowledge the new highlight.
    if (shown.opt1 === want.opt1 && shown.opt2 === want.opt2) return act(sc, sc.at)
  }
}

/** Does the choice a tap landed on. */
function act(sc: Screen, i: number) {
  const choice = sc.choices[i]
  const card = sc.card
  if (choice === 'close') return closeOutcome()
  if (!card) return
  if (choice === 'dismiss') return dismissCard(card)
  if (choice === 'review') { review = card.id; return draw() }
  if (choice === 'confirm') return confirmCard(card)
  if (choice === 'pick') return pickChoice(sc, card, i)
}

/** A tap on an Open's size or leverage page. The size page with one leverage, or the leverage page, sends the pick. */
async function pickChoice(sc: Screen, card: Proposal, i: number) {
  if (picking) return
  const { sizes, leverages } = card.picks!
  const onSize = sc.key.endsWith(':size')
  if (onSize) pick = { id: card.id, size: sizes[i] }
  if (onSize && leverages.length > 1) { cursor = { key: '', at: 0 }; return draw() }
  const size = pick?.id === card.id ? pick.size : sizes[0]
  picking = true
  try {
    const r = await api.pick(card.id, size, onSize ? leverages[0] : leverages[i])
    if (r.ok && r.proposalId) {
      hide = card.id
      review = r.proposalId // Review of the new terms, once the poll brings them
    }
    else note(r.message)
  } catch {
    note('No reply from the server · try again')
  } finally {
    picking = false
  }
  pick = undefined
  cursor = { key: '', at: 0 }
  return poll()
}

function closeOutcome() {
  outcome = null
  execId = ''
  doneAt = 0
  return draw()
}

async function dismissCard(card: Proposal) {
  hide = card.id // gone at once: every gesture gets a visible answer
  review = ''
  await draw()
  try {
    await api.dismiss(card.id, 'glasses')
  } catch {
    hide = ''
    note('No reply from the server · try again')
  }
  return poll()
}

async function confirmCard(card: Proposal) {
  const o: Outcome = { card } // Sent, until the server answers
  outcome = o
  execId = ''
  doneAt = 0
  review = ''
  await draw()
  try {
    // One key per card: a second tap after a lost reply gets the same execution back, never a second order.
    const r = await api.confirm(card.id, `lens:${card.id}`)
    if (r.executionId) execId = r.executionId
    else o.message = r.message // "Expired, nothing sent", "Replaced by a newer proposal, nothing sent"
  } catch {
    o.lost = true
  }
  return poll()
}

/** A swipe moves Main `>` / Detail to the next or previous position (liquidation order). */
function moveFocus(dir: 1 | -1) {
  if (Date.now() - lastSwipe < SWIPE_GATE_MS) return
  lastSwipe = Date.now()
  const n = state?.positions.length ?? 0
  if (n <= 1) {
    note(n ? 'Only one position' : 'No open positions', 2000)
    return draw()
  }
  const ranked = rankPositions(state!.positions)
  focus = clampFocus(focusIndex() + dir, n)
  focusKey = posKey(ranked[focus])
  return draw()
}

async function startGlasses() {
  try {
    bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no bridge')), BRIDGE_TIMEOUT_MS)),
    ])
  } catch {
    $('glasses').textContent = 'Open in the Even app to use your glasses'
    return
  }
  const b = bridge
  // Reads run together in one queue slot with one cap: a hung read must not keep the lens blank (~30 s on a bad hop).
  // Writes, later, each take their own slot.
  const stored = { getLocalStorage: (k: string) => b.getLocalStorage(k), setLocalStorage: (k: string, v: string) => call(() => b.setLocalStorage(k, v)) }
  await call(() => api.loadSettings(stored)).catch(() => {}) // before the first request: the token lives here
  settingsLoaded()
  const sc = current()
  shown = boxText(sc)
  shownTone = { ...sc.tone }
  let result = await call(() => b.createStartUpPageContainer(new CreateStartUpPageContainer(layout(sc, shown)))).catch(() => null)
  // The start-up page exists once per session. After a WebView reload the host answers 1 (invalid) and the lens would keep
  // the old page for good, so rebuild the existing one instead.
  if (result === 1 && (await call(() => b.rebuildPageContainer(new RebuildPageContainer(layout(sc, shown)))).catch(() => false))) result = 0
  if (result === 0) {
    page = pageKey(sc)
    pageSince = Date.now()
    if (sc.icon) await sendIcon(sc.icon)
  }
  else page = '-' // no reply, or the host refused: every draw tries a rebuild until one lands
  $('glasses').textContent = result === 0 ? 'Glasses connected' : result === null ? 'Glasses not answering' : `Glasses not connected (code ${result})` // a plain browser lands here too
  api.countLaunch() // after the start-up page and its images: a storage write next to them can drop the link
  bridge.onEvenHubEvent(e => void onEvent(e))
  const status = (await call(() => b.getDeviceInfo()).catch(() => null))?.status
  if (status) wear.update(status)
  bridge.onDeviceStatusChanged(s => {
    const was = wear.inUse
    if (wear.update(s) && !was) void poll() // just put on: fresh numbers now, not on the next tick
  })
}

document.addEventListener('visibilitychange', () => { if (document.hidden) void stopListening() })
window.addEventListener('pagehide', () => void stopListening())
startPhonePage({ root: $('phone'), settingsReady, onConnect: () => void poll(true) })
void startGlasses()
void poll()
setInterval(() => void poll(), POLL_MS)
