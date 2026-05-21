import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ShareServer, type RequestEntry } from '../src/server.ts'

let tmpDir: string
let server: ShareServer

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanshare-test-'))
  await fs.writeFile(path.join(tmpDir, 'hello.txt'), 'hi there')
  await fs.mkdir(path.join(tmpDir, 'sub'))
  await fs.writeFile(path.join(tmpDir, 'sub', 'nested.txt'), 'nested')
  server = new ShareServer({ dir: tmpDir, port: 0 })
})

afterEach(async () => {
  await server.stop()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('ShareServer', () => {
  it('serves a file', async () => {
    const { port } = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/hello.txt`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hi there')
  })

  it('serves directory listing as HTML', async () => {
    const { port } = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('hello.txt')
    expect(body).toContain('sub')
  })

  it('returns 404 for missing files', async () => {
    const { port } = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/nope.txt`)
    expect(res.status).toBe(404)
  })

  it('rejects POST with 405', async () => {
    const { port } = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/hello.txt`, { method: 'POST' })
    expect(res.status).toBe(405)
  })

  it('supports Range requests', async () => {
    const { port } = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/hello.txt`, {
      headers: { Range: 'bytes=0-1' },
    })
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('hi')
  })

  it('emits a request event with method/path/status', async () => {
    const { port } = await server.start()
    const seen: RequestEntry[] = []
    server.on('request', (e) => seen.push(e))
    await fetch(`http://127.0.0.1:${port}/hello.txt`)
    // Allow event loop to flush
    await new Promise((r) => setTimeout(r, 50))
    expect(seen.length).toBe(1)
    expect(seen[0].method).toBe('GET')
    expect(seen[0].path).toBe('/hello.txt')
    expect(seen[0].status).toBe(200)
  })
})
