import { describe, expect, it } from 'vitest';
import {
  Ipv4CidrMergeError,
  mergeIpv4Cidrs,
  mergeIpv4Ranges,
  parseIpv4RangeLine,
  rangeToCidrs,
} from './ipv4-cidr-merge.service';

describe('ipv4-cidr-merge service', () => {
  it('parses a single IP as a /32 range', () => {
    expect(parseIpv4RangeLine('192.168.1.10')).toEqual({ start: 3232235786, end: 3232235786 });
  });

  it('normalizes CIDR input to its network range', () => {
    expect(parseIpv4RangeLine('192.168.1.42/24')).toEqual({ start: 3232235776, end: 3232236031 });
  });

  it('parses explicit ranges', () => {
    expect(parseIpv4RangeLine('10.0.0.1 - 10.0.0.3')).toEqual({ start: 167772161, end: 167772163 });
  });

  it('rejects invalid ranges with a typed error', () => {
    expect(() => parseIpv4RangeLine('10.0.0.5-10.0.0.1')).toThrow(Ipv4CidrMergeError);
  });

  it('merges overlapping and adjacent ranges', () => {
    expect(mergeIpv4Ranges([
      { start: 10, end: 20 },
      { start: 1, end: 5 },
      { start: 6, end: 8 },
      { start: 18, end: 25 },
    ])).toEqual([
      { start: 1, end: 8 },
      { start: 10, end: 25 },
    ]);
  });

  it('converts ranges to minimal CIDR blocks', () => {
    expect(rangeToCidrs({ start: 3232235776, end: 3232236031 })).toEqual(['192.168.1.0/24']);
    expect(rangeToCidrs({ start: 3232235777, end: 3232235782 })).toEqual([
      '192.168.1.1/32',
      '192.168.1.2/31',
      '192.168.1.4/31',
      '192.168.1.6/32',
    ]);
  });

  it('handles high-bit IPv4 ranges without signed integer overflow', () => {
    expect(rangeToCidrs({ start: 2147483648, end: 2147483903 })).toEqual(['128.0.0.0/24']);
  });

  it('handles the whole IPv4 space', () => {
    expect(mergeIpv4Cidrs('0.0.0.0/0')).toBe('0.0.0.0/0');
  });

  it('collapses mixed input into sorted CIDR output', () => {
    expect(mergeIpv4Cidrs(`
      192.168.1.0/25
      192.168.1.128-192.168.1.255
      10.0.0.1
      10.0.0.2
    `)).toMatchInlineSnapshot(`
      "10.0.0.1/32
      10.0.0.2/32
      192.168.1.0/24"
    `);
  });

  it('adds input line numbers to parser errors', () => {
    expect(() => mergeIpv4Cidrs('10.0.0.1\nbad-ip')).toThrow('Line 2: Invalid IPv4 address "bad-ip".');
  });
});
