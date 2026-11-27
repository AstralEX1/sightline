/**
 * The app posts a recording and the server transcribes it. In the sandbox the recording is only loud
 * enough to pass the silence check. A listen keeps the first final yes, no, or close; the rest of the
 * ten seconds cannot replace it. Quiet audio cannot confirm: a recognizer invents "yes" from silence.
 */
import { answerOf, closeIntent } from '../../../server/src/rules.ts'

const WAIT_MS = 1200

// A one-language recognizer's spelling of the other language's word, and only as the whole utterance.
// "есть" and "но" are ordinary words, so they are not aliases.
const ALIAS: Record<string, string> = {
  'йес': 'yes',
  'йэс': 'yes',
  'ес': 'yes',
  da: 'да',
}

let text = ''
let locked = false
let provisional = false
let pending: ((word: string) => void) | null = null

/** A new listen. Drops whatever the previous one heard. */
export function beginUtterance() {
  text = ''
  locked = false
  provisional = false
}

function command(raw: string): string | null {
  const said = raw.replace(/\s+/g, ' ').trim()
  if (!said) return null
  const key = said.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const alias = ALIAS[key]
  // The alias wins so "Da." is stored as "да", which the server already accepts, not left as a guess.
  if (alias && (answerOf(alias) || closeIntent(alias))) return alias
  return answerOf(said) || closeIntent(said) ? said : null
}

/**
 * One utterance. Each entry is an alternative hypothesis, not a later sentence.
 * `loud` is false when the mic was quiet. `final` is false for an interim guess, which a later final may replace.
 */
export function hear(word: string | readonly string[], loud = true, final = true) {
  if (!loud || locked) return
  const list = typeof word === 'string' ? [word] : word
  let hit = ''
  let heard = ''
  for (const raw of list) {
    const cmd = command(raw)
    if (cmd) { hit = cmd; break }
    if (!heard) {
      const said = raw.replace(/\s+/g, ' ').trim()
      if (said) heard = said
    }
  }
  if (hit) {
    text = hit
    if (!final) { provisional = true; return }
    locked = true
    provisional = false
    pending?.(text)
    pending = null
    return
  }
  if (provisional && !final) return // the guess still stands until the recognizer finishes this utterance
  provisional = false
  if (heard) text = heard
}

/** What this listen heard. A command already locked resolves at once; a late final still has a moment after the mic closes. */
export function transcript(waitMs = WAIT_MS): Promise<string> {
  if (locked) return Promise.resolve(text)
  return new Promise(resolve => {
    const timer = setTimeout(() => { pending = null; resolve(text) }, waitMs)
    pending = () => { clearTimeout(timer); resolve(text) }
  })
}

/** 100 ms of 16 kHz s16le, loud enough that the server does not treat it as silence. */
export function pcmFrame(): Uint8Array {
  const samples = 1600
  const pcm = new Uint8Array(samples * 2)
  const view = new DataView(pcm.buffer)
  for (let i = 0; i < samples; i++) view.setInt16(i * 2, i % 20 < 10 ? 12_000 : -12_000, true)
  return pcm
}
