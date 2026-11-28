import { fileURLToPath } from 'node:url'
import type { Exchange } from './types.ts'
import { createSession } from './session.ts'
import { createServer } from './http.ts'
import { createStore } from './store.ts'
import { createNotifier } from './notify.ts'
import { tokenProblem } from './config.ts'
import { assertTestnet, createBybit } from './bybit.ts'
import { demoExchange } from './fake-exchange.ts'
import { transcribe } from './stt.ts'
import { CLOSE_SEED, STARTER_RULES, VOICE_SEEDS } from './registry.ts'

const TICK_MS = 2000
const env = process.env

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const token = env.APP_TOKEN ?? ''
const mode = env.EXCHANGE === 'bybit' ? 'bybit' : 'fake'
const publicDemo = env.PUBLIC_DEMO === '1'
const port = Number(env.PORT) || 8787
const host = env.HOST || '127.0.0.1'
const problem = tokenProblem(token, publicDemo)
if (problem) fail(problem)

let ex: Exchange
let source = 'Demo data' // shown on the phone page, so nobody mistakes the demo for an account
if (publicDemo && mode !== 'fake') fail('PUBLIC_DEMO requires EXCHANGE=fake.')
if (mode === 'bybit') {
  const base = env.BYBIT_BASE || 'https://api-testnet.bybit.com'
  try {
    assertTestnet(base)
  } catch (e) {
    fail((e as Error).message)
  }
  if (!env.BYBIT_API_KEY || !env.BYBIT_API_SECRET) fail('Set BYBIT_API_KEY and BYBIT_API_SECRET for EXCHANGE=bybit.')
  ex = createBybit({ key: env.BYBIT_API_KEY, secret: env.BYBIT_API_SECRET, base })
  source = base.includes('demo') ? 'Bybit demo' : 'Bybit testnet'
} else {
  ex = demoExchange(Date.now()).ex
}

// One file per exchange mode, so demo shortcuts and alerts never mix with a real account's.
const paperDemo = mode === 'fake' && env.PAPER_DEMO === '1'
if (paperDemo) source = 'Paper'
const store = createStore(paperDemo ? ':memory:' : fileURLToPath(new URL(`../data/${mode}.db`, import.meta.url)))
const paperWindowSec = 120
const starterRules = paperDemo ? STARTER_RULES.filter(rule => rule.action.type === 'CLOSE_POSITION')
  .map(rule => ({ ...rule, trigger: { mode: 'REPEAT' as const, intervalSec: paperWindowSec } })) : STARTER_RULES
if (paperDemo) {
  const settings = store.settings()
  store.saveSettings({ ...settings, expiry: { ...settings.expiry, marketSec: paperWindowSec } })
}
store.seed([...starterRules, ...VOICE_SEEDS])
store.seed([CLOSE_SEED], 'seeded:close')
const notifier = createNotifier({ store })
const session = createSession(ex, store, Date.now, notifier.route)

let busy = false
async function tick() {
  if (busy) return // never overlap: a slow exchange must not stack polls
  busy = true
  try {
    await session.tick()
  } catch (e) {
    console.error('tick failed', e)
  } finally {
    busy = false
  }
}
void tick()
setInterval(tick, TICK_MS)

const openaiKey = publicDemo ? undefined : env.OPENAI_API_KEY
createServer({
  session, store, token, publicDemo, notifier, source,
  apiKeyInfo: () => ex.apiKeyInfo(),
  transcribe: openaiKey ? pcm => transcribe(pcm, openaiKey) : undefined,
}).listen(port, host, () => console.log(`Trade Shortcuts server on http://${host}:${port} (exchange: ${mode}, voice: ${openaiKey ? 'on' : 'off'})`))
