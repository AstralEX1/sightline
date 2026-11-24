import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  ListContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ListItemContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  AudioInputSource,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { Config, ServerState } from '../../server/src/types.ts'
import { previewText, screen, ROWS, type Screen } from './view.ts'
import { alertLine, describeAlert, parseAlerts } from './alerts.ts'
import { describeShortcut, parseShortcuts, shortcutLine } from './shortcuts.ts'
import * as api from './api.ts'
import { png, svg, type IconName } from './icons.ts'
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
const HINT_MS = 10_000 // the gesture line on the calm screen, after launch and on every return to the app
const BLINK_MS = 400 // one on/off step of the new-card blink (matic-even H1 used 400 ms)
const SWIPE_GATE_MS = 700 // one long swipe arrives as several scroll events (matic-even H12)

let state: ServerState | null = null
let offline = false
let cardSince = 0
let pausedUntil = 0
let needToken = false
let pageNo = 0
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
/** Layout on the lens, from pageKey(); '' means unknown, so the next draw rebuilds. */
let page = ''
let shown: Record<string, string> = {}
/** Boxes the lens draws dim right now, like `shown` for brightness. */
let shownDim: string[] = []
let answering = false
let mic: 'off' | 'starting' | 'on' | 'sending' = 'off'
let audio: Uint8Array[] = []
let listenTimer: ReturnType<typeof setTimeout> | undefined
let voiceNote = { text: '', until: 0 }
const note = (text: string, ms = NOTE_MS) => { voiceNote = { text, until: Date.now() + ms } }
const pausedMin = () => Math.max(0, Math.ceil((pausedUntil - Date.now()) / 60_000))
/** The server has no speech key: the menu loses Speak (a rebuild sets the menu, so it is part of the page key). */
const noVoice = () => state?.voice === false
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// ── glasses ────────────────────────────────────────────────

type Box = { name: string; x: number; y: number; w: number; h: number }
// Edge to edge, as in the Even OS guidelines: 16 px side margins, 8 px top and bottom, 27 px a text line (+2 px padding each side).
const BOXES: Box[] = [
  { name: 'head', x: 16, y: 8, w: 544, h: 31 },
  { name: 'c0', x: 16, y: 43, w: 140, h: 139 },
  { name: 'c1', x: 156, y: 43, w: 140, h: 139 },
  { name: 'c2', x: 296, y: 43, w: 120, h: 139 },
  { name: 'c3', x: 416, y: 43, w: 144, h: 139 },
  { name: 'main', x: 16, y: 43, w: 544, h: 139 },
  { name: 'foot', x: 16, y: 195, w: 544, h: 85 },
]
// A card reads like a notification: a rounded frame holding its icon, title, detail and the time it still waits.
// The card page reuses the names (so the same IDs) of the boxes it keeps; only their place differs.
// The frame is declared first, so it sits behind the text it holds.
const CARD_BOXES: Box[] = [
  { name: 'frame', x: 8, y: 4, w: 560, h: 98 },
  { name: 'head', x: 68, y: 8, w: 484, h: 31 },
  { name: 'main', x: 68, y: 38, w: 484, h: 58 },
  { name: 'foot', x: 16, y: 195, w: 544, h: 85 },
]
const FRAME_ID = 9
const ICON = { id: 21, name: 'icon', x: 20, y: 35, w: 36, h: 36 }
// Two 40 px items. The firmware draws the outline on the selected one and moves it on a swipe:
// one focused element with an outline (Even OS guidelines), and a tap confirms exactly what the lens shows.
const LIST = { id: 20, name: 'choice', x: 16, y: 108, w: 360, h: 96 }
// Text brightness, 0 to 4: the main line full, what supports it lower. Warnings never dim.
const BRIGHT = 4
const DIM = 2
const ICON_TIMEOUT_MS = 3000 // an icon is decoration: a slow image transfer must not hold up the card
const MENU_PAUSE = 1
const MENU_SPEAK = 2
const MENU_PROTECT = 3
const MENU_LOCK = 4
const idOf = (name: string) => (name === 'frame' ? FRAME_ID : 2 + BOXES.findIndex(b => b.name === name)) // 1 is the gesture box
const tone = (sc: Screen, name: string) => (sc.dim.includes(name) ? DIM : BRIGHT)

/** While the mic is open, a bar counts down the seconds left; otherwise the latest voice or menu note. */
function voiceText(): string {
  if (mic === 'on') {
    const left = Math.max(0, Math.ceil((listenEnds - Date.now()) / 1000))
    return `● Listening  ${'━'.repeat(left)}${'─'.repeat(LISTEN_MS / 1000 - left)}  Tap to send`
  }
  return Date.now() < voiceNote.until ? voiceNote.text : ''
}

