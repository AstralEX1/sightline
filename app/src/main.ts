import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  ImageContainerProperty,
  ImageRawDataUpdate,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  AudioInputSource,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { ExecutionStatus, Proposal, ServerState } from '../../server/src/types.ts'
import { previewText, screen, rankPositions, clampFocus, type Layout, type Outcome, type Screen } from './view.ts'
import * as api from './api.ts'
import { png, svg, numeralPng, type IconName } from './icons.ts'
import { startPhonePage } from './phone/index.ts'
import { LIFECYCLE, createDedupe, exitStep, type Exit } from './lifecycle.ts'

const POLL_MS = 1000
const BRIDGE_TIMEOUT_MS = 10_000
const SETTINGS_WAIT_MS = 1500 // how long the first request waits for the bridge's storage; a plain browser has none
const EXIT_WAIT_MS = 3000 // the exit dialogue shows ~100 ms after the request; past this it never will
const LISTEN_MS = 5000
const MIN_AUDIO_BYTES = 9600 // 0.3 s of 16 kHz s16le
const NOTE_MS = 5000
// shortcut: a fixed guess, measure how long the lens takes to redraw on real glasses and tune it
const CARD_SETTLE_MS = 1000
const PAUSE_MS = 15 * 60_000
const HINT_MS = 10_000 // the gesture line on Main, after launch and on every return to the app
const BLINK_MS = 400 // one on/off step of the new-alert blink (matic-even H1 used 400 ms)
const SWIPE_GATE_MS = 700 // one long swipe arrives as several scroll events (matic-even H12)
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
let detailOpen = false
let lastSwipe = 0
let blinked = ''
let listenEnds = 0
let hintsUntil = 0
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
let shownNumeral = ''
let outcome: Outcome | null = null
let execId = ''
let review = ''
let hide = ''
let cursor = { key: '', at: 0 }
let mic: 'off' | 'starting' | 'on' | 'sending' = 'off'
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
    { name: 'price', x: 160, y: 56, w: 128, h: 144 },
    { name: 'loss', x: 288, y: 56, w: 104, h: 144 },
    { name: 'gain', x: 288, y: 56, w: 104, h: 144 },
    { name: 'flag', x: 392, y: 56, w: 168, h: 144 },
    HINT,
  ],
  // Weather layout: short table left, one big dotted PnL right (glasses-shortcuts §4).
  detail: [
    { name: 'top', x: 16, y: 16, w: 544, h: 32, capture: true },
    { name: 'table', x: 16, y: 64, w: 272, h: 112 },
    { name: 'loud', x: 16, y: 64, w: 272, h: 112 },
    { name: 'label', x: 320, y: 64, w: 240, h: 32 },
    { name: 'unit', x: 320, y: 152, w: 240, h: 32 },
    { name: 'info', x: 16, y: 208, w: 544, h: 32 },
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
const BIG_AT = { x: 320, y: 96, w: 240, h: 56 }
const ICON = { id: 21, name: 'icon', px: 48 }
const BIG = { id: 22, name: 'big' }
const PAD = 2
const FRAME_COLOR = 11 // brightness 3 of 4 on the border's 0–15 scale, like the text it holds
const MENU_PAUSE = 1
const MENU_SPEAK = 2
const MENU_PROTECT = 3
const MENU_LOCK = 4
const NAMES = Object.values(LAYOUTS).flat().map(b => b.name).filter((n, i, all) => all.indexOf(n) === i)
const idOf = (name: string) => 1 + NAMES.indexOf(name)

/** While the mic is open, a bar counts down the seconds left; otherwise the latest voice or menu note. */
function voiceText(): string {
  if (mic === 'on') {
    const left = Math.max(0, Math.ceil((listenEnds - Date.now()) / 1000))
    return `● Listening  ${'━'.repeat(left)}${'─'.repeat(LISTEN_MS / 1000 - left)}  tap to send`
  }
  return Date.now() < voiceNote.until ? voiceNote.text : ''
}

const onCount = () => {
  const ranked = state ? rankPositions(state.positions) : []
  const p = ranked[clampFocus(focus, ranked.length)]
  return p && state?.onByPosition ? state.onByPosition[`${p.symbol}:${p.positionIdx}`] : undefined
}
const current = () => screen(state, {
  offline, voice: voiceText(), pausedMin: pausedMin(), focus, detail: detailOpen, needToken, hints: Date.now() < hintsUntil, now: Date.now(),
  outcome: outcome ?? undefined, review, hide, cursor, onCount: onCount(),
})
/** A new key needs a rebuild: another layout or card, and a rebuild is the only way to set the menu. */
const pageKey = (sc: Screen) => `${sc.key}:${pausedMin() > 0 ? 'paused' : ''}${noVoice() ? ':novoice' : ''}`

/** Container name → content. A blank is ' ': an empty string is not a safe update. */
function boxText(sc: Screen): Record<string, string> {
  return Object.fromEntries(LAYOUTS[sc.layout].map(b => [b.name, sc.text[b.name] || ' ']))
}

/** Tap then long press opens this menu (Even Hub docs, Contextual Menu). Labels stay under 16 characters, verbs first (Even Hub docs). */
const menu = () => new MenuContainerProperty({
  menuItems: [
    new MenuItemProperty({ itemID: MENU_PROTECT, itemName: 'Protect all' }),
    new MenuItemProperty({ itemID: MENU_LOCK, itemName: 'Lock profits' }),
    new MenuItemProperty({ itemID: MENU_PAUSE, itemName: pausedMin() > 0 ? 'Resume cards' : 'Pause 15 min' }),
    ...(noVoice() ? [] : [new MenuItemProperty({ itemID: MENU_SPEAK, itemName: 'Speak' })]),
  ],
})

/** Hard on/off blink of a new alert's first line: the glasses have no speaker, and this is what catches the eye (matic-even H1). */
async function blink(who: string) {
  const set = (textColor: number) =>
    timed(bridge!.textContainerUpgrade(new TextContainerUpgrade({ containerID: idOf('who'), containerName: 'who', content: who, textColor })))
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
  const big = sc.layout === 'detail'
  return {
    containerTotalNum: boxes.length + (at || big ? 1 : 0),
    textObject: boxes.map(b => new TextContainerProperty({
      xPosition: b.x, yPosition: b.y, width: b.w, height: b.h, paddingLength: PAD,
      ...(b.name === 'frame' ? { borderWidth: 2, borderColor: FRAME_COLOR, borderRadius: 4 } : { borderWidth: 0 }),
      containerID: idOf(b.name), containerName: b.name, content: text[b.name], isEventCapture: b.capture ? 1 : 0, textColor: sc.tone[b.name],
    })),
    ...(at && { imageObject: [new ImageContainerProperty({ xPosition: at.x, yPosition: at.y, width: ICON.px, height: ICON.px, containerID: ICON.id, containerName: ICON.name })] }),
    ...(big && { imageObject: [new ImageContainerProperty({ xPosition: BIG_AT.x, yPosition: BIG_AT.y, width: BIG_AT.w, height: BIG_AT.h, containerID: BIG.id, containerName: BIG.name })] }),
    menuObject: menu(),
  }
}

/** Draws the icon into its image container, once: a failed transfer leaves a complete alert, which says everything in words. */
async function sendIcon(name: IconName) {
  shownIcon = name
  try {
    const imageData = await png(name, ICON.px)
    await timed(bridge!.updateImageRawData(new ImageRawDataUpdate({ containerID: ICON.id, containerName: ICON.name, imageData })))
  } catch { /* the placeholder stays empty */ }
}

/** Detail's big PnL: only resent when the rounded numeral string changes. */
async function sendNumeral(text: string) {
  shownNumeral = text
  try {
    const imageData = await numeralPng(text, BIG_AT.w, BIG_AT.h)
    await timed(bridge!.updateImageRawData(new ImageRawDataUpdate({ containerID: BIG.id, containerName: BIG.name, imageData })))
  } catch { /* the label and unit still say PnL */ }
}

let drawing = false
let redraw = false
async function draw() {
  const now = current()
  $('preview').textContent = previewText(now)
  const icon = $('preview-icon')
  if (icon.dataset.icon !== now.icon) { icon.dataset.icon = now.icon; icon.innerHTML = now.icon ? svg(now.icon) : '' }
  if (!bridge || !page) return // page is set once the start-up page exists
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
        if (!(await timed(bridge.rebuildPageContainer(new RebuildPageContainer(layout(sc, want)))))) continue
        page = key
        shown = want
        shownTone = { ...sc.tone }
        shownIcon = '' // a rebuild empties image containers
        shownNumeral = ''
        pageSince = Date.now() // the page just reached the lens, with `>` on Dismiss
        if (sc.icon) await sendIcon(sc.icon)
        if (sc.numeral) await sendNumeral(sc.numeral)
        if (sc.layout === 'alert' && sc.card && sc.card.id !== blinked) { blinked = sc.card.id; await blink(want.who) } // once per alert
        continue
      }
      // Blanks first: a row that moves between the loss and gain boxes never shows twice, even for one update.
      const changed = LAYOUTS[sc.layout].map(b => b.name)
        .filter(n => shown[n] !== want[n] || shownTone[n] !== sc.tone[n])
        .sort((a, b) => Number(want[b] === ' ') - Number(want[a] === ' '))
      for (const name of changed) {
        await timed(bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: idOf(name), containerName: name, content: want[name], textColor: sc.tone[name] })))
        shown[name] = want[name]
        shownTone[name] = sc.tone[name]
      }
      if (sc.icon && sc.icon !== shownIcon) await sendIcon(sc.icon) // the picture last, so text never waits on it
      if (sc.numeral && sc.numeral !== shownNumeral) await sendNumeral(sc.numeral)
    } while (redraw)
  } catch {
    // a failed or unanswered BLE call: `shown` and `page` keep what is known, so the next poll sends the rest again
  } finally {
    drawing = false
  }
}

