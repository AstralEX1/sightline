import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerOf, liqDistancePct, matchShortcut, normalizePhrase } from '../src/rules.ts'

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
