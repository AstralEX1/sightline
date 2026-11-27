// The sandbox does not send the recording to a transcription service. These checks lock the seams:
// a command is what the voice route reads, a sentence is not, and the stand-in audio is loud enough.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerOf } from '../../../server/src/rules.ts'
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

test('the first final command sticks, and a later sentence cannot replace it', async () => {
  beginUtterance()
  hear('yes')
  hear('no')
  hear('close the door')
  assert.equal(await transcript(20), 'yes')
})

test('a lower alternative can be the command, and a sentence is only heard', async () => {
  beginUtterance()
  hear(['yesterday', 'yes'])
  assert.equal(await transcript(20), 'yes')
  beginUtterance()
  hear('yes close it')
  assert.equal(await transcript(40), 'yes close it')
  assert.equal(answerOf('yes close it'), null)
})

test('an interim guess yields to the final result', async () => {
  beginUtterance()
  hear('yes', true, false)
  hear('yesterday', true, true)
  assert.equal(await transcript(40), 'yesterday')
  beginUtterance()
  const pending = transcript(400)
  hear('no', true, false)
  hear('yes', true, true)
  assert.equal(await pending, 'yes')
})

test('a quiet mic cannot confirm, and the other language\'s spelling still can', async () => {
  beginUtterance()
  hear('yes', false)
  hear('да', false)
  assert.equal(await transcript(40), '')
  beginUtterance()
  hear('yes', false)
  hear('да')
  assert.equal(await transcript(20), 'да')
  beginUtterance()
  hear('йес')
  assert.equal(await transcript(20), 'yes')
  beginUtterance()
  hear('Da.')
  assert.equal(await transcript(20), 'да')
  beginUtterance()
  hear('есть')
  assert.equal(await transcript(40), 'есть')
  beginUtterance()
  hear('закрой')
  assert.equal(await transcript(20), 'закрой')
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
