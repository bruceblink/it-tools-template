import { describe, expect, it } from 'vitest';
import { generateRandomMacAddress, splitPrefix, summarizeMacAddressOptions } from './mac-adress-generator.models';

describe('mac-adress-generator models', () => {
  describe('splitPrefix', () => {
    it('a mac address prefix is splitted around non hex characters', () => {
      expect(splitPrefix('')).toEqual([]);
      expect(splitPrefix('01')).toEqual(['01']);
      expect(splitPrefix('01:')).toEqual(['01']);
      expect(splitPrefix('01:23')).toEqual(['01', '23']);
      expect(splitPrefix('01-23')).toEqual(['01', '23']);
    });

    it('when a prefix contains only hex characters, they are grouped by 2', () => {
      expect(splitPrefix('0123')).toEqual(['01', '23']);
      expect(splitPrefix('012345')).toEqual(['01', '23', '45']);
      expect(splitPrefix('0123456')).toEqual(['01', '23', '45', '06']);
    });
  });

  describe('generateRandomMacAddress', () => {
    const createRandomByteGenerator = () => {
      let i = 0;
      return () => (i++).toString(16).padStart(2, '0');
    };

    it('generates a random mac address', () => {
      expect(generateRandomMacAddress({ getRandomByte: createRandomByteGenerator() })).toBe('00:01:02:03:04:05');
    });

    it('generates a random mac address with a prefix', () => {
      expect(generateRandomMacAddress({ prefix: 'ff:ee:aa', getRandomByte: createRandomByteGenerator() })).toBe('ff:ee:aa:00:01:02');
      expect(generateRandomMacAddress({ prefix: 'ff:ee:a', getRandomByte: createRandomByteGenerator() })).toBe('ff:ee:0a:00:01:02');
    });

    it('generates a random mac address with a prefix and a different separator', () => {
      expect(generateRandomMacAddress({ prefix: 'ff-ee-aa', separator: '-', getRandomByte: createRandomByteGenerator() })).toBe('ff-ee-aa-00-01-02');
      expect(generateRandomMacAddress({ prefix: 'ff:ee:aa', separator: '-', getRandomByte: createRandomByteGenerator() })).toBe('ff-ee-aa-00-01-02');
      expect(generateRandomMacAddress({ prefix: 'ff-ee:aa', separator: '-', getRandomByte: createRandomByteGenerator() })).toBe('ff-ee-aa-00-01-02');
      expect(generateRandomMacAddress({ prefix: 'ff ee:aa', separator: '-', getRandomByte: createRandomByteGenerator() })).toBe('ff-ee-aa-00-01-02');
    });
  });

  describe('summarizeMacAddressOptions', () => {
    it('summarizes generated address size and random bytes', () => {
      expect(summarizeMacAddressOptions({ prefix: '64:16', amount: 3 })).toEqual({
        amount: 3,
        prefixBytes: 2,
        randomBytes: 4,
        totalBytes: 18,
        warnings: [],
      });
    });

    it('warns when the prefix fixes the OUI portion', () => {
      expect(summarizeMacAddressOptions({ prefix: '64:16:7f', amount: 1 })).toMatchObject({
        prefixBytes: 3,
        randomBytes: 3,
        warnings: ['Prefix fixes the OUI/vendor portion of the MAC address.'],
      });
    });

    it('warns when the prefix fills the full MAC address', () => {
      expect(summarizeMacAddressOptions({ prefix: '64:16:7f:aa:bb:cc', amount: 2 })).toMatchObject({
        prefixBytes: 6,
        randomBytes: 0,
        warnings: [
          'Prefix fixes the OUI/vendor portion of the MAC address.',
          'Prefix fills the full MAC address; generated values will be identical.',
        ],
      });
    });
  });
});
