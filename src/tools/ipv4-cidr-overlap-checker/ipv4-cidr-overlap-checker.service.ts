import { ipv4ToInt, isValidIpv4 } from '../ipv4-address-converter/ipv4-address-converter.service';

export interface Ipv4CidrBlock {
  line: number
  input: string
  cidr: string
  networkAddress: string
  broadcastAddress: string
  prefix: number
  addressCount: number
  start: number
  end: number
}

export interface Ipv4CidrOverlap {
  first: Ipv4CidrBlock
  second: Ipv4CidrBlock
  overlapCidr: string
  overlapStart: string
  overlapEnd: string
  overlapAddressCount: number
  relationship: 'contains' | 'contained-by' | 'partial' | 'duplicate'
}

export interface Ipv4CidrOverlapAnalysis {
  blocks: Ipv4CidrBlock[]
  overlaps: Ipv4CidrOverlap[]
  hasOverlaps: boolean
  summary: {
    totalBlocks: number
    overlapCount: number
    coveredAddressCount: number
  }
}

export class Ipv4CidrOverlapCheckerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ipv4CidrOverlapCheckerError';
  }
}

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
    throw new Ipv4CidrOverlapCheckerError(`Invalid IPv4 address "${value}".`);
  }

  return ipv4ToInt({ ip }) >>> 0;
}

function parsePrefix(value: string) {
  const prefixText = value.trim();
  if (!/^\d+$/.test(prefixText)) {
    throw new Ipv4CidrOverlapCheckerError(`Invalid CIDR prefix "${value}".`);
  }

  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Ipv4CidrOverlapCheckerError('CIDR prefix must be between 0 and 32.');
  }

  return prefix;
}

function rangeToCidrs(start: number, end: number): string[] {
  const cidrs: string[] = [];
  let current = start;

  while (current <= end) {
    const remaining = end - current + 1;
    const alignmentBlock = getLargestAlignedBlock(current);
    const maxBlock = 2 ** Math.floor(Math.log2(remaining));
    const blockSize = Math.min(alignmentBlock, maxBlock);
    const prefix = 32 - Math.log2(blockSize);

    cidrs.push(`${intToIpv4(current)}/${prefix}`);
    current += blockSize;
  }

  return cidrs;
}

function getLargestAlignedBlock(start: number) {
  if (start === 0) {
    return 2 ** 32;
  }

  let blockSize = 1;
  while (blockSize < 2 ** 31 && start % (blockSize * 2) === 0) {
    blockSize *= 2;
  }

  return blockSize;
}

function parseCidr(line: string, lineNumber: number): Ipv4CidrBlock {
  const [ipText, prefixText, ...extraParts] = line.split('/');
  if (!ipText || !prefixText || extraParts.length > 0) {
    throw new Ipv4CidrOverlapCheckerError('Enter CIDR notation like 192.168.0.0/24.');
  }

  const prefix = parsePrefix(prefixText);
  const addressCount = 2 ** (32 - prefix);
  const ip = parseIpv4(ipText);
  const start = Math.floor(ip / addressCount) * addressCount;
  const end = start + addressCount - 1;

  return {
    line: lineNumber,
    input: line,
    cidr: `${intToIpv4(start)}/${prefix}`,
    networkAddress: intToIpv4(start),
    broadcastAddress: intToIpv4(end),
    prefix,
    addressCount,
    start,
    end,
  };
}

function getOverlapRelationship(first: Ipv4CidrBlock, second: Ipv4CidrBlock): Ipv4CidrOverlap['relationship'] {
  if (first.start === second.start && first.end === second.end) {
    return 'duplicate';
  }

  if (first.start <= second.start && first.end >= second.end) {
    return 'contains';
  }

  if (second.start <= first.start && second.end >= first.end) {
    return 'contained-by';
  }

  return 'partial';
}

function getCoveredAddressCount(blocks: Ipv4CidrBlock[]) {
  const ranges = blocks
    .map(({ start, end }) => ({ start, end }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let total = 0;
  let currentStart: number | undefined;
  let currentEnd: number | undefined;

  for (const range of ranges) {
    if (currentStart === undefined || currentEnd === undefined) {
      currentStart = range.start;
      currentEnd = range.end;
      continue;
    }

    if (range.start <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, range.end);
      continue;
    }

    total += currentEnd - currentStart + 1;
    currentStart = range.start;
    currentEnd = range.end;
  }

  if (currentStart !== undefined && currentEnd !== undefined) {
    total += currentEnd - currentStart + 1;
  }

  return total;
}

export function parseIpv4Cidrs(input: string): Ipv4CidrBlock[] {
  return input
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line !== '')
    .map(({ line, lineNumber }) => {
      try {
        return parseCidr(line, lineNumber);
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Ipv4CidrOverlapCheckerError(`Line ${lineNumber}: ${message}`);
      }
    });
}

export function analyzeIpv4CidrOverlaps(input: string): Ipv4CidrOverlapAnalysis {
  const blocks = parseIpv4Cidrs(input).sort((left, right) => left.start - right.start || left.end - right.end || left.line - right.line);
  const overlaps: Ipv4CidrOverlap[] = [];

  for (let leftIndex = 0; leftIndex < blocks.length; leftIndex += 1) {
    const first = blocks[leftIndex];
    if (!first) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < blocks.length; rightIndex += 1) {
      const second = blocks[rightIndex];
      if (!second) {
        continue;
      }

      if (second.start > first.end) {
        break;
      }

      const overlapStart = Math.max(first.start, second.start);
      const overlapEnd = Math.min(first.end, second.end);
      if (overlapStart <= overlapEnd) {
        overlaps.push({
          first,
          second,
          overlapCidr: rangeToCidrs(overlapStart, overlapEnd).join(', '),
          overlapStart: intToIpv4(overlapStart),
          overlapEnd: intToIpv4(overlapEnd),
          overlapAddressCount: overlapEnd - overlapStart + 1,
          relationship: getOverlapRelationship(first, second),
        });
      }
    }
  }

  return {
    blocks,
    overlaps,
    hasOverlaps: overlaps.length > 0,
    summary: {
      totalBlocks: blocks.length,
      overlapCount: overlaps.length,
      coveredAddressCount: getCoveredAddressCount(blocks),
    },
  };
}
