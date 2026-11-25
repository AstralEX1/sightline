/**
 * The sandbox page. The phone frame runs the real app (app.html: app/src/main.ts unchanged); this page plays the Even
 * app for it (host.ts, drawing the lens), runs the real server against a simulated exchange (backend.ts, market.ts),
 * and plays one scenario per template.
 */
import './style.css'
import { CLOSE_SEED, STARTER_RULES, VOICE_SEEDS } from '../../../server/src/registry.ts'
import { createBackend, type Backend } from './backend.ts'
import { mountExchange } from './exchange.ts'
import { createHost, type Gesture } from './host.ts'
import { Lens } from './lens.ts'
import { Market, START_PRICE } from './market.ts'
import { draftOf, SCENARIOS, type Scenario } from './scenarios.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const lens = new Lens($<HTMLCanvasElement>('lens'))
const host = createHost(lens)
const market = new Market()
let backend: Backend

// What app-host.ts finds in the phone frame's parent.
;(window as unknown as { sandbox: object }).sandbox = {
  attach: host.attach,
  fetch: (input: RequestInfo | URL, init?: RequestInit) => backend.fetch(input, init),
}

mountExchange($('exchange'), market)
setInterval(() => market.refresh(), 500) // the app's trades change FakeExchange directly: show them

const phone = $<HTMLIFrameElement>('phone')

/** Free play: a BTC long with a stop and a target, and the shortcuts a new account starts with. */
async function freePlay() {
  run++
  backend?.stop()
  market.reset()
  await market.open('Buy', 0.05, 10, Math.round(START_PRICE * 1.03), Math.round(START_PRICE * 0.98))
  backend = createBackend(market.ex, [...STARTER_RULES, ...VOICE_SEEDS, CLOSE_SEED])
  say(null)
}

// ── scenarios ──
let run = 0
const caption = $('caption')
const steps = ['Shortcut on', 'Market moves', 'Alert on the glasses']

function say(s: Scenario | null, step = 0) {
  caption.hidden = !s
  if (!s) return
  caption.replaceChildren(
    Object.assign(document.createElement('b'), { textContent: `${s.title} · ${s.sub}` }),
    ...steps.map((t, i) => Object.assign(document.createElement('span'), {
      className: i < step ? 'done' : i === step ? 'now' : '',
      textContent: i === 1 ? s.watch : t,
    })),
  )
}

async function play(s: Scenario) {
  const id = ++run
  backend?.stop()
  market.reset()
  await s.before(market)
  backend = createBackend(market.ex, [draftOf(s, market)])
  phone.contentWindow?.location.reload() // the phone lists just this shortcut, the lens starts clean
  say(s, 0)
  await sleep(2200) // the app starts and the server's first poll sees the market before it moves
  if (id !== run) return
  say(s, 1)
  if (s.to) await glide(s.to(market), 2600, id)
  else await sleep(800)
  if (id !== run) return
  await backend.tick()
  say(s, 2)
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

const list = $('scenarios')
let group = ''
for (const s of SCENARIOS) {
  if (s.group !== group) {
    group = s.group
    list.append(Object.assign(document.createElement('h3'), { textContent: group }))
  }
  const b = document.createElement('button')
  b.type = 'button'
  b.innerHTML = '<span aria-hidden="true">▶</span>'
  b.append(Object.assign(document.createElement('b'), { textContent: s.title }), Object.assign(document.createElement('small'), { textContent: s.sub }))
  b.onclick = () => {
    for (const x of list.querySelectorAll('button')) x.removeAttribute('aria-current')
    b.setAttribute('aria-current', 'true')
    void play(s)
  }
  list.append(b)
}
$('reset').onclick = () => {
  for (const x of list.querySelectorAll('button')) x.removeAttribute('aria-current')
  void freePlay().then(() => phone.contentWindow?.location.reload())
}

// ── glasses input: buttons, the lens itself, the keyboard ──
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-gesture]')) b.onclick = () => host.gesture(b.dataset.gesture as Gesture)
$('lens').onclick = () => host.gesture('tap')
const KEYS: Record<string, Gesture> = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'tap', ' ': 'tap', Escape: 'double', Backspace: 'double', m: 'menu' }
document.addEventListener('keydown', e => {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, select, button, .ex-canvas') || e.metaKey || e.ctrlKey || e.altKey) return
  const g = KEYS[e.key]
  if (!g) return
  e.preventDefault()
  host.gesture(g)
})

// ── the world behind the lens: blurred clips, one after another ──
const clips = [...document.querySelectorAll<HTMLVideoElement>('.scene video')]
let clip = 0
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && clips.length > 1) {
  setInterval(() => {
    clips[clip].classList.remove('on')
    clip = (clip + 1) % clips.length
    void clips[clip].play().catch(() => {})
    clips[clip].classList.add('on')
  }, 16_000)
} else clips.forEach(v => { v.removeAttribute('autoplay'); v.pause() })

await freePlay()
phone.src = 'app.html'
