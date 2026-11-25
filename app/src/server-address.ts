export function serverAddress(address: string): string {
  if (!address) return '' // use the same-origin Vite proxy in development
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw new Error('Enter an HTTPS server address.')
  }
  const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !loopback) || url.username || url.password || address.includes('?') || address.includes('#')) {
    throw new Error('Enter an HTTPS server address without credentials, a query, or a fragment.')
  }
  return url.href.replace(/\/+$/, '')
}
