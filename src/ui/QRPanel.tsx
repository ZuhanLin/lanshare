import React from 'react'
import { Box, Text } from 'ink'
import type { LanAddress } from '../network.ts'

interface Props {
  qr: string
  primaryUrl: string
  primaryIface: string
  alternates: Array<{ url: string; address: LanAddress }>
}

export function QRPanel({ qr, primaryUrl, primaryIface, alternates }: Props) {
  return (
    <Box flexDirection="column" paddingY={1} paddingX={2}>
      <Text>{qr}</Text>
      <Box marginTop={1}>
        <Text>
          Scan to open: <Text bold color="cyan">{primaryUrl}</Text> <Text dimColor>({primaryIface})</Text>
        </Text>
      </Box>
      {alternates.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Alternate addresses:</Text>
          {alternates.map((a) => (
            <Text key={a.url} dimColor>
              {'  '}
              {a.url} ({a.address.iface})
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
