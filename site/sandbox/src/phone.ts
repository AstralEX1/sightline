/**
 * The landing page's phone (phone.html): the real app, app/src/main.ts unchanged, with its platform in the same window:
 * the Even app's bridge (host.ts) and the real server (backend.ts) on the account server/src/main.ts starts its demo
 * with. The glasses draw on the landing's #demo-lens, and its [data-gesture] buttons are the ring.
 */
import { createBackend } from './backend.ts'
import { createHost, type Gesture } from './host.ts'
import { Lens } from './lens.ts'
import { demoExchange } from '../../../server/src/fake-exchange.ts'
import { CLOSE_SEED, STARTER_RULES, VOICE_SEEDS } from '../../../server/src/registry.ts'

let page: Document | null = null
try { page = parent === window ? null : parent.document } catch { /* framed by another site */ }
const lens = page?.getElementById('demo-lens') as HTMLCanvasElement | null

const host = createHost(new Lens(lens ?? document.createElement('canvas')))
const backend = createBackend(demoExchange(Date.now()).ex, [...STARTER_RULES, ...VOICE_SEEDS, CLOSE_SEED])

if (lens) {
  lens.onclick = () => host.gesture('tap')
  for (const b of lens.parentElement?.querySelectorAll<HTMLButtonElement>('[data-gesture]') ?? []) b.onclick = () => host.gesture(b.dataset.gesture as Gesture)
}

host.attach(window)
const own = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  return url.pathname.startsWith('/api/') ? backend.fetch(input, init) : own(input, init)
}
await import('../../../app/src/main.ts')
