import net from 'node:net'

export function isPortFree(port: number, host = '0.0.0.0'): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false)
      } else {
        reject(err)
      }
    })
    server.listen(port, host, () => {
      server.close(() => resolve(true))
    })
  })
}

export async function findFreePort(
  start: number,
  span = 100,
  host = '0.0.0.0',
): Promise<number> {
  for (let p = start; p <= start + span; p++) {
    if (await isPortFree(p, host)) return p
  }
  throw new Error(`no free port available in range ${start}-${start + span}`)
}
