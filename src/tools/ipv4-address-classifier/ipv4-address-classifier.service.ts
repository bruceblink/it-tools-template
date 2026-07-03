import { ipv4ToInt, isValidIpv4 } from '../ipv4-address-converter/ipv4-address-converter.service';
import { getIPClass } from '../ipv4-subnet-calculator/ipv4-subnet-calculator.models';

export type Ipv4AddressScope = 'public' | 'private' | 'special';

export interface Ipv4ClassificationRule {
  cidr: string
  label: string
  scope: Ipv4AddressScope
  description: string
}

export interface Ipv4AddressClassification {
  ip: string
  integer: number
  binary: string
  hex: string
  ipClass: string | undefined
  rule: Ipv4ClassificationRule
}

export class Ipv4AddressClassifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ipv4AddressClassifierError';
  }
}

const publicRule: Ipv4ClassificationRule = {
  cidr: '0.0.0.0/0',
  label: 'Public unicast',
  scope: 'public',
  description: 'Routable IPv4 address space unless filtered by network policy.',
};

export const ipv4ClassificationRules: Ipv4ClassificationRule[] = [
  {
    cidr: '0.0.0.0/8',
    label: 'Current network',
    scope: 'special',
    description: 'Used for source addresses before a host has learned its own address.',
  },
  {
    cidr: '10.0.0.0/8',
    label: 'Private network',
    scope: 'private',
    description: 'RFC1918 private address space.',
  },
  {
    cidr: '100.64.0.0/10',
    label: 'Carrier-grade NAT',
    scope: 'special',
    description: 'Shared address space for carrier-grade NAT.',
  },
  {
    cidr: '127.0.0.0/8',
    label: 'Loopback',
    scope: 'special',
    description: 'Local host loopback address space.',
  },
  {
    cidr: '169.254.0.0/16',
    label: 'Link-local',
    scope: 'special',
    description: 'Automatically configured link-local address space.',
  },
  {
    cidr: '172.16.0.0/12',
    label: 'Private network',
    scope: 'private',
    description: 'RFC1918 private address space.',
  },
  {
    cidr: '192.0.0.0/24',
    label: 'IETF protocol assignments',
    scope: 'special',
    description: 'Special-purpose protocol assignment block.',
  },
  {
    cidr: '192.0.2.0/24',
    label: 'Documentation',
    scope: 'special',
    description: 'TEST-NET-1 documentation address space.',
  },
  {
    cidr: '192.168.0.0/16',
    label: 'Private network',
    scope: 'private',
    description: 'RFC1918 private address space.',
  },
  {
    cidr: '198.18.0.0/15',
    label: 'Benchmark testing',
    scope: 'special',
    description: 'Network interconnect benchmark testing address space.',
  },
  {
    cidr: '198.51.100.0/24',
    label: 'Documentation',
    scope: 'special',
    description: 'TEST-NET-2 documentation address space.',
  },
  {
    cidr: '203.0.113.0/24',
    label: 'Documentation',
    scope: 'special',
    description: 'TEST-NET-3 documentation address space.',
  },
  {
    cidr: '192.88.99.0/24',
    label: '6to4 relay anycast',
    scope: 'special',
    description: 'Deprecated 6to4 relay anycast address space.',
  },
  {
    cidr: '233.252.0.0/24',
    label: 'Documentation multicast',
    scope: 'special',
    description: 'MCAST-TEST-NET documentation multicast address space.',
  },
  {
    cidr: '224.0.0.0/4',
    label: 'Multicast',
    scope: 'special',
    description: 'IPv4 multicast address space.',
  },
  {
    cidr: '255.255.255.255/32',
    label: 'Limited broadcast',
    scope: 'special',
    description: 'Broadcast address for the local network segment.',
  },
  {
    cidr: '240.0.0.0/4',
    label: 'Reserved',
    scope: 'special',
    description: 'Reserved for future use.',
  },
];

function parseCidrRange(cidr: string) {
  const [baseIp, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  const size = 2 ** (32 - prefix);
  const start = Math.floor((ipv4ToInt({ ip: baseIp ?? '' }) >>> 0) / size) * size;

  return {
    start,
    end: start + size - 1,
  };
}

function getCidrPrefix(cidr: string) {
  return Number(cidr.split('/')[1]);
}

function matchesCidr(ipInt: number, cidr: string) {
  const { start, end } = parseCidrRange(cidr);
  return ipInt >= start && ipInt <= end;
}

export function classifyIpv4Address(ip: string): Ipv4AddressClassification {
  const cleanIp = ip.trim();
  if (!isValidIpv4({ ip: cleanIp })) {
    throw new Ipv4AddressClassifierError(`Invalid IPv4 address "${ip}".`);
  }

  const integer = ipv4ToInt({ ip: cleanIp }) >>> 0;
  const rule = ipv4ClassificationRules
    .filter(rule => matchesCidr(integer, rule.cidr))
    .sort((left, right) => getCidrPrefix(right.cidr) - getCidrPrefix(left.cidr))[0] ?? publicRule;

  return {
    ip: cleanIp,
    integer,
    binary: integer.toString(2).padStart(32, '0').match(/.{8}/g)?.join('.') ?? '',
    hex: `0x${integer.toString(16).padStart(8, '0').toUpperCase()}`,
    ipClass: getIPClass({ ip: cleanIp }),
    rule,
  };
}
