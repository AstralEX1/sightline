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
const LOUD_RMS = 0.009 // float samples; the server's silence gate is the same level on int16
const LOUD_MS = 1000
const BOOST = 5
const COMMANDS = [
  { lang: 'en-US', phrases: ['yes', 'no', 'yeah', 'okay', 'close'] },
  { lang: 'ru-RU', phrases: ['да', 'нет', 'ага', 'ок', 'закрой'] },
] as const

type SpeechAlt = { transcript: string }
type SpeechHit = ArrayLike<SpeechAlt> & { isFinal: boolean }
type PhraseList = { length: number; splice(start: number, n: number): unknown; push(item: object): unknown }
type SpeechRec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  processLocally: boolean
  unspokenPunctuation: boolean
  phrases?: PhraseList
  onaudiostart: (() => void) | null
  onresult: ((ev: { results: ArrayLike<SpeechHit> }) => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onend: (() => void) | null
  start(track?: MediaStreamTrack): void
  stop(): void
}
type SpeechCtor = {
  new (): SpeechRec
  install?(options: { langs: string[]; processLocally: boolean; quality: string }): Promise<boolean>
}

function speechCtor(): SpeechCtor | null {
  const w = window as Window & { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const permissionDenied = (error: unknown) => error instanceof Error && error.name === 'NotAllowedError'

function bias(rec: SpeechRec, phrases: readonly string[]) {
  const Phrase = (window as Window & { SpeechRecognitionPhrase?: new (phrase: string, boost: number) => object }).SpeechRecognitionPhrase
  if (!Phrase || !rec.phrases) return
  try {
    rec.phrases.splice(0, rec.phrases.length)
    for (const phrase of phrases) rec.phrases.push(new Phrase(phrase, BOOST))
  } catch { /* this engine has no phrase list */ }
}

/** `onExit`: the app asked the Even app to close it (double tap on its main screen). `voice`: the browser mic can answer a card. */
export function createHost(lens: Lens, onExit: () => void = () => {}, opts?: { voice?: boolean }) {
  const voice = opts?.voice === true
  const storage = new Map([['gt.hints', 'on'], ['gt.voice', voice ? 'on' : 'off']])
  let app: AppWindow | null = null
  const send = (method: string, data: unknown) => app?._listenEvenAppMessage?.({ type: 'listen_even_app_data', method, data })

  let open = false
  let live = 0
  let ears: SpeechRec[] = []
  let pump = 0
  let busyUntil = 0
  let asked: Promise<boolean> | null = null
  let denied = voice && !speechCtor()
  let packs = false
  let usingTracks = false
  let micStream: MediaStream | null = null
  let clones: MediaStreamTrack[] = []
  let stopLevel: (() => void) | null = null
  let metered = false
  let loudAt = 0
  let heardAudio = false
  let trackWatch = 0

  const frames = () => send('evenHubEvent', { type: 'audioEvent', jsonData: { audioPcm: FRAME, source: 'glasses' } })
  const releaseMic = () => {
    stopLevel?.()
    stopLevel = null
    for (const track of clones) track.stop()
    clones = []
    micStream?.getTracks().forEach(track => track.stop())
    micStream = null
    metered = false
  }
  const stopMic = () => {
    open = false
    clearTimeout(trackWatch)
    clearInterval(pump)
    for (const rec of ears) rec.onend = null
    for (const rec of ears) try { rec.stop() } catch { /* already ending */ }
    ears = []
    releaseMic()
    busyUntil = Date.now() + HOLD_MS // a yes is about to count down; a gesture during that must not land first
  }

  /** Level of the open mic. A command is accepted only when this was loud within the last second. */
  const watchLevel = (stream: MediaStream) => {
    stopLevel?.()
    let timer = 0
    let closed = false
    try {
      const ctx = new AudioContext()
      void ctx.resume()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      src.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      const tick = () => {
        if (closed) return
        // A context opened with the alert, not the click, stays suspended and would read silence as "quiet".
        if (ctx.state !== 'running') { metered = false; void ctx.resume(); timer = window.setTimeout(tick, 30); return }
        metered = true
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) sum += sample * sample
        if (Math.sqrt(sum / samples.length) >= LOUD_RMS) loudAt = performance.now()
        timer = window.setTimeout(tick, 30) // a short "да" is one syllable; a 100 ms poll can miss it
      }
      tick()
      stopLevel = () => {
        if (closed) return
        closed = true
        clearTimeout(timer)
        src.disconnect()
        void ctx.close()
        metered = false
      }
    } catch {
      metered = false
      stopLevel = null
    }
  }

  const recentlyLoud = () => !metered || performance.now() - loudAt < LOUD_MS

  /** One command recognizer. `track` lets a second language listen on the same mic; without it the engine takes the mic itself. */
  const createEar = (mine: number, lang: string, phrases: readonly string[], track?: MediaStreamTrack): SpeechRec | null => {
    const Ctor = speechCtor()
    if (!Ctor) return null
    const rec = new Ctor()
    let local = true
    let biased = true
    let faults = 0
    const apply = () => {
      rec.lang = lang
      rec.continuous = false
      rec.interimResults = true
      rec.maxAlternatives = 5
      try { rec.processLocally = local } catch { local = false }
      try { rec.unspokenPunctuation = false } catch { /* this engine picks its own punctuation */ }
      if (biased) bias(rec, phrases)
    }
    const listen = () => {
      apply()
      if (track && track.readyState === 'live') rec.start(track)
      else rec.start()
    }
    rec.onaudiostart = () => { if (mine === live && open) heardAudio = true }
    rec.onresult = ev => {
      if (mine !== live || !open) return
      faults = 0
      const last = ev.results[ev.results.length - 1]
      if (!last?.length) return
      const alts: string[] = []
      for (let i = 0; i < last.length; i++) alts.push(last[i].transcript)
      hear(alts, recentlyLoud(), last.isFinal)
    }
    rec.onerror = ev => {
      if (mine !== live || !open) return
      const error = ev.error
      if (error === 'not-allowed') { denied = true; return }
      if (error === 'no-speech') return // the utterance ended with nothing; onend starts the next one
      faults++
      if (error === 'audio-capture') {
        dropEar(rec)
        if (ears.length) return
        if (usingTracks) startOwnMic(mine)
        else denied = true
        return
      }
      if (error === 'phrases-not-supported') {
        biased = false
        try { rec.phrases?.splice(0, rec.phrases.length) } catch { /* leave the list; the next start will fail closed */ }
        return
      }
      // One language failing leaves the other session up. Only an empty pair means this browser cannot hear.
      if (local && (error === 'language-not-supported' || error === 'service-not-allowed')) { local = false; return }
      if (error === 'language-not-supported' || error === 'service-not-allowed') {
        dropEar(rec)
        if (!ears.length) denied = true
      }
    }
    rec.onend = () => {
      if (mine !== live || !open || denied || faults > 4) return
      try { listen() } catch { /* stopped */ }
    }
    try { listen() } catch { return null }
    return rec
  }

  const dropEar = (rec: SpeechRec) => {
    rec.onend = null
    try { rec.stop() } catch { /* already ending */ }
    ears = ears.filter(item => item !== rec)
  }

  /** The page asks for yes and да. One recognizer hears the browser's language; the other word is an alias. */
  const browserCommand = () => (navigator.language || '').toLowerCase().startsWith('ru') ? COMMANDS[1] : COMMANDS[0]

  /** Without a usable track, one session can use the speech engine's own mic. */
  const startOwnMic = (mine: number) => {
    if (denied || mine !== live || !open) return
    usingTracks = false
    for (const rec of ears) rec.onend = null
    for (const rec of ears) try { rec.stop() } catch { /* ending */ }
    ears = []
    releaseMic()
    const one = browserCommand()
    const rec = createEar(mine, one.lang, one.phrases)
    if (rec) ears = [rec]
    else denied = true
  }

  const startMic = async () => {
    if (denied || !speechCtor()) { denied = true; return false }
    const mine = ++live
    open = true
    beginUtterance()
    if (!micStream?.getAudioTracks().some(track => track.readyState === 'live') && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (mine !== live || !open) { stream.getTracks().forEach(item => item.stop()); return false }
        micStream = stream
        watchLevel(stream)
      } catch (error) {
        if (mine !== live || !open) return false
        releaseMic()
        if (permissionDenied(error)) denied = true
      }
    }
    if (mine !== live || !open) return false
    heardAudio = false
    const track = micStream?.getAudioTracks().find(item => item.readyState === 'live')
    usingTracks = Boolean(track)
    ears = []
    if (track) {
      for (const spec of COMMANDS) {
        const owned = track.clone()
        clones.push(owned)
        const generation = ears
        const rec = createEar(mine, spec.lang, spec.phrases, owned)
        if (!usingTracks) break // an error already switched to the engine's mic
        if (rec && ears === generation) ears.push(rec)
        else owned.stop()
      }
    }
    if (!ears.length) startOwnMic(mine)
    if (mine !== live || !open) return false
    if (!ears.length) { open = false; releaseMic(); denied = true; return false }
    // A browser that ignores start(track) keeps our capture and then hears nothing. Fall back once that shows.
    clearTimeout(trackWatch)
    if (usingTracks) trackWatch = window.setTimeout(() => {
      if (usingTracks && !heardAudio) startOwnMic(mine)
    }, 1200)
    frames(); frames(); frames() // 0.3 s: the app will not post a shorter recording
    pump = window.setInterval(frames, 250)
    return true
  }

  const installPacks = () => {
    const Ctor = speechCtor()
    if (!Ctor?.install || packs) return
    packs = true
    try { void Ctor.install({ langs: ['en-US', 'ru-RU'], processLocally: true, quality: 'command' }).catch(() => {}) }
    catch { /* no on-device packs in this browser */ }
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
    /** Ask for the microphone during a click, and for the on-device command packs. */
    allowMic() {
      if (!voice || denied || !navigator.mediaDevices?.getUserMedia) return Promise.resolve(false)
      installPacks()
      if (!asked) asked = navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop()) // permission only; the listen opens the mic again
        return true
      }, error => { asked = null; if (permissionDenied(error)) denied = true; return false })
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
