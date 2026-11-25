import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { encodePng4, gray4Levels } from '../src/png.ts'

test('gray4Levels: black, white and mid grey', () => {
  assert.deepEqual([...gray4Levels(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 136, 136, 136, 255]))], [0, 15, 8])
})

test('encodePng4: a valid 4-bit indexed PNG whose rows hold the levels, two pixels a byte', async () => {
  const png = Buffer.from(await encodePng4(Uint8Array.from([15, 0, 7, 1, 2, 3]), 3, 2))
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(png.toString('latin1', 12, 16), 'IHDR')
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]], [3, 2, 4, 3])
  const idat = png.indexOf('IDAT')
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)))
  assert.deepEqual([...raw], [0, 0xf0, 0x70, 0, 0x12, 0x30])
})
