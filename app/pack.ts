import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serverAddress } from './src/server-address.ts'

const [address = '', output = 'trade-shortcuts.ehpk'] = process.argv.slice(2)
let origin: string
try {
  origin = serverAddress(address)
  if (!origin.startsWith('https://') || new URL(origin).origin !== origin) throw new Error()
} catch {
  console.error('Usage: npm run pack -- https://your-backend.example [output.ehpk]')
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'trade-shortcuts-pack-'))
try {
  const dist = join(work, 'dist')
  const manifestPath = join(work, 'app.json')
  const manifest = JSON.parse(readFileSync('app/app.json', 'utf8'))
  const network = manifest.permissions.find((permission: { name: string }) => permission.name === 'network')
  network.whitelist = [origin]
  writeFileSync(manifestPath, JSON.stringify(manifest))
  execFileSync('npm', ['run', 'build', '--', '--outDir', dist], {
    stdio: 'inherit',
    env: { ...process.env, VITE_TRADE_SHORTCUTS_BACKEND_ORIGIN: origin },
  })
  execFileSync('evenhub', ['pack', manifestPath, dist, '--sdk-ver', manifest.min_sdk_version, '-o', output], { stdio: 'inherit' })
} finally {
  rmSync(work, { recursive: true, force: true })
}
