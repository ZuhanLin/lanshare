import React from 'react'
import { Box, Text } from 'ink'
import type { RequestEntry } from '../server.ts'

interface Props {
  entries: RequestEntry[]
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
        const t = e.time.toTimeString().slice(0, 8)
        return (
          <Text key={i}>
            <Text dimColor>{t}</Text>{'  '}
            {pad(e.method, 4)}{' '}
            {pad(e.path, 30)}{' '}
            <Text color={statusColor(e.status)}>{e.status}</Text>{'  '}
            <Text dimColor>{e.ip}</Text>
          </Text>
        )
      })}
    </Box>
  )
}