const current = () => screen(state, { offline, voice: voiceText(), pausedMin: pausedMin(), page: pageNo, needToken, hints: Date.now() < hintsUntil })
const isCard = (sc: Screen) => sc.items.length > 0
/** A new key needs a rebuild: list items can't be updated in place, and a rebuild is the only way to set the menu. */
const pageKey = (sc: Screen) => `${isCard(sc) ? `card:${state?.card?.id}` : 'table'}:${pausedMin() > 0 ? 'paused' : ''}${noVoice() ? ':novoice' : ''}`

/** Container name → content. A blank is ' ': an empty string is not a safe update. */
function boxText(sc: Screen): Record<string, string> {
  const t: Record<string, string> = { head: sc.head, c0: sc.cols[0], c1: sc.cols[1], c2: sc.cols[2], c3: sc.cols[3], main: sc.main, foot: sc.foot, frame: ' ' }
  for (const k in t) t[k] ||= ' '
  return t
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

/** Hard on/off blink of a new card's title: the glasses have no speaker, and this is what catches the eye (matic-even H1). */
async function blink(head: string) {
  const set = (textColor: number) =>
    bridge!.textContainerUpgrade(new TextContainerUpgrade({ containerID: idOf('head'), containerName: 'head', content: head, textColor }))
  try {
    for (let i = 0; i < 2; i++) { await set(0); await sleep(BLINK_MS); await set(4); await sleep(BLINK_MS) }
  } catch {
    await set(4).catch(() => {}) // never leave the title dark
  }
}

/** The whole page with its text already in it: rebuilding and then updating would show two jumps. */
function layout(sc: Screen, text: Record<string, string>) {
  const box = (b: Box) => new TextContainerProperty({
    xPosition: b.x, yPosition: b.y, width: b.w, height: b.h, paddingLength: 2,
    ...(b.name === 'frame' ? { borderWidth: 1, borderColor: 4, borderRadius: 8 } : { borderWidth: 0 }),
    containerID: idOf(b.name), containerName: b.name, content: text[b.name], isEventCapture: 0, textColor: tone(sc, b.name),
  })
  if (!isCard(sc)) {
    return {
      containerTotalNum: 1 + BOXES.length,
      textObject: [
        // Blank, full screen and declared first (so behind): it takes every gesture, and the text never scrolls under a swipe.
        new TextContainerProperty({
          xPosition: 0, yPosition: 0, width: 576, height: 288, borderWidth: 0, paddingLength: 0,
          containerID: 1, containerName: 'evt', content: ' ', isEventCapture: 1,
        }),
        ...BOXES.map(box),
      ],
      menuObject: menu(),
    }
  }
  return {
    containerTotalNum: CARD_BOXES.length + 2,
    textObject: CARD_BOXES.map(box),
    imageObject: [new ImageContainerProperty({ xPosition: ICON.x, yPosition: ICON.y, width: ICON.w, height: ICON.h, containerID: ICON.id, containerName: ICON.name })],
    listObject: [new ListContainerProperty({
      xPosition: LIST.x, yPosition: LIST.y, width: LIST.w, height: LIST.h, borderWidth: 0, paddingLength: 4,
      containerID: LIST.id, containerName: LIST.name, isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({ itemCount: 2, itemWidth: LIST.w - 8, isItemSelectBorderEn: 1, itemName: sc.items }),
    })],
    menuObject: menu(),
  }
}

/** Draws the card's icon into its image container. Failing quietly is fine: the card says everything in words. */
async function sendIcon(name: IconName) {
  try {
    const imageData = await png(name, ICON.w)
    await Promise.race([bridge!.updateImageRawData(new ImageRawDataUpdate({ containerID: ICON.id, containerName: ICON.name, imageData })), sleep(ICON_TIMEOUT_MS)])
  } catch { /* the placeholder stays empty */ }
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
        if (!(await bridge.rebuildPageContainer(new RebuildPageContainer(layout(sc, want))))) continue
        page = key
        shown = want
        shownDim = sc.dim
        if (isCard(sc)) {
          cardSince = Date.now() // the list just reached the lens, on Skip
          if (sc.icon) await sendIcon(sc.icon)
          const id = state?.card?.id ?? ''
          if (id !== blinked) { blinked = id; await blink(want.head) } // once per card, not on every redraw
        }
        continue
      }
      // Blanks first: the table and a message never overlap, even for one update.
      const dimmed = (d: string[], n: string) => d.includes(n)
      const changed = (isCard(sc) ? CARD_BOXES : BOXES).map(b => b.name)
        .filter(n => shown[n] !== want[n] || dimmed(shownDim, n) !== dimmed(sc.dim, n))
        .sort((a, b) => Number(want[b] === ' ') - Number(want[a] === ' '))
      for (const name of changed) {
        await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: idOf(name), containerName: name, content: want[name], textColor: tone(sc, name) }))
        shown[name] = want[name]
        shownDim = dimmed(sc.dim, name) ? [...shownDim.filter(n => n !== name), name] : shownDim.filter(n => n !== name)
      }
    } while (redraw)
  } catch {
    // a failed BLE call: `shown` and `page` keep what is known, so the next poll sends the rest again
  } finally {
    drawing = false
  }
}

