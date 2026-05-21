import React, { useEffect, useRef, useState } from 'react'
import { Box, useApp, useInput } from 'ink'
import { Header } from './Header.tsx'
import { QRPanel } from './QRPanel.tsx'
import { Logs, type LogEntry } from './Logs.tsx'
import { Footer } from './Footer.tsx'
import type { ShareServer, RequestEntry, RequestErrorPayload } from '../server.ts'
import type { LanAddress } from '../network.ts'

const MAX_LOGS = 20

interface Props {
  dir: string
  port: number
  primary: LanAddress
  alternates: LanAddress[]
  qr: string
  server: ShareServer
  onExit: () => Promise<void>
}

export function App({ dir, port, primary, alternates, qr, server, onExit }: Props) {
  const ink = useApp()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<'starting' | 'listening' | 'error'>('listening')

  useEffect(() => {
    const appendEntry = (entry: LogEntry) => {
      setEntries((prev) => {
        const next = [...prev, entry]
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next
      })
    }
    const onRequest = (e: RequestEntry) => {
      appendEntry({ kind: 'request', data: e })
    }
    const onRequestError = ({ err, entry }: RequestErrorPayload) => {
      appendEntry({
        kind: 'error',
        time: entry.time ?? new Date(),
        method: entry.method,
        path: entry.path,
        ip: entry.ip,
        message: err.message,
      })
    }
    const onError = () => setStatus('error')
    server.on('request', onRequest)
    server.on('requestError', onRequestError)
    server.on('error', onError)
    return () => {
      server.off('request', onRequest)
      server.off('requestError', onRequestError)
      server.off('error', onError)
    }
  }, [server])

  const exiting = useRef(false)
  useInput(async (input, key) => {
    if (exiting.current) return
    if ((key.ctrl && input === 'c') || input === 'q') {
      exiting.current = true
      try {
        await onExit()
      } finally {
        ink.exit()
      }
    }
  })

  const primaryUrl = `http://${primary.address}:${port}/`
  const altMapped = alternates.map((a) => ({
    url: `http://${a.address}:${port}/`,
    address: a,
  }))

  return (
    <Box flexDirection="column">
      <Header dir={dir} url={primaryUrl} status={status} />
      <QRPanel
        qr={qr}
        primaryUrl={primaryUrl}
        primaryIface={primary.iface}
        alternates={altMapped}
      />
      <Logs entries={entries} />
      <Footer />
    </Box>
  )
}
