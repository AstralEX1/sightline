import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serverAddress } from '../src/server-address.ts'

test('allows the dev proxy, loopback and HTTPS backend addresses', () => {
  assert.equal(serverAddress(''), '')
  assert.equal(serverAddress('http://localhost:8787/'), 'http://localhost:8787')
  assert.equal(serverAddress('https://api.example.test/trade-shortcuts/'), 'https://api.example.test/trade-shortcuts')
})

test('rejects cleartext remote addresses and ambiguous URLs before sending a token', () => {
  for (const address of ['http://api.example.test', '//api.example.test', 'https://user@api.example.test', 'https://api.example.test?a=1', 'https://api.example.test/#/']) {
    assert.throws(() => serverAddress(address), /HTTPS server address/)
  }
})
