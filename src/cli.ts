import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import React from 'react'
import { render } from 'ink'
import { getLanAddresses, type LanAddress } from './network.ts'
import { findFreePort } from './port.ts'
import { renderQR } from './qr.ts'
import { ShareServer } from './server.ts'
import { App } from './ui/App.tsx'

interface CliOptions {
  port: string
  host?: string
  qr: boolean
  upload: boolean
  maxUploadSize: string
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)}KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`
  return `${(n / 1024 ** 3).toFixed(2)}GB`
}

function parseSize(input: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)?$/i.exec(input.trim())
  if (!m) throw new Error(`invalid size: ${input}`)
  const n = Number(m[1])
  const unit = (m[2] ?? 'b').toLowerCase()
  const mul =
    unit === 'g' || unit === 'gb'
      ? 1024 ** 3
      : unit === 'm' || unit === 'mb'
        ? 1024 ** 2
        : unit === 'k' || unit === 'kb'
          ? 1024
          : 1
  return Math.floor(n * mul)
}

async function main() {
  const program = new Command()
  program
    .name('lanshare')
    .description('Share a folder over your LAN via HTTP with a scannable QR code')
    .argument('[dir]', 'directory to share', process.cwd())
    .option('-p, --port <number>', 'starting port (auto-increments if taken)', '8000')
    .option('-h, --host <ip>', 'bind to a specific LAN IP (default: auto-pick preferred)')
    .option('--no-qr', 'do not render QR code (for non-TTY use)')
    .option('--no-upload', 'disable file uploads (read-only mode)')
    .option(
      '--max-upload-size <size>',
      'cap upload size per file (e.g. 500m, 2g, 0 = unlimited)',
      '5g',
    )
    .version('0.1.0')
    .parse()

  const opts = program.opts<CliOptions>()
  const dirArg = program.args[0] ?? process.cwd()
  const dir = path.resolve(dirArg)

  // Validate directory
  try {
    const stat = fs.statSync(dir)
    if (!stat.isDirectory()) {
      fail(`directory '${dir}' is not a directory`)
    }
    fs.accessSync(dir, fs.constants.R_OK)
  } catch {
    fail(`directory '${dir}' does not exist or is not readable`)
  }

  // Resolve LAN addresses
  const addresses = getLanAddresses()
  if (addresses.length === 0) {
    fail('no LAN interface found; are you connected to a network?')
  }

  let primary: LanAddress
  let alternates: LanAddress[]
  if (opts.host) {
    const match = addresses.find((a) => a.address === opts.host)
    if (!match) {
      fail(
        `${opts.host} is not a local interface; available: ${addresses
          .map((a) => a.address)
          .join(', ')}`,
      )
    }
    primary = match
    alternates = addresses.filter((a) => a.address !== primary.address)
  } else {
    primary = addresses[0]
    alternates = addresses.slice(1)
  }

  // Find a free port
  const startPort = Number(opts.port)
  if (!Number.isInteger(startPort) || startPort < 1 || startPort > 65535) {
    fail(`invalid port: ${opts.port}`)
  }
  let port: number
  try {
    port = await findFreePort(startPort)
  } catch (err) {
    fail((err as Error).message)
  }

  // Start server
  const uploadEnabled = opts.upload !== false
  let maxUploadSize: number | undefined
  try {
    const parsed = parseSize(opts.maxUploadSize)
    maxUploadSize = parsed > 0 ? parsed : undefined
  } catch (err) {
    fail((err as Error).message)
  }
  const server = new ShareServer({
    dir,
    port,
    upload: uploadEnabled,
    maxUploadSize,
  })
  try {
    await server.start()
  } catch (err) {
    fail(`failed to start server: ${(err as Error).message}`)
  }

  const primaryUrl = `http://${primary.address}:${port}/`

  // Render QR (or skip)
  let qr = ''
  if (opts.qr && process.stdout.isTTY) {
    qr = await renderQR(primaryUrl)
  } else {
    // Plain mode: just print URLs and keep server running until SIGINT
    server.on('error', (err) => {
      process.stderr.write(`Server error: ${err.message}\n`)
    })
    console.log(`Sharing ${dir}`)
    console.log(`Primary URL: ${primaryUrl}`)
    for (const a of alternates) {
      console.log(`  Alternate: http://${a.address}:${port}/  (${a.iface})`)
    }
    console.log(
      `Upload: ${
        uploadEnabled
          ? `enabled (max ${maxUploadSize ? formatBytes(maxUploadSize) : 'unlimited'})`
          : 'disabled'
      }`,
    )
    console.log('Press Ctrl+C to stop')
    let stopping = false
    const shutdown = async () => {
      if (stopping) return
      stopping = true
      await server.stop()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    return
  }

  // Render TUI
  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    await server.stop()
  }
  const signalShutdown = async () => {
    await shutdown()
    process.exit(0)
  }
  process.on('SIGINT', signalShutdown)
  process.on('SIGTERM', signalShutdown)
  const { waitUntilExit } = render(
    React.createElement(App, {
      dir,
      port,
      primary,
      alternates,
      qr,
      server,
      uploadEnabled,
      onExit: shutdown,
    }),
  )
  await waitUntilExit()
}

function fail(msg: string): never {
  process.stderr.write(`Error: ${msg}\n`)
  process.exit(1)
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err?.stack ?? err}\n`)
  process.exit(1)
})
