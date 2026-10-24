import { describe, expect, it } from 'vitest';
import { getStringSizeInBytes, getTextStatistics } from './text-statistics.service';

describe('text-statistics', () => {
  describe('getStringSizeInBytes', () => {
    it('should return the size of a string in bytes', () => {
      expect(getStringSizeInBytes('')).toEqual(0);
      expect(getStringSizeInBytes('a')).toEqual(1);
      expect(getStringSizeInBytes('aa')).toEqual(2);
      expect(getStringSizeInBytes('😀')).toEqual(4);
      expect(getStringSizeInBytes('aaaaaaaaaa')).toEqual(10);
    });
  });

  describe('getTextStatistics', () => {
    it('preserves split-based word and line counts for whitespace and Unicode', () => {
      const allBmpCharacters = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).join('');
      const samples = ['', 'a', ' a  b\r\nc\n', '😀 x\r\n', '\t\r\u00a0', '\uD800', allBmpCharacters];

      for (const text of samples) {
        expect(getTextStatistics(text)).toEqual({
          characterCount: text.length,
          wordCount: text === '' ? 0 : text.split(/\s+/).length,
          lineCount: text === '' ? 0 : text.split(/\r\n|\r|\n/).length,
          byteSize: new TextEncoder().encode(text).byteLength,
        });
      }
    });
  });
});
