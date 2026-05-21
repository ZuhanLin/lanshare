import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ShareServer } from '../src/server.ts'

let tmpDir: string
let server: ShareServer

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanshare-listing-'))
  await fs.writeFile(path.join(tmpDir, 'a.txt'), 'aa')
  await fs.mkdir(path.join(tmpDir, 'sub'))
})

afterEach(async () => {
  await server.stop()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('directory listing', () => {
  it('injects upload UI when upload enabled', async () => {
    server = new ShareServer({ dir: tmpDir, port: 0, upload: true })
    const { port } = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const html = await res.text()
    expect(html).toContain('a.txt')
    expect(html).toContain('sub/')
    expect(html).toContain('ls-drop')
    expect(html).toContain('/__upload')
  })

  it('omits upload UI when upload disabled', async () => {
    server = new ShareServer({ dir: tmpDir, port: 0, upload: false })
    const { port } = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/`)
    const html = await res.text()
    expect(html).toContain('a.txt')
    expect(html).not.toContain('ls-drop')
    expect(html).not.toContain('/__upload')
  })

  it('renders subdirectory with upload UI scoped to that dir', async () => {
    await fs.writeFile(path.join(tmpDir, 'sub', 'inner.txt'), 'i')
    server = new ShareServer({ dir: tmpDir, port: 0, upload: true })
    const { port } = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/sub/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('inner.txt')
    expect(html).toContain('"sub"')
  })

  it('redirects directory URL without trailing slash', async () => {
    server = new ShareServer({ dir: tmpDir, port: 0, upload: true })
    const { port } = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/sub`, { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/sub/')
  })

  it('hides .lanshare-upload-*.tmp from listing', async () => {
    await fs.writeFile(path.join(tmpDir, '.lanshare-upload-abc.tmp'), 'temp')
    server = new ShareServer({ dir: tmpDir, port: 0, upload: true })
    const { port } = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/`)
    const html = await res.text()
    expect(html).not.toContain('.lanshare-upload-abc.tmp')
  })
})
