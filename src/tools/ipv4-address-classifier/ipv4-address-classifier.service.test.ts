import { describe, expect, it } from 'vitest';
import { Ipv4AddressClassifierError, classifyIpv4Address } from './ipv4-address-classifier.service';

describe('ipv4-address-classifier service', () => {
  it.each([
    ['10.1.2.3', 'Private network', 'private', '10.0.0.0/8'],
    ['172.16.0.1', 'Private network', 'private', '172.16.0.0/12'],
    ['192.168.1.1', 'Private network', 'private', '192.168.0.0/16'],
    ['127.0.0.1', 'Loopback', 'special', '127.0.0.0/8'],
    ['169.254.10.20', 'Link-local', 'special', '169.254.0.0/16'],
    ['100.64.0.1', 'Carrier-grade NAT', 'special', '100.64.0.0/10'],
    ['192.88.99.1', '6to4 relay anycast', 'special', '192.88.99.0/24'],
    ['198.51.100.10', 'Documentation', 'special', '198.51.100.0/24'],
    ['233.252.0.1', 'Documentation multicast', 'special', '233.252.0.0/24'],
    ['224.0.0.1', 'Multicast', 'special', '224.0.0.0/4'],
    ['240.0.0.1', 'Reserved', 'special', '240.0.0.0/4'],
    ['255.255.255.255', 'Limited broadcast', 'special', '255.255.255.255/32'],
  ])('classifies %s as %s', (ip, label, scope, cidr) => {
    expect(classifyIpv4Address(ip).rule).toMatchObject({ label, scope, cidr });
  });

  it('classifies routable addresses as public unicast', () => {
    expect(classifyIpv4Address('8.8.8.8').rule).toMatchObject({
      label: 'Public unicast',
      scope: 'public',
      cidr: '0.0.0.0/0',
    });
  });

  it('returns numeric representations', () => {
    expect(classifyIpv4Address('192.168.1.1')).toMatchObject({
      integer: 3232235777,
      binary: '11000000.10101000.00000001.00000001',
      hex: '0xC0A80101',
      ipClass: 'C',
    });
  });

  it('rejects invalid IPv4 addresses', () => {
    expect(() => classifyIpv4Address('999.1.1.1')).toThrow(Ipv4AddressClassifierError);
  });
});
