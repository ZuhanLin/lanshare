import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ShareServer } from '../src/server.ts'
import { safeFilename, parseRelDir, UploadError } from '../src/upload.ts'

let tmpDir: string
let server: ShareServer

async function makeServer(upload = true) {
  server = new ShareServer({ dir: tmpDir, port: 0, upload })
  const { port } = await server.start()
  return port
}

function makeFormData(name: string, content: string): FormData {
  const fd = new FormData()
  fd.append('file', new Blob([content], { type: 'text/plain' }), name)
  return fd
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanshare-upload-'))
  await fs.mkdir(path.join(tmpDir, 'sub'))
})

afterEach(async () => {
  await server.stop()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('upload', () => {
  it('uploads a file to the root directory', async () => {
    const port = await makeServer()
    const res = await fetch(`http://127.0.0.1:${port}/__upload`, {
      method: 'POST',
      body: makeFormData('hello.txt', 'hi from phone'),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ finalName: 'hello.txt', finalRelPath: 'hello.txt', bytes: 13 })
    const body = await fs.readFile(path.join(tmpDir, 'hello.txt'), 'utf8')
    expect(body).toBe('hi from phone')
  })

  it('uploads to a subdirectory', async () => {
    const port = await makeServer()
    const res = await fetch(`http://127.0.0.1:${port}/__upload?dir=sub`, {
      method: 'POST',
      body: makeFormData('nested.txt', 'in sub'),
    })
    expect(res.status).toBe(200)
    const body = await fs.readFile(path.join(tmpDir, 'sub', 'nested.txt'), 'utf8')
    expect(body).toBe('in sub')
  })

  it('rejects same-name upload by default (reject mode)', async () => {
    await fs.writeFile(path.join(tmpDir, 'dup.txt'), 'original')
    const port = await makeServer()
    const res = await fetch(`http://127.0.0.1:${port}/__upload`, {
      method: 'POST',
      body: makeFormData('dup.txt', 'incoming'),
    })
    expect(res.status).toBe(409)
    const body = await fs.readFile(path.join(tmpDir, 'dup.txt'), 'utf8')
    expect(body).toBe('original')
  })

  it('overwrites with onConflict=overwrite', async () => {
    await fs.writeFile(path.join(tmpDir, 'dup.txt'), 'original')
    const port = await makeServer()
    const res = await fetch(
      `http://127.0.0.1:${port}/__upload?onConflict=overwrite`,
      { method: 'POST', body: makeFormData('dup.txt', 'new content') },
    )
    expect(res.status).toBe(200)
    const body = await fs.readFile(path.join(tmpDir, 'dup.txt'), 'utf8')
    expect(body).toBe('new content')
  })

  it('renames with onConflict=rename', async () => {
    await fs.writeFile(path.join(tmpDir, 'photo.jpg'), 'original')
    const port = await makeServer()
    const res = await fetch(
      `http://127.0.0.1:${port}/__upload?onConflict=rename`,
      { method: 'POST', body: makeFormData('photo.jpg', 'second') },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.finalName).toBe('photo (1).jpg')
    const second = await fs.readFile(path.join(tmpDir, 'photo (1).jpg'), 'utf8')
    expect(second).toBe('second')
    const original = await fs.readFile(path.join(tmpDir, 'photo.jpg'), 'utf8')
    expect(original).toBe('original')
  })

  it('renames repeatedly to (2) (3)…', async () => {
    await fs.writeFile(path.join(tmpDir, 'doc.txt'), 'a')
    await fs.writeFile(path.join(tmpDir, 'doc (1).txt'), 'b')
    const port = await makeServer()
    const res = await fetch(
      `http://127.0.0.1:${port}/__upload?onConflict=rename`,
      { method: 'POST', body: makeFormData('doc.txt', 'c') },
    )
    const json = await res.json()
    expect(json.finalName).toBe('doc (2).txt')
  })

  it('blocks path traversal in dir', async () => {
    const port = await makeServer()
    const res = await fetch(`http://127.0.0.1:${port}/__upload?dir=..`, {
      method: 'POST',
      body: makeFormData('escape.txt', 'pwn'),
    })
    expect(res.status).toBe(400)
  })

  it('safeFilename rejects slashes, null bytes, and dotfiles', () => {
    expect(() => safeFilename('a/b.txt')).toThrow(UploadError)
    expect(() => safeFilename('a\\b.txt')).toThrow(UploadError)
    expect(() => safeFilename('bad\0name')).toThrow(UploadError)
    expect(() => safeFilename('.')).toThrow(UploadError)
    expect(() => safeFilename('..')).toThrow(UploadError)
    expect(() => safeFilename('  ')).toThrow(UploadError)
    expect(safeFilename('photo.jpg')).toBe('photo.jpg')
    expect(safeFilename('  spaced.txt  ')).toBe('spaced.txt')
  })

  it('parseRelDir rejects traversal and empty/dot segments', () => {
    expect(() => parseRelDir('../etc')).toThrow(UploadError)
    expect(() => parseRelDir('a/../b')).toThrow(UploadError)
    expect(() => parseRelDir('a/./b')).toThrow(UploadError)
    expect(parseRelDir('a/b/c')).toBe('a/b/c')
    expect(parseRelDir('//a//b//')).toBe('a/b')
    expect(parseRelDir('')).toBe('')
  })

  it('rejects upload when --no-upload', async () => {
    const port = await makeServer(false)
    const res = await fetch(`http://127.0.0.1:${port}/__upload`, {
      method: 'POST',
      body: makeFormData('x.txt', 'nope'),
    })
    expect(res.status).toBe(405)
  })

  it('__check returns exists status', async () => {
    await fs.writeFile(path.join(tmpDir, 'exists.txt'), 'x')
    const port = await makeServer()
    const r1 = await fetch(`http://127.0.0.1:${port}/__check?path=exists.txt`)
    expect((await r1.json()).exists).toBe(true)
    const r2 = await fetch(`http://127.0.0.1:${port}/__check?path=missing.txt`)
    expect((await r2.json()).exists).toBe(false)
  })

  it('__check disabled when --no-upload', async () => {
    const port = await makeServer(false)
    const res = await fetch(`http://127.0.0.1:${port}/__check?path=anything`)
    expect(res.status).toBe(405)
  })
})
