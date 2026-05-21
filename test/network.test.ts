import { describe, it, expect } from 'vitest'
import type { NetworkInterfaceInfo } from 'node:os'
import { sortLanAddresses, filterLanAddresses } from '../src/network.ts'

const ifaceInfo = (overrides: Partial<NetworkInterfaceInfo>): NetworkInterfaceInfo =>
  ({
    address: '0.0.0.0',
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: null,
    ...overrides,
  }) as NetworkInterfaceInfo

describe('filterLanAddresses', () => {
  it('keeps non-internal IPv4 only', () => {
    const out = filterLanAddresses({
      lo0: [ifaceInfo({ address: '127.0.0.1', internal: true })],
      en0: [
        ifaceInfo({ address: '192.168.1.10' }),
        { ...ifaceInfo({ address: 'fe80::1' }), family: 'IPv6' } as NetworkInterfaceInfo,
      ],
    })
    expect(out).toEqual([{ iface: 'en0', address: '192.168.1.10' }])
  })

  it('drops link-local 169.254.*', () => {
    const out = filterLanAddresses({
      en1: [ifaceInfo({ address: '169.254.10.1' })],
    })
    expect(out).toEqual([])
  })

  it('ignores undefined iface entries', () => {
    const out = filterLanAddresses({ en0: undefined })
    expect(out).toEqual([])
  })
})

describe('sortLanAddresses', () => {
  it('prefers 192.168.* over 10.* over 172.16-31.* over other', () => {
    const sorted = sortLanAddresses([
      { iface: 'a', address: '100.64.0.1' },
      { iface: 'b', address: '172.20.0.5' },
      { iface: 'c', address: '10.0.0.5' },
      { iface: 'd', address: '192.168.1.10' },
    ])
    expect(sorted.map((s) => s.address)).toEqual([
      '192.168.1.10',
      '10.0.0.5',
      '172.20.0.5',
      '100.64.0.1',
    ])
  })

  it('172.32.* is not considered private 172.16-31', () => {
    const sorted = sortLanAddresses([
      { iface: 'a', address: '172.32.0.1' },
      { iface: 'b', address: '172.16.0.1' },
    ])
    expect(sorted[0].address).toBe('172.16.0.1')
  })
})
