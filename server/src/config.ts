/** The API token guards trading. Long on loopback too: CORS is open, so any web page can try tokens against localhost. */
export function tokenProblem(token: string, publicDemo = false): string | null {
  if (!token) return publicDemo ? null : 'Set APP_TOKEN in .env (see .env.example).'
  if (token.length < 16) return 'APP_TOKEN must be at least 16 characters: openssl rand -hex 16'
  return null
}
