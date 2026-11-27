/**
 * The landing page's phone (phone.html): the real app, app/src/main.ts unchanged, with its platform in the same window:
 * the Even app's bridge (host.ts) and the real server (backend.ts) on the account server/src/main.ts starts its demo
 * with. The glasses draw on the landing's #demo-lens, and its [data-gesture] buttons are the ring.
 */
import { createBackend } from './backend.ts'
import { createHost, type Gesture } from './host.ts'
import { Lens } from './lens.ts'
import { demoExchange } from '../../../server/src/fake-exchange.ts'
import { CLOSE_SEED, STARTER_RULES } from '../../../server/src/registry.ts'

let page: Document | null = null
try { page = parent === window ? null : parent.document } catch { /* framed by another site */ }
const lens = page?.getElementById('demo-lens') as HTMLCanvasElement | null

const host = createHost(new Lens(lens ?? document.createElement('canvas')))
const backend = createBackend(demoExchange(Date.now()).ex, [...STARTER_RULES, CLOSE_SEED])

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
if (lens && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('landing-phone')
  const motion = matchMedia('(prefers-reduced-motion: no-preference)')
  if (motion.matches) {
    const root = document.getElementById('phone')!
    let bounce: Animation[] = []
    const rendered = new MutationObserver(() => {
      const tiles = [...root.querySelectorAll<HTMLElement>('.tile:has(.tile__body)')].slice(0, 3)
      if (!tiles.length) return
      rendered.disconnect()
      const visible = new IntersectionObserver(([entry]) => {
        if (entry.intersectionRatio < .65) return
        visible.disconnect()
        if (!motion.matches) return
        bounce = tiles.map((tile, i) => tile.animate([
          { transform: 'translateY(0)' },
          { transform: 'translateY(-7px)', offset: .36 },
          { transform: 'translateY(0)' },
        ], { duration: 540, delay: i * 110, easing: 'cubic-bezier(.22,.61,.36,1)' }))
      }, { threshold: .65 })
      visible.observe(tiles[0])
      root.addEventListener('pointerdown', () => {
        visible.disconnect()
        bounce.forEach(animation => animation.cancel())
      }, { once: true })
    })
    rendered.observe(root, { childList: true, subtree: true })
  }
}

await import('../../../app/src/main.ts')