let polling = false
async function poll() {
  await settingsReady
  if (polling) return
  polling = true
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
  const n = state?.positions.length ?? 0
  $('source').textContent = needToken || offline ? 'Not connected'
    : [state?.source, `${n} position${n === 1 ? '' : 's'}`, noVoice() ? 'Voice off' : ''].filter(Boolean).join(' · ')
  $('server-state').textContent = needToken ? 'Needs token' : offline ? 'Offline' : 'Connected'
  if (needToken || offline) $<HTMLDetailsElement>('server-box').open = true // a problem opens it; it never closes under you
  await draw()
}

// ── voice: tap on the session screen, speak, tap again (or wait 5 s) ──

async function startListening() {
  if (!bridge || mic !== 'off') return
  if (noVoice()) { note('Voice is off on the server'); return draw() } // no 5 s of talking into nothing
  mic = 'starting'
  audio = []
  const ok = await bridge.audioControl(true, AudioInputSource.Glasses)
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
  await bridge?.audioControl(false)
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
    pausedUntil = 0 // you asked for these cards: show them
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
  const pick = event.listEvent
  const types = [eventTypeOf(event.sysEvent), eventTypeOf(event.textEvent), eventTypeOf(pick)]
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
        page = '-' // rebuild from scratch: a card comes back on Skip with a fresh settle time
      }
      return poll() // `resume` only redraws what changed: opening the contextual menu sends ENTER, and a rebuild beneath it closes the menu
    }
  }
  const card = pausedMin() > 0 || offline || needToken ? null : state?.card // the same rule as screen(): no card on the lens, none to answer
  if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    // With a card pending a double tap says "Not now", so a stray one cannot close the app in the middle of a question.
    // Exit is for the calm screen: a root-page double tap must open the host's exit dialogue (Even Hub review).
    if (card) return answerable(card) ? answerCard(card, false) : undefined
    if (exiting === 'asked') return // the dialogue is already on its way
    if (mic !== 'off') void bridge?.audioControl(false)
    exiting = 'asked'
    setTimeout(() => { if (exiting === 'asked') exiting = 'none' }, EXIT_WAIT_MS)
    bridge?.shutDownPageContainer(1).then(ok => { if (!ok) exiting = 'none' }, () => { exiting = 'none' })
    return
  }
  if (is(OsEventTypeList.CLICK_EVENT) && mic === 'on') return sendVoice()
  if (!card) {
    if (is(OsEventTypeList.CLICK_EVENT)) return startListening()
    if (is(OsEventTypeList.SCROLL_TOP_EVENT) || is(OsEventTypeList.SCROLL_BOTTOM_EVENT)) return turnPage(is(OsEventTypeList.SCROLL_BOTTOM_EVENT) ? 1 : -1)
    return
  }
  // Only a tap on this card's own list answers it. Swipes only move the firmware's outline.
  if (!pick || eventTypeOf(pick) !== OsEventTypeList.CLICK_EVENT || !answerable(card)) return
  const items = current().items
  // Index 0 arrives as undefined (protobuf), which is Skip. The name check also catches a stale list.
  const yes = (pick.currentSelectItemIndex ?? 0) === 1 && (pick.currentSelectItemName ?? items[1]) === items[1]
  return answerCard(card, yes)
}

/** Input answers a card only when it is the one on the lens and has settled: a list that just replaced another may not be there yet. */
const answerable = (card: { id: string }) => !answering && page.startsWith(`card:${card.id}:`) && Date.now() - cardSince >= CARD_SETTLE_MS

async function answerCard(card: { id: string }, yes: boolean) {
  answering = true
  note(yes ? 'Sending…' : 'Skipping…', Infinity) // every gesture gets a visible answer, at once
  await draw()
  let result = '' // empty: the server's own toast says what happened
  try {
    const r = await api.answer(card.id, yes)
    if (!r.ok) result = r.message // "Card is gone" and "Card expired" have no server toast; a refusal repeats the one it has
  } catch (e) {
    // A failed request may still have reached the exchange, so never say "not sent".
    result = (e as { status?: number }).status ? `Server error: ${(e as Error).message}` : 'No reply from the server. Check the exchange.'
  } finally {
    answering = false
    note(result, result ? NOTE_MS : 0)
  }
  return poll()
}

