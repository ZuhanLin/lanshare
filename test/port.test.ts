import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import { findFreePort } from '../src/port.ts'

const servers: net.Server[] = []

function occupy(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(port, '127.0.0.1', () => {
      servers.push(s)
      resolve((s.address() as net.AddressInfo).port)
    })
  })
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
})

describe('findFreePort', () => {
  it('returns the starting port when free', async () => {
    // Pick a random high port likely free
    const start = 49152 + Math.floor(Math.random() * 1000)
    const port = await findFreePort(start)
    expect(port).toBe(start)
  })

  it('increments when starting port is occupied', async () => {
    const taken = await occupy(0) // OS-assigned free port
    const port = await findFreePort(taken)
    expect(port).toBe(taken + 1)
  })

  it('throws when range is exhausted', async () => {
    // Occupy a contiguous range and start at its base
    const base = await occupy(0)
    const occupied = [base]
    for (let i = 1; i <= 3; i++) {
      try {
        occupied.push(await occupy(base + i))
      } catch {
        // Hit a non-contiguous port; skip this test
        return
      }
    }
    await expect(findFreePort(base, 2)).rejects.toThrow(/no free port/i)
  })
})
