import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type http from 'node:http'
import Busboy from 'busboy'

export type ConflictMode = 'reject' | 'overwrite' | 'rename'

export interface UploadOptions {
  root: string
  relDir: string
  onConflict: ConflictMode
  maxFileSize?: number
}

export interface UploadResult {
  finalName: string
  finalRelPath: string
  bytes: number
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
  }
}

export function parseRelDir(raw: string | undefined): string {
  if (!raw) return ''
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    throw new UploadError('invalid dir', 400)
  }
  const parts = decoded.split(/[/\\]/).filter((p) => p.length > 0)
  for (const p of parts) {
    if (p === '..' || p === '.' || p.includes('\0')) {
      throw new UploadError('invalid dir', 400)
    }
  }
  return parts.join('/')
}

export function parseConflictMode(raw: string | undefined): ConflictMode {
  if (!raw) return 'reject'
  if (raw === 'reject' || raw === 'overwrite' || raw === 'rename') return raw
  throw new UploadError('invalid onConflict', 400)
}

export function safeFilename(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new UploadError('invalid filename', 400)
  }
  if (/[\\/\0]/.test(trimmed)) {
    throw new UploadError('invalid filename', 400)
  }
  return trimmed
}

export function resolveTargetDir(root: string, relDir: string): string {
  const absRoot = path.resolve(root)
  const target = path.resolve(absRoot, relDir)
  const rel = path.relative(absRoot, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new UploadError('path escapes root', 403)
  }
  return target
}

function splitName(name: string): { base: string; ext: string } {
  const ext = path.extname(name)
  const base = ext ? name.slice(0, -ext.length) : name
  return { base, ext }
}

async function findAvailableName(dir: string, original: string): Promise<string> {
  try {
    await fsp.access(path.join(dir, original))
  } catch {
    return original
  }
  const { base, ext } = splitName(original)
  for (let i = 1; i <= 9999; i++) {
    const candidate = `${base} (${i})${ext}`
    try {
      await fsp.access(path.join(dir, candidate))
    } catch {
      return candidate
    }
  }
  throw new UploadError('too many duplicates', 409)
}

export async function handleUpload(
  req: http.IncomingMessage,
  opts: UploadOptions,
): Promise<UploadResult> {
  const contentType = req.headers['content-type']
  if (!contentType || !/^multipart\/form-data/i.test(contentType)) {
    throw new UploadError('expected multipart/form-data', 400)
  }

  const targetDir = resolveTargetDir(opts.root, opts.relDir)
  await fsp.mkdir(targetDir, { recursive: true })

  const tmpName = `.lanshare-upload-${crypto.randomBytes(6).toString('hex')}.tmp`
  const tmpPath = path.join(targetDir, tmpName)

  let bytes = 0
  let originalName: string | null = null
  let fileSeen = false
  let writeFinished: Promise<void> = Promise.resolve()

  return new Promise<UploadResult>((resolve, reject) => {
    let settled = false
    const bb = Busboy({
      headers: req.headers,
      limits: opts.maxFileSize
        ? { fileSize: opts.maxFileSize, files: 1 }
        : { files: 1 },
    })
    let writeStream: fs.WriteStream | null = null
    let tmpWritten = false

    const fail = async (err: Error) => {
      if (settled) return
      settled = true
      try {
        writeStream?.destroy()
      } catch {}
      try {
        bb.removeAllListeners()
      } catch {}
      if (tmpWritten) {
        try {
          await fsp.unlink(tmpPath)
        } catch {}
      }
      reject(err)
    }

    bb.on('file', (_field, stream, info) => {
      if (fileSeen) {
        stream.resume()
        return
      }
      fileSeen = true
      let safeName: string
      try {
        safeName = safeFilename(info.filename)
      } catch (err) {
        stream.resume()
        fail(err as Error)
        return
      }
      originalName = safeName
      tmpWritten = true
      const ws = fs.createWriteStream(tmpPath, { flags: 'wx' })
      writeStream = ws
      writeFinished = new Promise<void>((res, rej) => {
        ws.on('finish', () => res())
        ws.on('error', (err) => rej(err))
      })
      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length
      })
      stream.on('limit', () => {
        fail(new UploadError('file too large', 413))
      })
      stream.on('error', (err) => fail(err))
      stream.pipe(ws)
    })

    bb.on('error', (err) => fail(err as Error))
    req.on('aborted', () => fail(new UploadError('request aborted', 499)))

    bb.on('close', async () => {
      if (settled) return
      if (!fileSeen || !originalName) {
        await fail(new UploadError('no file field in form', 400))
        return
      }

      try {
        await writeFinished

        let finalName = originalName
        const desiredPath = path.join(targetDir, finalName)
        let exists = false
        try {
          await fsp.access(desiredPath)
          exists = true
        } catch {}

        if (exists) {
          if (opts.onConflict === 'reject') {
            throw new UploadError('file exists', 409)
          }
          if (opts.onConflict === 'rename') {
            finalName = await findAvailableName(targetDir, originalName)
          }
        }

        const finalPath = path.join(targetDir, finalName)
        await fsp.rename(tmpPath, finalPath)

        settled = true
        const finalRelPath = opts.relDir ? `${opts.relDir}/${finalName}` : finalName
        resolve({ finalName, finalRelPath, bytes })
      } catch (err) {
        await fail(err as Error)
      }
    })

    req.pipe(bb)
  })
}

export async function checkExists(root: string, relPath: string): Promise<boolean> {
  const decoded = (() => {
    try {
      return decodeURIComponent(relPath)
    } catch {
      throw new UploadError('invalid path', 400)
    }
  })()
  const parts = decoded.split(/[/\\]/).filter((p) => p.length > 0)
  if (parts.length === 0) return false
  for (const p of parts) {
    if (p === '..' || p === '.' || p.includes('\0')) {
      throw new UploadError('invalid path', 400)
    }
  }
  const filename = parts.pop() as string
  safeFilename(filename)
  const targetDir = resolveTargetDir(root, parts.join('/'))
  try {
    await fsp.access(path.join(targetDir, filename))
    return true
  } catch {
    return false
  }
}
