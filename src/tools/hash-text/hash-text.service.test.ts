import { describe, expect, it } from 'vitest';
import { convertHexToBin, getHashDigestSize } from './hash-text.service';

describe('hash text', () => {
  describe('convertHexToBin', () => {
    it('convert hex to bin', () => {
      expect(convertHexToBin('')).toEqual('');
      expect(convertHexToBin('FF')).toEqual('11111111');
      expect(convertHexToBin('F'.repeat(200))).toEqual('1111'.repeat(200));
      expect(convertHexToBin('2123006AD00F694CE120')).toEqual(
        '00100001001000110000000001101010110100000000111101101001010011001110000100100000',
      );
    });
  });

  describe('getHashDigestSize', () => {
    it('returns digest size metadata', () => {
      expect(getHashDigestSize('MD5')).toEqual({ bits: 128, bytes: 16 });
      expect(getHashDigestSize('SHA256')).toEqual({ bits: 256, bytes: 32 });
      expect(getHashDigestSize('SHA512')).toEqual({ bits: 512, bytes: 64 });
    });
  });
});
