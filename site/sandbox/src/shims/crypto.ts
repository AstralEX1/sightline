import { Buffer } from './buffer.ts'

export const randomBytes = (n: number) => Buffer.wrap(crypto.getRandomValues(new Uint8Array(n)))
export const timingSafeEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
/** bybit.ts imports it; the sandbox trades on FakeExchange and never signs a request. */
export function createHmac(): never { throw new Error('The sandbox never signs Bybit requests') }
