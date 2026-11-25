/**
 * 4-bit greyscale PNGs for image containers: the lens shows 16 greys, so an 8-bit canvas PNG only sends bytes it drops.
 * Adapted from market-glimpse's src/png.ts (github.com/adamtorgerson/market-glimpse, 0BSD); deflate is the
 * platform's CompressionStream here instead of pako.
 */

/** RGBA → one grey level 0–15 per pixel. */
export function gray4Levels(px: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(px.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = Math.round((0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 17)
  return out
}

/** Grey levels (0–15, one per pixel, row by row) as a 4-bit indexed PNG with a 16-grey palette; rows unfiltered. */
export async function encodePng4(levels: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const rowBytes = Math.ceil(w / 2)
  const raw = new Uint8Array(h * (rowBytes + 1)) // each row starts with filter type 0, None
  for (let y = 0; y < h; y++) {
    const row = y * (rowBytes + 1) + 1
    for (let x = 0; x < w; x++) raw[row + (x >> 1)] |= levels[y * w + x] << (x & 1 ? 0 : 4)
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr.set([4, 3, 0, 0, 0], 8) // bit depth 4, colour type 3 (indexed), deflate, no filter, no interlace
  const plte = new Uint8Array(16 * 3)
  for (let i = 0; i < 16; i++) plte.fill(i * 17, i * 3, i * 3 + 3)
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', await zlib(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** zlib-wrapped deflate, as IDAT wants ('deflate' in CompressionStream is the zlib format). */
const zlib = async (bytes: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
