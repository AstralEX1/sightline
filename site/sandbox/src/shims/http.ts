/** node:http in the page: createServer only keeps the server's handler, and backend.ts calls it per request. */
export type Handler = (req: unknown, res: unknown) => unknown
export const createServer = (handler: Handler) => ({ handler })
