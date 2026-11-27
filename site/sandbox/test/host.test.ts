import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createHost } from '../src/host.ts'
import type { Lens } from '../src/lens.ts'
import { transcript } from '../src/voice.ts'

function setup(t: TestContext, getUserMedia: () => Promise<MediaStream>) {
  const starts: { lang: string; args: (MediaStreamTrack | undefined)[] }[] = []
  let onResult: (word: string) => void = () => {}
  let frames = 0
  class Recognizer {
    lang = ''
    onresult?: (event: unknown) => void
    start(...args: (MediaStreamTrack | undefined)[]) {
      starts.push({ lang: this.lang, args })
      onResult = word => this.onresult?.({ results: [Object.assign([{ transcript: word }], { isFinal: true })] })
    }
    stop() {}
  }

  Object.defineProperty(globalThis, 'window', { value: { SpeechRecognition: Recognizer, setTimeout, setInterval }, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
  const host = createHost({} as Lens, undefined, { voice: true })
  const app = { _listenEvenAppMessage: () => { frames++ } } as unknown as Window & {
    flutter_inappwebview: { callHandler(name: string, message: string): Promise<unknown> }
  }
  host.attach(app)
  const audio = (isOpen: boolean) => app.flutter_inappwebview.callHandler('evenAppMessage', JSON.stringify({ method: 'audioControl', data: { isOpen } }))
  t.after(async () => {
    await audio(false)
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(navigator, 'mediaDevices')
    Reflect.deleteProperty(navigator, 'language')
  })
  return { audio, host, starts, say: (word: string) => onResult(word), frames: () => frames }
}

function streamWith(tracks: MediaStreamTrack[]): MediaStream {
  return { getAudioTracks: () => tracks, getTracks: () => tracks } as MediaStream
}

test('voice starts one recognizer on its own microphone without a live track', async t => {
  const { audio, starts, say, frames } = setup(t, async () => streamWith([]))
  assert.equal(await audio(true), true)
  assert.deepEqual(starts, [{ lang: 'en-US', args: [] }])
  assert.ok(frames() >= 3)
  say('yes')
  assert.equal(await transcript(20), 'yes')
})

test('voice keeps separate English and Russian track-fed recognizers with a live track', async t => {
  const cloned: MediaStreamTrack[] = []
  const track = { readyState: 'live', stop() {}, clone() {
    const copy = { readyState: 'live', stop() {} } as MediaStreamTrack
    cloned.push(copy)
    return copy
  } } as MediaStreamTrack
  const { audio, starts } = setup(t, async () => streamWith([track]))
  assert.equal(await audio(true), true)
  assert.equal(cloned.length, 2)
  assert.deepEqual(starts, [{ lang: 'en-US', args: [cloned[0]] }, { lang: 'ru-RU', args: [cloned[1]] }])
})

test('closing the microphone cancels a pending capture and releases the late stream', async t => {
  let resolvePending: (stream: MediaStream) => void = () => {}
  const pending = new Promise<MediaStream>(resolve => { resolvePending = resolve })
  let stopped = false
  const track = { stop() { stopped = true } } as MediaStreamTrack
  const { audio, starts, frames } = setup(t, () => pending)
  const opening = audio(true)
  await audio(false)
  resolvePending(streamWith([track]))
  assert.equal(await opening, false)
  assert.deepEqual(starts, [])
  assert.equal(frames(), 0)
  assert.equal(stopped, true)
})

test('an explicit microphone permission refusal leaves voice unavailable', async t => {
  const { audio, host, starts, frames } = setup(t, async () => { throw new DOMException('Denied', 'NotAllowedError') })
  assert.equal(await audio(true), false)
  assert.equal(host.micDenied(), true)
  assert.deepEqual(starts, [])
  assert.equal(frames(), 0)
})
