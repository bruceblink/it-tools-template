import { describe, expect, it } from 'vitest';
import { Ipv4WildcardMaskError, calculateIpv4Wildcard } from './ipv4-wildcard-mask.service';

describe('ipv4-wildcard-mask service', () => {
  it('calculates wildcard mask details from CIDR notation', () => {
    expect(calculateIpv4Wildcard('192.168.1.42/24', 'cidr')).toMatchObject({
      inputIp: '192.168.1.42',
      networkAddress: '192.168.1.0',
      broadcastAddress: '192.168.1.255',
      firstAddress: '192.168.1.0',
      lastAddress: '192.168.1.255',
      cidr: '192.168.1.0/24',
      prefix: 24,
      subnetMask: '255.255.255.0',
      wildcardMask: '0.0.0.255',
      addressCount: 256,
      usableHostCount: 254,
      aclSource: '192.168.1.0 0.0.0.255',
    });
  });

  it('calculates wildcard mask details from an IPv4 address and subnet mask', () => {
    expect(calculateIpv4Wildcard('10.20.30.40 255.255.252.0', 'netmask')).toMatchObject({
      networkAddress: '10.20.28.0',
      cidr: '10.20.28.0/22',
      subnetMask: '255.255.252.0',
      wildcardMask: '0.0.3.255',
      addressCount: 1024,
      usableHostCount: 1022,
    });
  });

  it('calculates wildcard mask details from an IPv4 address and wildcard mask', () => {
    expect(calculateIpv4Wildcard('172.16.8.9/0.0.7.255', 'wildcard')).toMatchObject({
      networkAddress: '172.16.8.0',
      cidr: '172.16.8.0/21',
      subnetMask: '255.255.248.0',
      wildcardMask: '0.0.7.255',
    });
  });

  it('formats host and any ACL source shortcuts', () => {
    expect(calculateIpv4Wildcard('192.168.1.42/32', 'cidr')).toMatchObject({
      aclSource: 'host 192.168.1.42',
      standardAclLine: 'access-list 10 permit host 192.168.1.42',
      extendedAclLine: 'access-list 100 permit ip host 192.168.1.42 any',
    });

    expect(calculateIpv4Wildcard('192.168.1.42/0', 'cidr')).toMatchObject({
      aclSource: 'any',
      cidr: '0.0.0.0/0',
      wildcardMask: '255.255.255.255',
    });
  });

  it('returns binary mask representations', () => {
    expect(calculateIpv4Wildcard('192.168.1.42/26', 'cidr')).toMatchObject({
      binarySubnetMask: '11111111.11111111.11111111.11000000',
      binaryWildcardMask: '00000000.00000000.00000000.00111111',
    });
  });

  it('rejects invalid CIDR prefix values', () => {
    expect(() => calculateIpv4Wildcard('192.168.1.1/33', 'cidr')).toThrow(Ipv4WildcardMaskError);
  });

  it('rejects non-contiguous subnet masks', () => {
    expect(() => calculateIpv4Wildcard('192.168.1.1 255.0.255.0', 'netmask')).toThrow('Subnet mask must contain contiguous one bits.');
  });

  it('rejects non-contiguous wildcard masks', () => {
    expect(() => calculateIpv4Wildcard('192.168.1.1 0.0.5.255', 'wildcard')).toThrow('Wildcard mask must be the inverse of a contiguous subnet mask.');
  });
});
