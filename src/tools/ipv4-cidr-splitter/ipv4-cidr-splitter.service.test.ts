import { describe, expect, it } from 'vitest';
import { Ipv4CidrSplitterError, formatIpv4CidrSplit, splitIpv4Cidr } from './ipv4-cidr-splitter.service';

describe('ipv4-cidr-splitter service', () => {
  it('splits a CIDR block into equal-size child subnets', () => {
    expect(splitIpv4Cidr('192.168.0.42/24', 26)).toMatchObject({
      sourceCidr: '192.168.0.0/24',
      sourceNetworkAddress: '192.168.0.0',
      sourceBroadcastAddress: '192.168.0.255',
      sourcePrefix: 24,
      targetPrefix: 26,
      subnetCount: 4,
      addressesPerSubnet: 64,
      subnets: [
        {
          cidr: '192.168.0.0/26',
          networkAddress: '192.168.0.0',
          broadcastAddress: '192.168.0.63',
          addressCount: 64,
        },
        {
          cidr: '192.168.0.64/26',
          networkAddress: '192.168.0.64',
          broadcastAddress: '192.168.0.127',
        },
        {
          cidr: '192.168.0.128/26',
          networkAddress: '192.168.0.128',
          broadcastAddress: '192.168.0.191',
        },
        {
          cidr: '192.168.0.192/26',
          networkAddress: '192.168.0.192',
          broadcastAddress: '192.168.0.255',
        },
      ],
    });
  });

  it('returns the normalized source block when the target prefix is unchanged', () => {
    expect(formatIpv4CidrSplit('10.0.0.15/28', 28)).toBe('10.0.0.0/28');
  });

  it('handles high-bit IPv4 networks without signed overflow', () => {
    expect(formatIpv4CidrSplit('255.255.255.0/30', 31)).toBe([
      '255.255.255.0/31',
      '255.255.255.2/31',
    ].join('\n'));
  });

  it('rejects target prefixes shorter than the source prefix', () => {
    expect(() => splitIpv4Cidr('192.168.0.0/24', 23)).toThrow(Ipv4CidrSplitterError);
  });

  it('rejects invalid CIDR input', () => {
    expect(() => splitIpv4Cidr('192.168.0.1', 26)).toThrow('Enter CIDR notation like 192.168.0.0/24.');
    expect(() => splitIpv4Cidr('999.168.0.1/24', 26)).toThrow('Invalid IPv4 address "999.168.0.1".');
    expect(() => splitIpv4Cidr('192.168.0.1/33', 33)).toThrow('CIDR prefix must be between 0 and 32.');
  });

  it('limits very large subnet output', () => {
    expect(() => splitIpv4Cidr('0.0.0.0/0', 32)).toThrow('This split would create 4,294,967,296 subnets.');
    expect(() => splitIpv4Cidr('10.0.0.0/24', 32, { maxSubnets: 100 })).toThrow('This split would create 256 subnets.');
  });
});
