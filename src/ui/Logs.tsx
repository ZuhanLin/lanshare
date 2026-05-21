import React from 'react'
import { Box, Text } from 'ink'
import type { RequestEntry } from '../server.ts'

export type LogEntry =
  | { kind: 'request'; data: RequestEntry }
  | {
      kind: 'error'
      time: Date
      method?: string
      path?: string
      ip?: string
      message: string
    }

interface Props {
  entries: LogEntry[]
}

function statusColor(status: number): string {
  if (status >= 500) return 'red'
  if (status >= 400) return 'yellow'
  if (status >= 300) return 'cyan'
  return 'green'
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

export function Logs({ entries }: Props) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Recent requests</Text>
      {entries.length === 0 && <Text dimColor>(waiting for requests...)</Text>}
      {entries.map((e, i) => {
        if (e.kind === 'request') {
          const r = e.data
          const t = r.time.toTimeString().slice(0, 8)
          return (
            <Text key={i}>
              <Text dimColor>{t}</Text>{'  '}
              {pad(r.method, 4)}{' '}
              {pad(r.path, 30)}{' '}
              <Text color={statusColor(r.status)}>{r.status}</Text>{'  '}
              <Text dimColor>{r.ip}</Text>
            </Text>
          )
        }
        const t = e.time.toTimeString().slice(0, 8)
        return (
          <Text key={i} color="red">
            <Text dimColor>{t}</Text>{'  '}
            {pad(e.method ?? '?', 4)}{' '}
            {pad(e.path ?? '?', 30)}{' '}
            ERR{'  '}
            <Text dimColor>{e.ip ?? '?'}</Text>{'  '}
            {e.message}
          </Text>
        )
      })}
    </Box>
  )
}
