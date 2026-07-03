import { describe, expect, it } from 'vitest';
import {
  Ipv4CidrContainmentCheckerError,
  analyzeIpv4CidrContainment,
  parseIpv4CidrRules,
  parseIpv4CidrTargets,
} from './ipv4-cidr-containment-checker.service';

describe('ipv4-cidr-containment-checker service', () => {
  it('normalizes rules and target IP addresses', () => {
    expect(parseIpv4CidrRules('192.168.1.42/24')).toMatchObject([
      {
        cidr: '192.168.1.0/24',
        networkAddress: '192.168.1.0',
        broadcastAddress: '192.168.1.255',
        prefix: 24,
        addressCount: 256,
      },
    ]);

    expect(parseIpv4CidrTargets('192.168.1.10')).toMatchObject([
      {
        kind: 'ip',
        cidr: '192.168.1.10/32',
        networkAddress: '192.168.1.10',
        broadcastAddress: '192.168.1.10',
        addressCount: 1,
      },
    ]);
  });

  it('marks targets covered by a single containing rule', () => {
    const analysis = analyzeIpv4CidrContainment('10.0.0.0/24', [
      '10.0.0.42',
      '10.0.0.128/25',
    ].join('\n'));

    expect(analysis.summary).toEqual({
      ruleCount: 1,
      targetCount: 2,
      coveredCount: 2,
      partialCount: 0,
      unmatchedCount: 0,
    });
    expect(analysis.targets.map(target => ({
      target: target.target.cidr,
      status: target.status,
      relationship: target.matches[0]?.relationship,
      coveredAddressCount: target.coveredAddressCount,
    }))).toEqual([
      {
        target: '10.0.0.42/32',
        status: 'covered',
        relationship: 'contains-target',
        coveredAddressCount: 1,
      },
      {
        target: '10.0.0.128/25',
        status: 'covered',
        relationship: 'contains-target',
        coveredAddressCount: 128,
      },
    ]);
  });

  it('marks a target covered by multiple smaller rules', () => {
    const analysis = analyzeIpv4CidrContainment([
      '10.0.0.0/25',
      '10.0.0.128/25',
    ].join('\n'), '10.0.0.0/24');

    expect(analysis.targets[0]).toMatchObject({
      status: 'covered',
      coveredAddressCount: 256,
      uncoveredAddressCount: 0,
    });
    expect(analysis.targets[0]?.matches.map(match => match.relationship)).toEqual([
      'inside-target',
      'inside-target',
    ]);
  });

  it('marks partially covered and unmatched targets', () => {
    const analysis = analyzeIpv4CidrContainment('10.0.0.0/25', [
      '10.0.0.0/24',
      '10.0.1.1',
    ].join('\n'));

    expect(analysis.summary).toMatchObject({
      coveredCount: 0,
      partialCount: 1,
      unmatchedCount: 1,
    });
    expect(analysis.targets[0]).toMatchObject({
      status: 'partial',
      coveredAddressCount: 128,
      uncoveredAddressCount: 128,
    });
    expect(analysis.targets[0]?.matches[0]).toMatchObject({
      relationship: 'inside-target',
      overlapCidr: '10.0.0.0/25',
      overlapStart: '10.0.0.0',
      overlapEnd: '10.0.0.127',
    });
    expect(analysis.targets[1]).toMatchObject({
      status: 'unmatched',
      coveredAddressCount: 0,
      uncoveredAddressCount: 1,
      matches: [],
    });
  });

  it('supports exact matches and the whole IPv4 space', () => {
    const analysis = analyzeIpv4CidrContainment('0.0.0.0/0\n255.255.255.255/32', '0.0.0.0/0\n255.255.255.255');

    expect(analysis.targets[0]).toMatchObject({
      status: 'covered',
      coveredAddressCount: 2 ** 32,
    });
    expect(analysis.targets[0]?.matches[0]).toMatchObject({
      relationship: 'exact',
      overlapCidr: '0.0.0.0/0',
    });
    expect(analysis.targets[1]?.matches.map(match => match.relationship)).toEqual([
      'contains-target',
      'exact',
    ]);
  });

  it('adds line numbers to parser errors', () => {
    expect(() => analyzeIpv4CidrContainment('10.0.0.0/24\nbad-ip', '10.0.0.1')).toThrow(Ipv4CidrContainmentCheckerError);
    expect(() => analyzeIpv4CidrContainment('10.0.0.0/24\nbad-ip', '10.0.0.1')).toThrow('Line 2: Enter CIDR notation like 192.168.0.0/24.');
    expect(() => analyzeIpv4CidrContainment('10.0.0.0/24', '10.0.0.1/33')).toThrow('Line 1: CIDR prefix must be between 0 and 32.');
    expect(() => analyzeIpv4CidrContainment('10.0.0.0/24', 'bad-ip')).toThrow('Line 1: Invalid IPv4 address "bad-ip".');
  });
});
