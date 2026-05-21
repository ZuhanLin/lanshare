import { describe, it, expect } from 'vitest'
import { renderQR } from '../src/qr.ts'

describe('renderQR', () => {
  it('returns a non-empty string for a URL', async () => {
    const out = await renderQR('http://192.168.1.10:8000/')
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(50)
  })

  it('contains block characters', async () => {
    const out = await renderQR('http://10.0.0.5:8080/')
    // qrcode-terminal small mode uses ▀ and spaces
    expect(out).toMatch(/[▀█]/)
  })
})
