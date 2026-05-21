import http from 'node:http'
import { EventEmitter } from 'node:events'
import handler from 'serve-handler'

export interface RequestEntry {
  time: Date
  method: string
  path: string
  status: number
  ip: string
  bytes: number
}

export interface ShareServerOptions {
  dir: string
  port: number
  host?: string
}

export class ShareServer extends EventEmitter {
  private readonly opts: ShareServerOptions
  private server: http.Server | null = null

  constructor(opts: ShareServerOptions) {
    super()
    this.opts = opts
  }

  start(): Promise<{ port: number }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const method = req.method ?? 'GET'
        const reqPath = req.url ?? '/'
        let bytes = 0

        if (method !== 'GET' && method !== 'HEAD') {
          res.writeHead(405, { Allow: 'GET, HEAD' })
          res.end('Method Not Allowed')
          this.emitRequest(method, reqPath, 405, req, 0)
          return
        }

        const origWrite = res.write.bind(res)
        const origEnd = res.end.bind(res)
        res.write = ((chunk: unknown, ..._rest: unknown[]) => {
          if (chunk) bytes += Buffer.byteLength(chunk as Buffer | string)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (origWrite as any)(chunk, ..._rest)
        }) as typeof res.write
        res.end = ((chunk?: unknown, ..._rest: unknown[]) => {
          if (chunk && typeof chunk !== 'function') {
            bytes += Buffer.byteLength(chunk as Buffer | string)
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (origEnd as any)(chunk, ..._rest)
        }) as typeof res.end

        res.on('finish', () => {
          this.emitRequest(method, reqPath, res.statusCode, req, bytes)
        })

        handler(req, res, { public: this.opts.dir }).catch((err: Error) => {
          this.emit('error', err)
          if (!res.headersSent) {
            res.writeHead(500)
            res.end('Internal Server Error')
          }
        })
      })

      server.on('error', (err) => {
        reject(err)
        this.emit('error', err)
      })

      const host = this.opts.host ?? '0.0.0.0'
      server.listen(this.opts.port, host, () => {
        this.server = server
        const addr = server.address()
        const port = typeof addr === 'object' && addr ? addr.port : this.opts.port
        this.emit('listening', { port, host })
        resolve({ port })
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      const server = this.server
      if (!server) return resolve()
      let done = false
      const finish = () => {
        if (done) return
        done = true
        this.server = null
        resolve()
      }
      server.close(() => finish())
      setTimeout(() => {
        server.closeAllConnections?.()
        finish()
      }, 1000).unref()
    })
  }

  private emitRequest(
    method: string,
    reqPath: string,
    status: number,
    req: http.IncomingMessage,
    bytes: number,
  ) {
    const entry: RequestEntry = {
      time: new Date(),
      method,
      path: reqPath,
      status,
      ip: req.socket.remoteAddress ?? '?',
      bytes,
    }
    this.emit('request', entry)
  }
}