let polling = false
async function poll() {
  await settingsReady
  if (polling) return
  polling = true
  const was = current().card // the alert on the lens before this state
  try {
    state = await api.getState()
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
  const n = state?.positions.length ?? 0
  $('source').textContent = needToken || offline ? 'Not connected'
    : [state?.source, `${n} position${n === 1 ? '' : 's'}`, noVoice() ? 'Voice off' : ''].filter(Boolean).join(' · ')
  $('server-state').textContent = needToken ? 'Needs token' : offline ? 'Offline' : 'Connected'
  if (needToken || offline) $<HTMLDetailsElement>('server-box').open = true // a problem opens it; it never closes under you
  await draw()
}

// ── voice: tap on Main, speak, tap again (or wait 5 s) ──

async function startListening() {
  if (!bridge || mic !== 'off') return
  if (noVoice()) { note('Voice is off on the server'); return draw() } // no 5 s of talking into nothing
  mic = 'starting'
  audio = []
  const ok = await timed(bridge.audioControl(true, AudioInputSource.Glasses)).catch(() => false) // a lost reply must not leave the mic 'starting' for good
  mic = ok ? 'on' : 'off'
  if (!ok) note('Microphone unavailable')
  if (ok) {
    listenEnds = Date.now() + LISTEN_MS
    listenTimer = setTimeout(() => void sendVoice(), LISTEN_MS)
  }
  return draw()
}

async function sendVoice() {
  if (mic !== 'on') return
  mic = 'sending'
  clearTimeout(listenTimer)
  if (bridge) await timed(bridge.audioControl(false)).catch(() => {})
  const pcm = new Uint8Array(audio.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of audio) { pcm.set(c, at); at += c.length }
  audio = []
  if (pcm.length < MIN_AUDIO_BYTES) {
    note('Heard nothing')
  } else {
    note('Thinking…', Infinity)
    await draw()
    try {
      await api.voice(pcm)
      note('', 0) // the server's toast says what it heard
    } catch (e) {
      note(`Voice: ${(e as Error).message}`)
    }
  }
  mic = 'off'
  return poll()
}

// CLICK_EVENT is 0 and protobuf drops zero fields, so a tap arrives with eventType undefined.
// Resolve the default inside the envelope check (pattern from the Even Hub minimal template).
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

async function onMenu(id?: number) {
  if (id === MENU_SPEAK) return startListening()
  if (id === MENU_PROTECT || id === MENU_LOCK) {
    pausedUntil = 0 // you asked for these alerts: show them
    note('One moment…', Infinity)
    await draw()
    try {
      await api.command(id === MENU_PROTECT ? 'stop' : 'lock')
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
  if (event.audioEvent) {
    if (mic === 'starting' || mic === 'on') audio.push(event.audioEvent.audioPcm)
    return
  }
  if (event.menuItemClickEvent) return onMenu(event.menuItemClickEvent.itemID)
  const types = [eventTypeOf(event.sysEvent), eventTypeOf(event.textEvent)]
  const is = (t: OsEventTypeList) => types.includes(t)

  const life = LIFECYCLE.find(is)
  if (life !== undefined) {
    if (repeated(life, Date.now())) return // the firmware sends one transition twice
    const { next, act } = exitStep(exiting, life)
    exiting = next
    if (act === 'quit') {
      if (mic !== 'off') void bridge?.audioControl(false)
      return
    }
    if (act === 'ignore') return // the exit dialogue just appeared: a rebuild behind it only loses the images
    if (act === 'show' || act === 'resume') {
      hintsUntil = Date.now() + HINT_MS
      if (act === 'show') {
        shown = {}
        page = '-' // rebuild from scratch: an alert comes back on Dismiss with a fresh settle time
      }
      return poll() // `resume` only redraws what changed: opening the contextual menu sends ENTER, and a rebuild beneath it closes the menu
    }
  }
  if (is(OsEventTypeList.CLICK_EVENT) && mic === 'on') return sendVoice()
  const swipe = is(OsEventTypeList.SCROLL_TOP_EVENT) ? 0 : is(OsEventTypeList.SCROLL_BOTTOM_EVENT) ? 1 : null
  const sc = current()
  if (sc.layout === 'main') {
    if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
      // Exit is for Main: a root-page double tap must open the host's exit dialogue (Even Hub review).
      if (exiting === 'asked') return // the dialogue is already on its way
      if (mic !== 'off') void bridge?.audioControl(false)
      exiting = 'asked'
      setTimeout(() => { if (exiting === 'asked') exiting = 'none' }, EXIT_WAIT_MS)
      bridge?.shutDownPageContainer(1).then(ok => { if (!ok) exiting = 'none' }, () => { exiting = 'none' })
      return
    }
    if (offline || needToken) return // only the problem line is on screen: a tap or swipe must not move the hidden table
    if (is(OsEventTypeList.CLICK_EVENT)) {
      const n = state?.positions.length ?? 0
      if (!n) return // nothing to open; Speak is on the menu
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
    cursor = { key: sc.key, at: swipe } // up: Dismiss, down: the action
    return draw()
  }
  if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    if (sc.layout === 'review') { review = ''; cursor = { key: '', at: 0 }; return draw() } // back to the alert, on Dismiss like every rebuilt page
    return act(sc, 0) // Dismiss, or OK on a result; nothing while it waits for Bybit
  }
  if (is(OsEventTypeList.CLICK_EVENT)) return act(sc, sc.at)
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
  focus = clampFocus(focus + dir, n)
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
  await api.loadSettings(bridge).catch(() => {}) // before the first request: the token lives here
  settingsLoaded()
  hintsUntil = Date.now() + HINT_MS
  const sc = current()
  shown = boxText(sc)
  shownTone = { ...sc.tone }
  let result = await timed(bridge.createStartUpPageContainer(new CreateStartUpPageContainer(layout(sc, shown)))).catch(() => null)
  // The start-up page exists once per session. After a WebView reload the host answers 1 (invalid) and the lens would keep
  // the old page for good, so rebuild the existing one instead.
  if (result === 1 && (await timed(bridge.rebuildPageContainer(new RebuildPageContainer(layout(sc, shown)))).catch(() => false))) result = 0
  if (result === 0) {
    page = pageKey(sc)
    pageSince = Date.now()
    if (sc.icon) await sendIcon(sc.icon)
    if (sc.numeral) await sendNumeral(sc.numeral)
  }
  if (result === null) page = '-' // no reply: the page may exist, so the next draw rebuilds it
  $('glasses').textContent = result === 0 ? 'Glasses connected' : result === null ? 'Glasses not answering' : `Glasses not connected (code ${result})` // a plain browser lands here too
  bridge.onEvenHubEvent(e => void onEvent(e))
}

window.addEventListener('beforeunload', () => { if (mic !== 'off') void bridge?.audioControl(false) })
startPhonePage({ root: $('phone'), settingsReady, onConnect: () => void poll() })
void startGlasses()
void poll()
setInterval(poll, POLL_MS)
