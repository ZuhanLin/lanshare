import http from 'node:http'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { URL } from 'node:url'
import { EventEmitter } from 'node:events'
import handler from 'serve-handler'
import {
  handleUpload,
  parseRelDir,
  parseConflictMode,
  checkExists,
  UploadError,
} from './upload.ts'
import { renderDirectoryListing } from './listing.ts'

export interface RequestEntry {
  time: Date
  method: string
  path: string
  status: number
  ip: string
  bytes: number
}

export interface RequestErrorPayload {
  err: Error
  entry: Partial<RequestEntry>
}

export interface ShareServerOptions {
  dir: string
  port: number
  host?: string
  upload?: boolean
  maxUploadSize?: number
}

export class ShareServer extends EventEmitter {
  private readonly opts: ShareServerOptions
  private readonly uploadEnabled: boolean
  private readonly maxUploadSize: number | undefined
  private server: http.Server | null = null

  constructor(opts: ShareServerOptions) {
    super()
    this.opts = opts
    this.uploadEnabled = opts.upload !== false
    this.maxUploadSize = opts.maxUploadSize
  }

  start(): Promise<{ port: number }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.failRequest(req, res, err)
        })
      })

      let started = false
      server.on('error', (err) => {
        if (!started) {
          reject(err)
        } else {
          this.emit('error', err)
        }
      })

      const host = this.opts.host ?? '0.0.0.0'
      server.listen(this.opts.port, host, () => {
        started = true
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

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const method = req.method ?? 'GET'
    const rawUrl = req.url ?? '/'
    const url = new URL(rawUrl, 'http://placeholder')
    const pathname = url.pathname

    // Track response bytes for logging
    let bytes = 0
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
      this.emitRequest(method, rawUrl, res.statusCode, req, bytes)
    })

    // Upload endpoints
    if (pathname === '/__upload') {
      if (!this.uploadEnabled) return this.send405(res)
      if (method !== 'POST') return this.send405(res)
      await this.routeUpload(req, res, url)
      return
    }
    if (pathname === '/__check') {
      if (!this.uploadEnabled) return this.send405(res)
      if (method !== 'GET') return this.send405(res)
      await this.routeCheck(res, url)
      return
    }

    // Reject non-read methods up front (after upload routes)
    if (method !== 'GET' && method !== 'HEAD') return this.send405(res)

    // Directory listing — render our own when target is a directory
    if (method === 'GET' && (await this.tryRenderListing(res, pathname))) return

    // Everything else → serve-handler (file content, HEAD, redirects)
    await handler(req, res, { public: this.opts.dir, directoryListing: false })
  }

  private async routeUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ) {
    try {
      const relDir = parseRelDir(url.searchParams.get('dir') ?? '')
      const onConflict = parseConflictMode(url.searchParams.get('onConflict') ?? undefined)
      const result = await handleUpload(req, {
        root: this.opts.dir,
        relDir,
        onConflict,
        maxFileSize: this.maxUploadSize,
      })
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(result))
    } catch (err) {
      this.sendError(res, err as Error)
    }
  }

  private async routeCheck(res: http.ServerResponse, url: URL) {
    try {
      const p = url.searchParams.get('path') ?? ''
      const exists = await checkExists(this.opts.dir, p)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ exists }))
    } catch (err) {
      this.sendError(res, err as Error)
    }
  }

  private async tryRenderListing(
    res: http.ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      return false
    }
    const trimmed = decoded.replace(/^\/+/, '').replace(/\/+$/, '')
    const abs = path.resolve(this.opts.dir, trimmed)
    const rel = path.relative(this.opts.dir, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false
    let stat: Awaited<ReturnType<typeof fsp.stat>>
    try {
      stat = await fsp.stat(abs)
    } catch {
      return false
    }
    if (!stat.isDirectory()) return false

    // Force trailing slash so relative links in listing work
    if (!pathname.endsWith('/')) {
      res.writeHead(301, { Location: pathname + '/' })
      res.end()
      return true
    }

    const html = await renderDirectoryListing({
      root: this.opts.dir,
      relDir: trimmed,
      uploadEnabled: this.uploadEnabled,
    })
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(html)
    return true
  }

  private send405(res: http.ServerResponse) {
    res.writeHead(405, { Allow: this.uploadEnabled ? 'GET, HEAD, POST' : 'GET, HEAD' })
    res.end('Method Not Allowed')
  }

  private sendError(res: http.ServerResponse, err: Error) {
    if (res.headersSent) return
    const status = err instanceof UploadError ? err.statusCode : 500
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(err.message)
  }

  private failRequest(req: http.IncomingMessage, res: http.ServerResponse, err: Error) {
    const payload: RequestErrorPayload = {
      err,
      entry: {
        time: new Date(),
        method: req.method ?? '?',
        path: req.url ?? '?',
        ip: req.socket.remoteAddress ?? '?',
      },
    }
    this.emit('requestError', payload)
    if (!res.headersSent) {
      res.writeHead(500)
      res.end('Internal Server Error')
    }
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
