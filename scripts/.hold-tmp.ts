// Lens screenshots from the Even Hub simulator on demo data: `npm run screens`, optionally naming the shots.
// Writes the simulator's own PNGs (green, brightness in alpha, transparent background) to screens/.
// Idea and simulator steps from market-glimpse's scripts/screenshots.mjs (github.com/adamtorgerson/market-glimpse, 0BSD).
//
// Everything runs on its own ports: the demo server never touches a running one or the Telegram bot, and the simulator
// keeps settings per origin, so a server address saved for the dev server on :5173 does not apply here.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SERVER_PORT = 8790
const VITE_PORT = 5199
const AUTOMATION = 'http://127.0.0.1:9898'
/** Long enough for a page and its images over the simulator's bridge. */
const SETTLE_MS = 5000

type Input = 'up' | 'down' | 'click' | 'double_click'
/** In order, one simulator run: each shot's inputs go after the last shot's. Demo BTC nears liquidation after about 40 s, and that alert takes over the lens. */
const SHOTS: [string, Input[]][] = [
  ['main', []],
  ['detail', ['click']],
  ['detail-next', ['down']],
  ['main-again', ['double_click']],
]

const named = process.argv.slice(2)
const unknown = named.filter(n => !SHOTS.some(([s]) => s === n))
if (unknown.length) throw new Error(`Unknown shots: ${unknown.join(' ')} (have ${SHOTS.map(([s]) => s).join(' ')})`)
if (!process.env.VITE_APP_TOKEN) throw new Error('Set VITE_APP_TOKEN in .env: the app needs it to reach the demo server')

const out = new URL('../screens/', import.meta.url)
mkdirSync(out, { recursive: true })

// Its own process group, so one kill ends the child and what it started.
const start = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'], detached: true })
const stop = (p: ReturnType<typeof start>) => { try { process.kill(-p.pid!, 'SIGTERM') } catch { /* already gone */ } }

const server = start('node', ['.server-tmp/src/main.ts'], { EXCHANGE: 'fake', PORT: String(SERVER_PORT), HOST: '127.0.0.1', TELEGRAM_BOT_TOKEN: '', OPENAI_API_KEY: '' })
await new Promise<void>((ok, fail) => {
  server.stdout!.on('data', (d: Buffer) => { if (d.toString().includes('server on')) ok() })
  server.on('exit', code => fail(new Error(`demo server exited (${code})`)))
})
const vite = await createServer({
  configFile: fileURLToPath(new URL('../app/vite.config.ts', import.meta.url)),
  logLevel: 'warn',
  server: { port: VITE_PORT, strictPort: true, proxy: { '/api': `http://127.0.0.1:${SERVER_PORT}` } },
})
await vite.listen()
const sim = start('node_modules/.bin/evenhub-simulator', [`http://localhost:${VITE_PORT}`, '--automation-port', '9898'])

async function automation(path: string, body?: object) {
  const res = await fetch(AUTOMATION + path, body && { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res
}

try {
  for (let t = Date.now(); !(await automation("/api/ping").then(() => true, () => false)); await sleep(250)) {}
  console.log("READY"); await sleep(Number(process.env.HOLD_MS || 600000))
} finally { stop(sim); await vite.close(); stop(server) }
if (false) try {
  for (let t = Date.now(); !(await automation('/api/ping').then(() => true, () => false)); await sleep(250)) {
    if (Date.now() - t > 30_000) throw new Error('simulator did not start in 30 s')
  }
  await sleep(SETTLE_MS) // the start-up page, then the first poll
  for (const [name, inputs] of SHOTS) {
    for (const action of inputs) { await automation('/api/input', { action }); await sleep(800) } // past the 700 ms swipe gate
    await sleep(SETTLE_MS)
    if (named.length && !named.includes(name)) continue
    writeFileSync(new URL(`${name}.png`, out), Buffer.from(await (await automation('/api/screenshot/glasses')).arrayBuffer()))
    console.log(`screens/${name}.png`)
  }
  const { entries } = await (await automation('/api/console')).json() as { entries: { level: string; message: string }[] }
  for (const e of entries.filter(e => e.level === 'error')) console.warn(`console: ${e.message}`)
} finally {
  stop(sim)
  await vite.close()
  stop(server)
}
