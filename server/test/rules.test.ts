import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerOf, closeIntent, liqDistancePct, matchShortcut, normalizePhrase } from '../src/rules.ts'

test('matchShortcut takes the longest whole-word phrase', () => {
  const list = [{ voicePhrase: 'protect' }, { voicePhrase: 'protect all' }, {}, { voicePhrase: 'buy eth' }]
  assert.equal(matchShortcut('Please, PROTECT ALL now', list)?.voicePhrase, 'protect all')
  assert.equal(matchShortcut('protection', list), null) // whole words only
  assert.equal(matchShortcut('buy ethereum', list), null)
})

test('normalizePhrase keeps lowercase words and digits', () => {
  assert.equal(normalizePhrase('  Buy  ETH-2!! '), 'buy eth 2')
})

test('liquidation distance is Infinity without a liquidation price', () => {
  const p = { liqPrice: 0, markPrice: 100 } as Parameters<typeof liqDistancePct>[0]
  assert.equal(liqDistancePct(p), Infinity)
  assert.equal(liqDistancePct({ ...p, liqPrice: 95 }), 5)
})

test('answerOf: whole yes or no answers in many languages, anything else is no answer', () => {
  for (const t of ['Yes.', 'OK!', 'Okay', 'yes please', 'Go ahead.', 'Да.', 'Давай', 'Ja', 'Oui.', 'Sí', 'Sim', 'Tak', 'Evet', '好的。', 'はい', '네', 'نعم', 'हाँ']) assert.equal(answerOf(t), 'yes', t)
  for (const t of ['No.', 'Nope', 'Cancel!', 'Нет.', 'Отмена', 'Nein', 'Non', 'Não', 'Nie', 'Hayır', '取消', 'いいえ', '아니요', 'لا', 'नहीं', 'Stop']) assert.equal(answerOf(t), 'no', t)
  for (const t of ['', 'Thank you.', 'Yes, close it', 'no idea', 'Так.', 'ha', 'Trading voice commands such as: lock profits', 'Продолжение следует...']) assert.equal(answerOf(t), null, t)
})

test('closeIntent: a whole close phrase, or close plus a ticker; a sentence is not a close', () => {
  for (const t of ['Close.', 'close it', 'close position', 'Закрой.', 'закрыть позицию', 'закрой позу', 'Close please']) assert.deepEqual(closeIntent(t), { all: false }, t)
  for (const t of ['close all', 'Close everything!', 'закрой все', 'закрыть все позиции']) assert.deepEqual(closeIntent(t), { all: true }, t)
  assert.deepEqual(closeIntent('close BTC'), { all: false, coin: 'btc' })
  assert.deepEqual(closeIntent('Закрой eth'), { all: false, coin: 'eth' })
  for (const t of ['', 'yes', 'close the door', 'yes, close it', 'closing', 'no idea']) assert.equal(closeIntent(t), null, t)
})
