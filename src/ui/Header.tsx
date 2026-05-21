import React from 'react'
import { Box, Text } from 'ink'

interface Props {
  dir: string
  url: string
  status: 'starting' | 'listening' | 'error'
  uploadEnabled: boolean
}

export function Header({ dir, url, status, uploadEnabled }: Props) {
  const statusText =
    status === 'listening'
      ? { color: 'green' as const, label: `🟢 Listening on ${url}` }
      : status === 'error'
        ? { color: 'red' as const, label: '🔴 Error' }
        : { color: 'yellow' as const, label: '🟡 Starting...' }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text>
        📂 <Text bold>{dir}</Text>
      </Text>
      <Text color={statusText.color}>{statusText.label}</Text>
      <Text color={uploadEnabled ? 'cyan' : 'gray'}>
        {uploadEnabled ? '📤 Upload: enabled' : '🔒 Upload: disabled (read-only)'}
      </Text>
    </Box>
  )
}
