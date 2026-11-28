import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url))

test('public demo refuses to start with the Bybit exchange', () => {
  const result = spawnSync(process.execPath, [main], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      APP_TOKEN: '',
      EXCHANGE: 'bybit',
      PUBLIC_DEMO: '1',
    },
    encoding: 'utf8',
    timeout: 5000,
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /PUBLIC_DEMO requires EXCHANGE=fake/)
})
