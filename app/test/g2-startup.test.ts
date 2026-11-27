import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('./fixtures/g2-startup-fixture.mjs', import.meta.url))

function runFixture(scenario: string) {
  const output = execFileSync(process.execPath, [fixture, scenario], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 15_000, maxBuffer: 2_000_000,
  })
  const line = output.split('\n').find(value => value.startsWith('{"scenario":'))
  assert.ok(line, `G2 bridge fixture did not report a result for ${scenario}`)
  return JSON.parse(line) as { scenario: string; startup: number; lens: string }
}

test('G2 retries startup when a connected event arrives during a failed page creation', () => {
  const result = runFixture('race')
  assert.equal(result.startup, 2)
  assert.equal(result.lens, 'Glasses connected')
})

test('G2 retries startup when the current device snapshot is connected', () => {
  const result = runFixture('snapshot')
  assert.equal(result.startup, 2)
  assert.equal(result.lens, 'Glasses connected')
})

test('G2 retries after a later reconnect event', () => {
  const result = runFixture('recover')
  assert.equal(result.startup, 2)
  assert.equal(result.lens, 'Glasses connected')
})
