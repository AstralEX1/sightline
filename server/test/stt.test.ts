import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loud, transcribe, wav } from '../src/stt.ts'

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

test('transcribe posts a wav with no prompt or language and returns the text', async () => {
  let url = ''
  let init: RequestInit = {}
  const fake = (async (u: string, i: RequestInit) => { url = u; init = i; return new Response(JSON.stringify({ text: 'Buy ETH.' })) }) as typeof fetch
  assert.equal(await transcribe(new Uint8Array(3200), 'sk-test', fake), 'Buy ETH.')
  assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions')
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer sk-test')
  const form = init.body as FormData
  assert.equal(form.get('model'), 'gpt-4o-mini-transcribe')
  assert.equal(form.get('prompt'), null) // the model read a prompt back on silence
  assert.equal(form.get('language'), null)
  assert.equal((form.get('file') as File).size, 3244)
})

test('transcribe surfaces the API error', async () => {
  const fake = (async () => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 })) as typeof fetch
  await assert.rejects(transcribe(new Uint8Array(3200), 'bad', fake), /Invalid API key/)
})

test('loud: silence and hiss stay home, speech-level audio goes out', () => {
  const tone = (amp: number) => {
    const b = new Uint8Array(3200)
    const v = new DataView(b.buffer)
    for (let i = 0; i < 1600; i++) v.setInt16(i * 2, Math.round(amp * Math.sin(i / 5)), true)
    return b
  }
  assert.equal(loud(new Uint8Array(3200)), false)
  assert.equal(loud(tone(100)), false)
  assert.equal(loud(tone(3000)), true)
  assert.equal(loud(new Uint8Array(0)), false)
  const short = new Uint8Array(32_000) // 1 s of silence with one loud 100 ms word in it
  short.set(tone(3000), 16_000)
  assert.equal(loud(short), true)
})
