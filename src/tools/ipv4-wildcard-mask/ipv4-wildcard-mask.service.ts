import { ipv4ToInt, isValidIpv4 } from '../ipv4-address-converter/ipv4-address-converter.service';

export type Ipv4WildcardInputMode = 'cidr' | 'netmask' | 'wildcard';

export interface Ipv4WildcardCalculation {
  inputIp: string
  networkAddress: string
  broadcastAddress: string
  firstAddress: string
  lastAddress: string
  cidr: string
  prefix: number
  subnetMask: string
  wildcardMask: string
  binarySubnetMask: string
  binaryWildcardMask: string
  addressCount: number
  usableHostCount: number
  aclSource: string
  standardAclLine: string
  extendedAclLine: string
}

export class Ipv4WildcardMaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ipv4WildcardMaskError';
  }
}

const maxIpv4Int = 0xFFFFFFFF;

function intToIpv4(value: number) {
  const unsignedValue = value >>> 0;

  return [
    (unsignedValue >>> 24) & 255,
    (unsignedValue >>> 16) & 255,
    (unsignedValue >>> 8) & 255,
    unsignedValue & 255,
  ].join('.');
}

function intToBinaryIpv4(value: number) {
  return (value >>> 0).toString(2).padStart(32, '0').match(/.{8}/g)?.join('.') ?? '';
}

function parseIpv4(value: string) {
  const ip = value.trim();
  if (!isValidIpv4({ ip })) {
    throw new Ipv4WildcardMaskError(`Invalid IPv4 address "${value}".`);
  }

  return {
    ip,
    value: ipv4ToInt({ ip }) >>> 0,
  };
}

function parsePrefix(value: string) {
  const prefixText = value.trim();
  if (!/^\d+$/.test(prefixText)) {
    throw new Ipv4WildcardMaskError(`Invalid CIDR prefix "${value}".`);
  }

  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Ipv4WildcardMaskError('CIDR prefix must be between 0 and 32.');
  }

  return prefix;
}

function prefixToSubnetMaskInt(prefix: number) {
  if (prefix === 0) {
    return 0;
  }

  return (maxIpv4Int - (2 ** (32 - prefix) - 1)) >>> 0;
}

function subnetMaskIntToPrefix(mask: number) {
  const binaryMask = (mask >>> 0).toString(2).padStart(32, '0');

  if (!/^1*0*$/.test(binaryMask)) {
    throw new Ipv4WildcardMaskError('Subnet mask must contain contiguous one bits.');
  }

  return binaryMask.indexOf('0') === -1 ? 32 : binaryMask.indexOf('0');
}

function wildcardMaskIntToPrefix(mask: number) {
  const binaryMask = (mask >>> 0).toString(2).padStart(32, '0');

  if (!/^0*1*$/.test(binaryMask)) {
    throw new Ipv4WildcardMaskError('Wildcard mask must be the inverse of a contiguous subnet mask.');
  }

  return binaryMask.indexOf('1') === -1 ? 32 : binaryMask.indexOf('1');
}

function splitIpAndMask(input: string, mode: Exclude<Ipv4WildcardInputMode, 'cidr'>) {
  const parts = input.trim().split(/[\/\s]+/).filter(Boolean);
  const ipText = parts[0];
  const maskText = parts[1];

  if (parts.length !== 2 || ipText === undefined || maskText === undefined) {
    const maskName = mode === 'netmask' ? 'subnet mask' : 'wildcard mask';
    throw new Ipv4WildcardMaskError(`Enter an IPv4 address and ${maskName}.`);
  }

  return [ipText, maskText] as const;
}

function parseInput(input: string, mode: Ipv4WildcardInputMode) {
  if (input.trim() === '') {
    throw new Ipv4WildcardMaskError('Input is required.');
  }

  if (mode === 'cidr') {
    const [ipText, prefixText, ...extraParts] = input.trim().split('/');
    if (!ipText || !prefixText || extraParts.length > 0) {
      throw new Ipv4WildcardMaskError('Enter CIDR notation like 192.168.1.10/24.');
    }

    return {
      ip: parseIpv4(ipText),
      prefix: parsePrefix(prefixText),
    };
  }

  const [ipText, maskText] = splitIpAndMask(input, mode);
  const parsedMask = parseIpv4(maskText);

  return {
    ip: parseIpv4(ipText),
    prefix: mode === 'netmask'
      ? subnetMaskIntToPrefix(parsedMask.value)
      : wildcardMaskIntToPrefix(parsedMask.value),
  };
}

function formatAclSource(networkAddress: string, wildcardMask: string, prefix: number) {
  if (prefix === 0) {
    return 'any';
  }

  if (prefix === 32) {
    return `host ${networkAddress}`;
  }

  return `${networkAddress} ${wildcardMask}`;
}

export function calculateIpv4Wildcard(input: string, mode: Ipv4WildcardInputMode): Ipv4WildcardCalculation {
  const { ip, prefix } = parseInput(input, mode);
  const subnetMaskInt = prefixToSubnetMaskInt(prefix);
  const wildcardMaskInt = (maxIpv4Int - subnetMaskInt) >>> 0;
  const networkInt = (ip.value & subnetMaskInt) >>> 0;
  const broadcastInt = (networkInt | wildcardMaskInt) >>> 0;
  const addressCount = 2 ** (32 - prefix);
  const networkAddress = intToIpv4(networkInt);
  const wildcardMask = intToIpv4(wildcardMaskInt);
  const aclSource = formatAclSource(networkAddress, wildcardMask, prefix);

  return {
    inputIp: ip.ip,
    networkAddress,
    broadcastAddress: intToIpv4(broadcastInt),
    firstAddress: intToIpv4(networkInt),
    lastAddress: intToIpv4(broadcastInt),
    cidr: `${networkAddress}/${prefix}`,
    prefix,
    subnetMask: intToIpv4(subnetMaskInt),
    wildcardMask,
    binarySubnetMask: intToBinaryIpv4(subnetMaskInt),
    binaryWildcardMask: intToBinaryIpv4(wildcardMaskInt),
    addressCount,
    usableHostCount: prefix >= 31 ? addressCount : addressCount - 2,
    aclSource,
    standardAclLine: `access-list 10 permit ${aclSource}`,
    extendedAclLine: `access-list 100 permit ip ${aclSource} any`,
  };
}
