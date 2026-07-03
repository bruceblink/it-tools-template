import { ipv4ToInt, isValidIpv4 } from '../ipv4-address-converter/ipv4-address-converter.service';

export interface Ipv4CidrContainmentBlock {
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

export interface Ipv4CidrContainmentTarget extends Ipv4CidrContainmentBlock {
  kind: 'ip' | 'cidr'
}

export type Ipv4CidrContainmentStatus = 'covered' | 'partial' | 'unmatched';
export type Ipv4CidrContainmentRelationship = 'exact' | 'contains-target' | 'inside-target' | 'partial';

export interface Ipv4CidrContainmentMatch {
  rule: Ipv4CidrContainmentBlock
  relationship: Ipv4CidrContainmentRelationship
  overlapCidr: string
  overlapStart: string
  overlapEnd: string
  overlapAddressCount: number
}

export interface Ipv4CidrContainmentCheck {
  target: Ipv4CidrContainmentTarget
  status: Ipv4CidrContainmentStatus
  matches: Ipv4CidrContainmentMatch[]
  coveredAddressCount: number
  uncoveredAddressCount: number
}

export interface Ipv4CidrContainmentAnalysis {
  rules: Ipv4CidrContainmentBlock[]
  targets: Ipv4CidrContainmentCheck[]
  summary: {
    ruleCount: number
    targetCount: number
    coveredCount: number
    partialCount: number
    unmatchedCount: number
  }
}

export class Ipv4CidrContainmentCheckerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ipv4CidrContainmentCheckerError';
  }
}

interface Range {
  start: number
  end: number
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
    throw new Ipv4CidrContainmentCheckerError(`Invalid IPv4 address "${value}".`);
  }

  return ipv4ToInt({ ip }) >>> 0;
}

function parsePrefix(value: string) {
  const prefixText = value.trim();
  if (!/^\d+$/.test(prefixText)) {
    throw new Ipv4CidrContainmentCheckerError(`Invalid CIDR prefix "${value}".`);
  }

  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Ipv4CidrContainmentCheckerError('CIDR prefix must be between 0 and 32.');
  }

  return prefix;
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

function createBlock(input: string, line: number, ip: number, prefix: number): Ipv4CidrContainmentBlock {
  const addressCount = 2 ** (32 - prefix);
  const start = Math.floor(ip / addressCount) * addressCount;
  const end = start + addressCount - 1;

  return {
    line,
    input,
    cidr: `${intToIpv4(start)}/${prefix}`,
    networkAddress: intToIpv4(start),
    broadcastAddress: intToIpv4(end),
    prefix,
    addressCount,
    start,
    end,
  };
}

function parseCidrBlock(line: string, lineNumber: number): Ipv4CidrContainmentBlock {
  const parts = line.split('/');
  const ipText = parts[0];
  const prefixText = parts[1];

  if (!ipText || !prefixText || parts.length !== 2) {
    throw new Ipv4CidrContainmentCheckerError('Enter CIDR notation like 192.168.0.0/24.');
  }

  return createBlock(line, lineNumber, parseIpv4(ipText), parsePrefix(prefixText));
}

function parseTarget(line: string, lineNumber: number): Ipv4CidrContainmentTarget {
  if (line.includes('/')) {
    return {
      ...parseCidrBlock(line, lineNumber),
      kind: 'cidr',
    };
  }

  const ip = parseIpv4(line);

  return {
    ...createBlock(line, lineNumber, ip, 32),
    kind: 'ip',
  };
}

function parseLines<T>(input: string, parser: (line: string, lineNumber: number) => T): T[] {
  return input
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line !== '')
    .map(({ line, lineNumber }) => {
      try {
        return parser(line, lineNumber);
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Ipv4CidrContainmentCheckerError(`Line ${lineNumber}: ${message}`);
      }
    });
}

function getRelationship(rule: Ipv4CidrContainmentBlock, target: Ipv4CidrContainmentTarget): Ipv4CidrContainmentRelationship {
  if (rule.start === target.start && rule.end === target.end) {
    return 'exact';
  }

  if (rule.start <= target.start && rule.end >= target.end) {
    return 'contains-target';
  }

  if (target.start <= rule.start && target.end >= rule.end) {
    return 'inside-target';
  }

  return 'partial';
}

function mergeRanges(ranges: Range[]): Range[] {
  const sortedRanges = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedRanges: Range[] = [];

  for (const range of sortedRanges) {
    const previous = mergedRanges[mergedRanges.length - 1];
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }

    mergedRanges.push({ ...range });
  }

  return mergedRanges;
}

function countAddresses(ranges: Range[]) {
  return ranges.reduce((total, range) => total + range.end - range.start + 1, 0);
}

function checkTarget(rules: Ipv4CidrContainmentBlock[], target: Ipv4CidrContainmentTarget): Ipv4CidrContainmentCheck {
  const matches: Ipv4CidrContainmentMatch[] = [];
  const coveredRanges: Range[] = [];

  for (const rule of rules) {
    const overlapStart = Math.max(rule.start, target.start);
    const overlapEnd = Math.min(rule.end, target.end);

    if (overlapStart > overlapEnd) {
      continue;
    }

    coveredRanges.push({ start: overlapStart, end: overlapEnd });
    matches.push({
      rule,
      relationship: getRelationship(rule, target),
      overlapCidr: rangeToCidrs(overlapStart, overlapEnd).join(', '),
      overlapStart: intToIpv4(overlapStart),
      overlapEnd: intToIpv4(overlapEnd),
      overlapAddressCount: overlapEnd - overlapStart + 1,
    });
  }

  const coveredAddressCount = countAddresses(mergeRanges(coveredRanges));
  const uncoveredAddressCount = target.addressCount - coveredAddressCount;
  const status: Ipv4CidrContainmentStatus = coveredAddressCount === target.addressCount
    ? 'covered'
    : coveredAddressCount > 0
      ? 'partial'
      : 'unmatched';

  return {
    target,
    status,
    matches,
    coveredAddressCount,
    uncoveredAddressCount,
  };
}

export function parseIpv4CidrRules(input: string): Ipv4CidrContainmentBlock[] {
  return parseLines(input, parseCidrBlock);
}

export function parseIpv4CidrTargets(input: string): Ipv4CidrContainmentTarget[] {
  return parseLines(input, parseTarget);
}

export function analyzeIpv4CidrContainment(rulesInput: string, targetsInput: string): Ipv4CidrContainmentAnalysis {
  const rules = parseIpv4CidrRules(rulesInput).sort((left, right) => left.start - right.start || left.end - right.end || left.line - right.line);
  const targets = parseIpv4CidrTargets(targetsInput)
    .map(target => checkTarget(rules, target));

  return {
    rules,
    targets,
    summary: {
      ruleCount: rules.length,
      targetCount: targets.length,
      coveredCount: targets.filter(({ status }) => status === 'covered').length,
      partialCount: targets.filter(({ status }) => status === 'partial').length,
      unmatchedCount: targets.filter(({ status }) => status === 'unmatched').length,
    },
  };
}
