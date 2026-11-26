// The sandbox does not send the recording to a transcription service. These checks lock the two seams:
// the stand-in audio is loud enough for POST /api/voice, and the word the browser heard is what that route reads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loud } from '../../../server/src/stt.ts'
import { beginUtterance, hear, pcmFrame, transcript } from '../src/voice.ts'

test('the browser transcript is what the sandbox server reads', async () => {
  beginUtterance()
  hear('  да ')
  assert.equal(await transcript(20), 'да')
  beginUtterance()
  const late = transcript(200)
  setTimeout(() => hear('yes'), 15)
  assert.equal(await late, 'yes')
})

test('the stand-in recording is loud enough for the voice route', () => {
  const frame = pcmFrame()
  const pcm = new Uint8Array(frame.length * 3)
  pcm.set(frame, 0)
  pcm.set(frame, frame.length)
  pcm.set(frame, frame.length * 2)
  assert.ok(pcm.byteLength >= 9600)
  assert.equal(loud(pcm), true)
})
