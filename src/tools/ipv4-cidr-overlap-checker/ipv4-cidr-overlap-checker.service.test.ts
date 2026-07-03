import { describe, expect, it } from 'vitest';
import {
  Ipv4CidrOverlapCheckerError,
  analyzeIpv4CidrOverlaps,
  parseIpv4Cidrs,
} from './ipv4-cidr-overlap-checker.service';

describe('ipv4-cidr-overlap-checker service', () => {
  it('normalizes CIDR blocks and keeps source line numbers', () => {
    expect(parseIpv4Cidrs('192.168.1.42/24\n\n10.0.0.1/32')).toMatchObject([
      {
        line: 1,
        input: '192.168.1.42/24',
        cidr: '192.168.1.0/24',
        networkAddress: '192.168.1.0',
        broadcastAddress: '192.168.1.255',
        prefix: 24,
        addressCount: 256,
      },
      {
        line: 3,
        input: '10.0.0.1/32',
        cidr: '10.0.0.1/32',
        networkAddress: '10.0.0.1',
        broadcastAddress: '10.0.0.1',
        prefix: 32,
        addressCount: 1,
      },
    ]);
  });

  it('finds duplicate, containment, and partial overlaps', () => {
    const analysis = analyzeIpv4CidrOverlaps([
      '192.168.1.0/24',
      '192.168.1.0/24',
      '192.168.1.64/26',
      '192.168.1.128/25',
      '192.168.1.192/26',
    ].join('\n'));

    expect(analysis.hasOverlaps).toBe(true);
    expect(analysis.summary).toEqual({
      totalBlocks: 5,
      overlapCount: 8,
      coveredAddressCount: 256,
    });
    expect(analysis.overlaps.map(overlap => ({
      first: overlap.first.cidr,
      second: overlap.second.cidr,
      overlapCidr: overlap.overlapCidr,
      relationship: overlap.relationship,
    }))).toEqual([
      {
        first: '192.168.1.0/24',
        second: '192.168.1.0/24',
        overlapCidr: '192.168.1.0/24',
        relationship: 'duplicate',
      },
      {
        first: '192.168.1.0/24',
        second: '192.168.1.64/26',
        overlapCidr: '192.168.1.64/26',
        relationship: 'contains',
      },
      {
        first: '192.168.1.0/24',
        second: '192.168.1.128/25',
        overlapCidr: '192.168.1.128/25',
        relationship: 'contains',
      },
      {
        first: '192.168.1.0/24',
        second: '192.168.1.192/26',
        overlapCidr: '192.168.1.192/26',
        relationship: 'contains',
      },
      {
        first: '192.168.1.0/24',
        second: '192.168.1.64/26',
        overlapCidr: '192.168.1.64/26',
        relationship: 'contains',
      },
      {
        first: '192.168.1.0/24',
        second: '192.168.1.128/25',
        overlapCidr: '192.168.1.128/25',
        relationship: 'contains',
      },
      {
        first: '192.168.1.0/24',
        second: '192.168.1.192/26',
        overlapCidr: '192.168.1.192/26',
        relationship: 'contains',
      },
      {
        first: '192.168.1.128/25',
        second: '192.168.1.192/26',
        overlapCidr: '192.168.1.192/26',
        relationship: 'contains',
      },
    ]);
  });

  it('detects nested overlaps when normalized CIDR blocks intersect', () => {
    const analysis = analyzeIpv4CidrOverlaps([
      '10.0.0.0/25',
      '10.0.0.64/26',
      '10.0.0.96/27',
    ].join('\n'));

    expect(analysis.overlaps.map(overlap => overlap.relationship)).toEqual([
      'contains',
      'contains',
      'contains',
    ]);
    expect(analysis.overlaps[analysis.overlaps.length - 1]).toMatchObject({
      overlapCidr: '10.0.0.96/27',
      overlapStart: '10.0.0.96',
      overlapEnd: '10.0.0.127',
      overlapAddressCount: 32,
    });
  });

  it('reports no overlaps for adjacent networks', () => {
    const analysis = analyzeIpv4CidrOverlaps([
      '10.0.0.0/25',
      '10.0.0.128/25',
      '10.0.1.0/24',
    ].join('\n'));

    expect(analysis.hasOverlaps).toBe(false);
    expect(analysis.overlaps).toEqual([]);
    expect(analysis.summary.coveredAddressCount).toBe(512);
  });

  it('supports the whole IPv4 space without signed overflow', () => {
    const analysis = analyzeIpv4CidrOverlaps('0.0.0.0/0\n255.255.255.255/32');

    expect(analysis.overlaps).toHaveLength(1);
    expect(analysis.overlaps[0]).toMatchObject({
      overlapCidr: '255.255.255.255/32',
      overlapStart: '255.255.255.255',
      overlapEnd: '255.255.255.255',
      relationship: 'contains',
    });
    expect(analysis.summary.coveredAddressCount).toBe(2 ** 32);
  });

  it('adds line numbers to parser errors', () => {
    expect(() => analyzeIpv4CidrOverlaps('10.0.0.0/24\nbad-ip')).toThrow(Ipv4CidrOverlapCheckerError);
    expect(() => analyzeIpv4CidrOverlaps('10.0.0.0/24\nbad-ip')).toThrow('Line 2: Enter CIDR notation like 192.168.0.0/24.');
    expect(() => analyzeIpv4CidrOverlaps('10.0.0.0/33')).toThrow('Line 1: CIDR prefix must be between 0 and 32.');
  });
});
