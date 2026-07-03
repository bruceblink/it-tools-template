import { ipv4ToInt, isValidIpv4 } from '../ipv4-address-converter/ipv4-address-converter.service';

export interface Ipv4Range {
  start: number
  end: number
}

export class Ipv4CidrMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ipv4CidrMergeError';
  }
}

const ipv4RangeSeparatorRegex = /^\s*([0-9.]+)\s*-\s*([0-9.]+)\s*$/;

function intToIpv4(value: number) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function assertValidPrefix(prefixText: string) {
  if (!/^\d+$/.test(prefixText)) {
    throw new Ipv4CidrMergeError(`Invalid CIDR prefix "${prefixText}".`);
  }

  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Ipv4CidrMergeError(`CIDR prefix must be between 0 and 32.`);
  }

  return prefix;
}

function parseIpv4(value: string) {
  const ip = value.trim();
  if (!isValidIpv4({ ip })) {
    throw new Ipv4CidrMergeError(`Invalid IPv4 address "${value}".`);
  }

  return ipv4ToInt({ ip }) >>> 0;
}

function parseCidr(value: string): Ipv4Range {
  const [ipText, prefixText, ...extraParts] = value.split('/');
  if (!ipText || !prefixText || extraParts.length > 0) {
    throw new Ipv4CidrMergeError(`Invalid CIDR "${value}".`);
  }

  const ip = parseIpv4(ipText);
  const prefix = assertValidPrefix(prefixText.trim());
  const size = 2 ** (32 - prefix);
  const start = Math.floor(ip / size) * size;

  return {
    start,
    end: start + size - 1,
  };
}

function parseRange(value: string): Ipv4Range {
  const match = ipv4RangeSeparatorRegex.exec(value);
  if (!match) {
    throw new Ipv4CidrMergeError(`Invalid range "${value}".`);
  }

  const [, startText, endText] = match;
  const start = parseIpv4(startText);
  const end = parseIpv4(endText);

  if (start > end) {
    throw new Ipv4CidrMergeError(`Range start must be lower than or equal to range end.`);
  }

  return { start, end };
}

export function parseIpv4RangeLine(value: string): Ipv4Range {
  const line = value.trim();
  if (line.includes('/')) {
    return parseCidr(line);
  }

  if (ipv4RangeSeparatorRegex.test(line)) {
    return parseRange(line);
  }

  const ip = parseIpv4(line);
  return { start: ip, end: ip };
}

export function parseIpv4Ranges(input: string): Ipv4Range[] {
  return input
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return parseIpv4RangeLine(line);
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Ipv4CidrMergeError(`Line ${index + 1}: ${message}`);
      }
    });
}

export function mergeIpv4Ranges(ranges: Ipv4Range[]): Ipv4Range[] {
  const sortedRanges = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedRanges: Ipv4Range[] = [];

  for (const range of sortedRanges) {
    const previous = mergedRanges.at(-1);
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
    }
    else {
      mergedRanges.push({ ...range });
    }
  }

  return mergedRanges;
}

export function rangeToCidrs(range: Ipv4Range): string[] {
  const cidrs: string[] = [];
  let start = range.start;

  while (start <= range.end) {
    const remaining = range.end - start + 1;
    const alignmentBlock = getLargestAlignedBlock(start);
    const maxBlock = 2 ** Math.floor(Math.log2(remaining));
    const blockSize = Math.min(alignmentBlock, maxBlock);
    const prefix = 32 - Math.log2(blockSize);

    cidrs.push(`${intToIpv4(start)}/${prefix}`);
    start += blockSize;
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

export function mergeIpv4Cidrs(input: string): string {
  if (input.trim() === '') {
    return '';
  }

  const ranges = mergeIpv4Ranges(parseIpv4Ranges(input));
  return ranges.flatMap(range => rangeToCidrs(range)).join('\n');
}
