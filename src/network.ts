import os from 'node:os'
import type { NetworkInterfaceInfo } from 'node:os'

export interface LanAddress {
  iface: string
  address: string
}

export function filterLanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): LanAddress[] {
  const out: LanAddress[] = []
  for (const [iface, infos] of Object.entries(interfaces)) {
    if (!infos) continue
    for (const info of infos) {
      if (info.family !== 'IPv4') continue
      if (info.internal) continue
      if (info.address.startsWith('169.254.')) continue
      out.push({ iface, address: info.address })
    }
  }
  return out
}

function priority(address: string): number {
  if (address.startsWith('192.168.')) return 0
  if (address.startsWith('10.')) return 1
  const m = address.match(/^172\.(\d+)\./)
  if (m) {
    const second = Number(m[1])
    if (second >= 16 && second <= 31) return 2
  }
  return 3
}

export function sortLanAddresses(addrs: LanAddress[]): LanAddress[] {
  return [...addrs].sort((a, b) => priority(a.address) - priority(b.address))
}

export function getLanAddresses(): LanAddress[] {
  return sortLanAddresses(filterLanAddresses(os.networkInterfaces()))
}