/** A swipe on the table shows the next or previous rows; with everything on screen it says so. */
function turnPage(dir: 1 | -1) {
  if (Date.now() - lastSwipe < SWIPE_GATE_MS) return
  lastSwipe = Date.now()
  const n = state?.positions.length ?? 0
  if (n > ROWS) pageNo += dir
  else note(n ? `All ${n} positions are on screen` : 'No open positions', 2000)
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
  shownDim = sc.dim
  let result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(layout(sc, shown)))
  // The start-up page exists once per session. After a WebView reload the host answers 1 (invalid) and the lens would keep
  // the old page for good, so rebuild the existing one instead.
  if (result === 1 && (await bridge.rebuildPageContainer(new RebuildPageContainer(layout(sc, shown))))) result = 0
  if (result === 0) {
    page = pageKey(sc)
    if (isCard(sc)) cardSince = Date.now()
    if (sc.icon) await sendIcon(sc.icon)
  }
  $('glasses').textContent = result === 0 ? 'Glasses connected' : `Glasses not connected (code ${result})` // a plain browser lands here too
  bridge.onEvenHubEvent(e => void onEvent(e))
}

// ── phone page ─────────────────────────────────────────────

const NUMBERS = ['dailyLossLimitUsd', 'maxActionUsd', 'liqWarnPct', 'marginTopUpUsd', 'stopLossPct', 'lockProfitPct', 'noStopGraceSec'] as const

function fillForm(c: Config) {
  for (const k of NUMBERS) $<HTMLInputElement>(k).value = String(c[k])
  $<HTMLTextAreaElement>('alerts').value = c.alerts.map(alertLine).join('\n')
  $<HTMLTextAreaElement>('shortcuts').value = c.shortcuts.map(shortcutLine).join('\n')
  readBack()
}

/** Each line of the two text boxes, read back in words as you type: a typo shows here, not on the lens. */
function readBack() {
  const lists = [['alerts', 'bell', (l: string) => describeAlert(parseAlerts(l)[0])], ['shortcuts', 'mic', (l: string) => describeShortcut(parseShortcuts(l)[0])]] as const
  for (const [id, icon, describe] of lists) {
    const lines = $<HTMLTextAreaElement>(id).value.split('\n').map(l => l.trim()).filter(Boolean)
    $(`${id}-read`).replaceChildren(...lines.map(line => {
      const li = document.createElement('li')
      let text: string
      try {
        text = describe(line)
        li.innerHTML = svg(icon)
      } catch {
        text = `Can’t read “${line}”`
        li.innerHTML = svg('warn')
        li.className = 'bad'
      }
      li.append(text) // a text node: the line is the user's own words, never markup
      return li
    }))
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
/** The floating pill at the bottom. `ms` 0 keeps it up: an error stays until the next change. */
function msg(text: string, ms = 2000) {
  const el = $('message')
  el.textContent = text
  el.classList.toggle('show', !!text)
  clearTimeout(toastTimer)
  if (text && ms) toastTimer = setTimeout(() => el.classList.remove('show'), ms)
}

/** Saved on every change, like a settings screen: there is no Save button to forget. */
async function save() {
  for (const k of NUMBERS) $(k).removeAttribute('aria-invalid')
  const bad = NUMBERS.find(k => !$<HTMLInputElement>(k).checkValidity() || !(Number($<HTMLInputElement>(k).value) > 0))
  if (bad) {
    $(bad).setAttribute('aria-invalid', 'true')
    return msg('Check the highlighted number', 0)
  }
  try {
    const c = { alerts: parseAlerts($<HTMLTextAreaElement>('alerts').value), shortcuts: parseShortcuts($<HTMLTextAreaElement>('shortcuts').value) } as Config
    for (const k of NUMBERS) c[k] = Number($<HTMLInputElement>(k).value)
    await api.putConfig(c) // the form is not refilled: you may already be typing in the next field
    msg('Saved')
  } catch (e) {
    msg((e as Error).message, 0)
  }
}

async function startPhonePage() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) el.innerHTML = svg(el.dataset.icon as IconName)
  await settingsReady
  const s = api.getSettings()
  $<HTMLInputElement>('server').value = s.server
  $<HTMLInputElement>('token').value = s.token

  $('connect').addEventListener('click', async () => {
    api.saveSettings($<HTMLInputElement>('server').value.trim(), $<HTMLInputElement>('token').value.trim())
    try {
      fillForm(await api.getConfig())
      msg('Connected')
    } catch (e) {
      msg(`Can’t connect: ${(e as Error).message}`, 0)
    }
    void poll()
  })

  const rules = $('rules')
  rules.addEventListener('change', () => void save()) // inputs fire on commit (blur, Enter), not on every keystroke
  rules.addEventListener('input', readBack)

  try { fillForm(await api.getConfig()) } catch { /* the Connection row opens itself and says why */ }
}

window.addEventListener('beforeunload', () => { if (mic !== 'off') void bridge?.audioControl(false) })
void startPhonePage()
void startGlasses()
void poll()
setInterval(poll, POLL_MS)
