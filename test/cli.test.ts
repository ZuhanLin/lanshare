import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cliPath = path.resolve(__dirname, '../src/cli.ts')

function runCli(args: string[], timeoutMs = 3000): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', cliPath, ...args], {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let stdout = ''
    proc.stderr.on('data', (d) => (stderr += d.toString()))
    proc.stdout.on('data', (d) => (stdout += d.toString()))
    const timer = setTimeout(() => proc.kill('SIGTERM'), timeoutMs)
    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stderr, stdout })
    })
  })
}

describe('cli', () => {
  it('exits 1 with clear error when directory does not exist', async () => {
    const { code, stderr } = await runCli(['/nonexistent/path/xyz'])
    expect(code).toBe(1)
    expect(stderr).toMatch(/does not exist|not readable/i)
  }, 15000)

  it('exits 1 when --host is not a local interface', async () => {
    const { code, stderr } = await runCli(['.', '--host', '203.0.113.1'])
    expect(code).toBe(1)
    expect(stderr).toMatch(/not a local interface/i)
  }, 15000)
})
