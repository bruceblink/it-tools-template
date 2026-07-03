import { ipv4ToInt, isValidIpv4 } from '../ipv4-address-converter/ipv4-address-converter.service';

export interface Ipv4CidrSubnet {
  cidr: string
  networkAddress: string
  broadcastAddress: string
  firstAddress: string
  lastAddress: string
  addressCount: number
}

export interface Ipv4CidrSplitResult {
  sourceCidr: string
  sourceNetworkAddress: string
  sourceBroadcastAddress: string
  sourcePrefix: number
  targetPrefix: number
  subnetCount: number
  addressesPerSubnet: number
  subnets: Ipv4CidrSubnet[]
}

export interface Ipv4CidrSplitOptions {
  maxSubnets?: number
}

export class Ipv4CidrSplitterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ipv4CidrSplitterError';
  }
}

const defaultMaxSubnets = 4096;

function intToIpv4(value: number) {
  const unsignedValue = value >>> 0;

  return [
    (unsignedValue >>> 24) & 255,
    (unsignedValue >>> 16) & 255,
    (unsignedValue >>> 8) & 255,
    unsignedValue & 255,
  ].join('.');
}

function parseIpv4(value: string) {
  const ip = value.trim();
  if (!isValidIpv4({ ip })) {
    throw new Ipv4CidrSplitterError(`Invalid IPv4 address "${value}".`);
  }

  return ipv4ToInt({ ip }) >>> 0;
}

function parsePrefix(value: string) {
  const prefixText = value.trim();
  if (!/^\d+$/.test(prefixText)) {
    throw new Ipv4CidrSplitterError(`Invalid CIDR prefix "${value}".`);
  }

  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Ipv4CidrSplitterError('CIDR prefix must be between 0 and 32.');
  }

  return prefix;
}

function parseCidr(value: string) {
  const [ipText, prefixText, ...extraParts] = value.trim().split('/');
  if (!ipText || !prefixText || extraParts.length > 0) {
    throw new Ipv4CidrSplitterError('Enter CIDR notation like 192.168.0.0/24.');
  }

  const prefix = parsePrefix(prefixText);
  const size = 2 ** (32 - prefix);
  const ip = parseIpv4(ipText);
  const network = Math.floor(ip / size) * size;

  return {
    network,
    broadcast: network + size - 1,
    prefix,
  };
}

function createSubnet(network: number, prefix: number): Ipv4CidrSubnet {
  const addressCount = 2 ** (32 - prefix);
  const broadcast = network + addressCount - 1;

  return {
    cidr: `${intToIpv4(network)}/${prefix}`,
    networkAddress: intToIpv4(network),
    broadcastAddress: intToIpv4(broadcast),
    firstAddress: intToIpv4(network),
    lastAddress: intToIpv4(broadcast),
    addressCount,
  };
}

export function splitIpv4Cidr(input: string, targetPrefix: number, options: Ipv4CidrSplitOptions = {}): Ipv4CidrSplitResult {
  const source = parseCidr(input);
  if (!Number.isInteger(targetPrefix) || targetPrefix < 0 || targetPrefix > 32) {
    throw new Ipv4CidrSplitterError('Target prefix must be between 0 and 32.');
  }

  if (targetPrefix < source.prefix) {
    throw new Ipv4CidrSplitterError('Target prefix must be greater than or equal to the source prefix.');
  }

  const subnetCount = 2 ** (targetPrefix - source.prefix);
  const maxSubnets = options.maxSubnets ?? defaultMaxSubnets;
  if (subnetCount > maxSubnets) {
    throw new Ipv4CidrSplitterError(`This split would create ${subnetCount.toLocaleString()} subnets. Limit the output to ${maxSubnets.toLocaleString()} subnets or choose a shorter target prefix.`);
  }

  const addressesPerSubnet = 2 ** (32 - targetPrefix);
  const subnets: Ipv4CidrSubnet[] = [];
  for (let index = 0; index < subnetCount; index += 1) {
    subnets.push(createSubnet(source.network + index * addressesPerSubnet, targetPrefix));
  }

  return {
    sourceCidr: `${intToIpv4(source.network)}/${source.prefix}`,
    sourceNetworkAddress: intToIpv4(source.network),
    sourceBroadcastAddress: intToIpv4(source.broadcast),
    sourcePrefix: source.prefix,
    targetPrefix,
    subnetCount,
    addressesPerSubnet,
    subnets,
  };
}

export function formatIpv4CidrSplit(input: string, targetPrefix: number, options: Ipv4CidrSplitOptions = {}) {
  return splitIpv4Cidr(input, targetPrefix, options).subnets.map(subnet => subnet.cidr).join('\n');
}
