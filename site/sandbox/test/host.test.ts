import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHost } from '../src/host.ts'
import type { Lens } from '../src/lens.ts'

test('sandbox host does not expose or accept browser voice input', async () => {
  const host = createHost({} as Lens)
  assert.equal('allowMic' in host, false)
  assert.equal('setMicEnabled' in host, false)
  assert.equal('voiceBusy' in host, false)
  assert.equal('micDenied' in host, false)

  const app = {} as Window & { flutter_inappwebview?: { callHandler(name: string, message: string): Promise<unknown> } }
  host.attach(app)
  const result = await app.flutter_inappwebview!.callHandler('evenAppMessage', JSON.stringify({
    method: 'audioControl',
    data: { isOpen: true },
  }))
  assert.equal(result, null)
})
