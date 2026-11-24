import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcribe, wav } from '../src/stt.ts'

test('wav wraps PCM in a 16 kHz mono 16-bit header', () => {
  const w = wav(new Uint8Array(3200))
  assert.equal(w.length, 3244)
  assert.equal(w.toString('ascii', 0, 4), 'RIFF')
  assert.equal(w.readUInt32LE(4), 3236)
  assert.equal(w.toString('ascii', 8, 16), 'WAVEfmt ')
  assert.equal(w.readUInt16LE(22), 1)
  assert.equal(w.readUInt32LE(24), 16_000)
  assert.equal(w.readUInt16LE(34), 16)
  assert.equal(w.readUInt32LE(40), 3200)
})

test('transcribe posts a wav with the hint and returns the text', async () => {
  let url = ''
  let init: RequestInit = {}
  const fake = (async (u: string, i: RequestInit) => { url = u; init = i; return new Response(JSON.stringify({ text: 'Buy ETH.' })) }) as typeof fetch
  assert.equal(await transcribe(new Uint8Array(3200), 'sk-test', 'buy eth', fake), 'Buy ETH.')
  assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions')
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer sk-test')
  const form = init.body as FormData
  assert.equal(form.get('model'), 'gpt-4o-mini-transcribe')
  assert.match(String(form.get('prompt')), /buy eth/)
  assert.equal((form.get('file') as File).size, 3244)
})

test('transcribe surfaces the API error', async () => {
  const fake = (async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 })) as typeof fetch
  await assert.rejects(transcribe(new Uint8Array(3200), 'bad', '', fake), /Invalid API key/)
})
