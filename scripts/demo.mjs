// `npm run demo`: one command from a fresh clone. Installs and starts an isolated paper server, app and G2 simulator. Ctrl+C stops all.
// Plain JS, not TS, so an old Node gets a clear message instead of a syntax error.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) fail(`Node.js 22.18 or later is needed (you have ${process.versions.node}): https://nodejs.org`)
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
const win = process.platform === 'win32'

if (!existsSync('node_modules/.package-lock.json')) {
  console.log('Installing dependencies (npm ci)…')
  if (spawnSync('npm', ['ci'], { stdio: 'inherit', shell: win }).status !== 0) fail('npm ci failed, see above')
}

// Separate loopback port and fresh in-memory account on every run, even in a configured checkout.
const port = 8788
const token = randomBytes(32).toString('hex')
for (const p of [port, 5173, 9898]) if (await listening(p)) fail(`Port ${p} is in use. Close the earlier demo and try again.`)

const children = []
const start = (program, args, extraEnv = {}) => {
  const child = spawn(program, args, { stdio: 'inherit', shell: win && program === 'npm', detached: !win, env: { ...process.env, ...extraEnv } })
  child.on('exit', code => { if (!stopping) { console.error(`\n${program} ${args.join(' ')} exited (${code}), stopping the demo`); stop(1) } })
  children.push(child)
}
let stopping = false
function stop(code = 0) {
  stopping = true
  for (const c of children) {
    try { win ? spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f']) : process.kill(-c.pid, 'SIGTERM') } catch { /* already gone */ }
  }
  process.exit(code)
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

start(process.execPath, ['server/src/main.ts'], {
  APP_TOKEN: token, EXCHANGE: 'fake', PAPER_DEMO: '1', HOST: '127.0.0.1', PORT: String(port),
  OPENAI_API_KEY: '', BYBIT_API_KEY: '', BYBIT_API_SECRET: '',
})
await waitFor(port, 'server')
start('npm', ['run', 'dev', '--', '--mode', 'paper', '--strictPort'], { APP_TOKEN: token, PORT: String(port) })
await waitFor(5173, 'app')
start('npm', ['run', 'sim', '--', '--automation-port', '9898'])
console.log(`
Trade Shortcuts demo is running. Two simulator windows open: "Browser" is the phone page, "Glasses Display" is the G2 lens.
  1. The lens lists demo positions BTC, ETH, SOL (a paper exchange, no real money).
  2. Wait for the "Near liquidation · half" BTC alert. It appears about 30 s after start and is open for 120 s.
  3. Press Down. When the cursor reaches "Close 50%", click to confirm. The lens shows the fill.
  4. On the phone page, open History (clock icon, top left) to see the trade.
The phone tied to the glasses is the simulator window named Browser. A separate tab at http://localhost:5173 does not drive Glasses Display. Ctrl+C stops everything.
`)

function listening(p) {
  return new Promise(ok => {
    const s = connect({ port: p, host: 'localhost' })
    s.once('connect', () => { s.destroy(); ok(true) })
    s.once('error', () => ok(false))
  })
}
async function waitFor(p, name) {
  for (const t = Date.now(); !(await listening(p)); await new Promise(r => setTimeout(r, 250))) {
    if (Date.now() - t > 60_000) { console.error(`The ${name} did not start on port ${p} in 60 s`); stop(1) }
  }
}
function fail(message) {
  console.error(message)
  process.exit(1)
}
