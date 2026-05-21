import net from 'node:net'

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(false)
      } else {
        resolve(false)
      }
    })
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

export async function findFreePort(start: number, span = 100): Promise<number> {
  for (let p = start; p <= start + span; p++) {
    if (await isPortFree(p)) return p
  }
  throw new Error(`no free port available in range ${start}-${start + span}`)
}
