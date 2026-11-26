/**
 * The Even app's side of the bridge, for a page that is not inside the Even app. The SDK calls
 * `flutter_inappwebview.callHandler('evenAppMessage', …)` and listens on `window._listenEvenAppMessage`; the official
 * simulator plays this part on the desktop, this does it in the browser and draws on a Lens.
 */
import type { Lens, Page, TextBox } from './lens.ts'
import { beginUtterance, hear, pcmFrame } from './voice.ts'

export type Gesture = 'up' | 'down' | 'tap' | 'double' | 'long' | 'menu'

type AppWindow = Window & {
  flutter_inappwebview?: { callHandler(name: string, message: string): Promise<unknown> }
  _listenEvenAppMessage?: (message: unknown) => void
}

// OsEventTypeList in the SDK
const EVENT: Record<Exclude<Gesture, 'menu' | 'long'>, number> = { tap: 0, up: 1, down: 2, double: 3 }
const STATUS = { sn: 'SANDBOX', connectType: 'connected', isWearing: true, batteryLevel: 86, isCharging: false, isInCase: false }

const FRAME = [...pcmFrame()] // reused: the app only checks that the recording is loud
const HOLD_MS = 2000 // after the mic closes, a spoken yes still has to start its countdown

type SpeechResult = { readonly 0: { transcript: string } }
type SpeechRec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((ev: { results: ArrayLike<SpeechResult> }) => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

function speechRecognition(): SpeechRec | null {
  const w = window as Window & { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

/** `onExit`: the app asked the Even app to close it (double tap on its main screen). `voice`: the browser mic can answer a card. */
export function createHost(lens: Lens, onExit: () => void = () => {}, opts?: { voice?: boolean }) {
  const voice = opts?.voice === true
  const storage = new Map([['gt.hints', 'on'], ['gt.voice', voice ? 'on' : 'off']])
  let app: AppWindow | null = null
  const send = (method: string, data: unknown) => app?._listenEvenAppMessage?.({ type: 'listen_even_app_data', method, data })

  let open = false
  let live = 0
  let ear: SpeechRec | null = null
  let pump = 0
  let busyUntil = 0
  let asked: Promise<boolean> | null = null
  let denied = voice && !speechRecognition()

  const frames = () => send('evenHubEvent', { type: 'audioEvent', jsonData: { audioPcm: FRAME, source: 'glasses' } })
  const stopMic = () => {
    open = false
    clearInterval(pump)
    ear?.stop()
    ear = null
    busyUntil = Date.now() + HOLD_MS // a yes is about to count down; a gesture during that must not land first
  }
  const startMic = () => {
    const rec = speechRecognition()
    if (!rec) { denied = true; return false }
    const mine = ++live
    open = true
    beginUtterance()
    rec.lang = navigator.language || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = ev => {
      if (mine !== live) return
      const parts: string[] = []
      for (let i = 0; i < ev.results.length; i++) parts.push(ev.results[i][0].transcript)
      hear(parts.join(' '))
    }
    rec.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') denied = true }
    rec.onend = () => { if (mine === live && open) { try { rec.start() } catch { /* the next open starts a fresh one */ } } }
    try { rec.start() } catch { open = false; denied = true; return false }
    ear = rec
    frames(); frames(); frames() // 0.3 s: the app will not post a shorter recording
    pump = window.setInterval(frames, 250)
    return true
  }

  const methods: Record<string, (d: Record<string, unknown>) => unknown> = {
    getUserInfo: () => ({ uid: 0, name: 'Sandbox', avatar: '', country: '' }),
    getGlassesInfo: () => ({ model: 'g2', sn: STATUS.sn, status: STATUS }),
    setLocalStorage: d => { storage.set(String(d.key), String(d.value)); return true },
    createStartUpPageContainer: d => { lens.setPage(d as Page); return 0 },
    rebuildPageContainer: d => { lens.setPage(d as Page); return true },
    textContainerUpgrade: d => lens.setText(String(d.containerName), String(d.content ?? ''), d.textColor as number | undefined),
    updateImageRawData: async d => ((await lens.setImage(String(d.containerName), d.imageData as number[])) ? 'success' : 'imageException'),
    shutDownPageContainer: () => { onExit(); return true }, // the exit dialogue: the sandbox keeps the app open
    audioControl: d => {
      if (!voice) return false
      if (d.isOpen !== true) { if (open) stopMic(); return true }
      if (open) return true
      return startMic()
    },
    imuControl: () => false,
  }

  return {
    /** True while the mic is open, and for a moment after it closes so a spoken yes can start its countdown. */
    voiceBusy: () => voice && (open || Date.now() < busyUntil),
    /** True once this browser cannot hear, or the visitor refused the microphone. */
    micDenied: () => denied,
    /** Ask for the microphone during a click. Stopping the stream leaves the permission for speech recognition. */
    allowMic() {
      if (!voice || denied || !navigator.mediaDevices?.getUserMedia) return Promise.resolve(false)
      if (!asked) asked = navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop())
        return true
      }, () => { asked = null; denied = true; return false })
      return asked
    },
    /** Before the app's scripts run in that window. */
    attach(w: Window, current: () => boolean = () => true, defaults?: ReadonlyMap<string, string>) {
      if (open) stopMic()
      app = w as AppWindow
      app.flutter_inappwebview = {
        callHandler: async (_name, message) => {
          if (!current()) return null
          const m = JSON.parse(message) as { method: string; data?: Record<string, unknown> }
          if (m.method === 'getLocalStorage') {
            const key = String(m.data?.key)
            return storage.get(key) ?? defaults?.get(key) ?? ''
          }
          return methods[m.method]?.(m.data ?? {}) ?? null
        },
      }
    },

    /** Ring or temple input. Hold opens the page's contextual menu, which the Even app draws, not the plugin. */
    gesture(g: Gesture) {
      if (lens.menu) {
        const menu = lens.menu
        if (g === 'up' || g === 'down') { menu.at = (menu.at + (g === 'up' ? -1 : 1) + menu.items.length) % menu.items.length; lens.draw() }
        else if (g === 'tap') { lens.closeMenu(); send('evenHubEvent', { type: 'menuItemClickEvent', jsonData: { itemID: menu.items[menu.at].itemID } }) }
        else lens.closeMenu()
        return
      }
      if (g === 'menu' || g === 'long') return lens.openMenu()
      const eventType = EVENT[g]
      const capture: TextBox | undefined = lens.page.textObject?.find(t => t.isEventCapture)
      send('evenHubEvent', capture
        ? { type: 'textEvent', jsonData: { containerID: capture.containerID, containerName: capture.containerName, eventType } }
        : { type: 'sysEvent', jsonData: { eventType } })
    },
  }
}
