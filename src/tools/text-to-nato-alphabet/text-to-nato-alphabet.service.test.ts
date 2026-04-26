import { describe, expect, it } from 'vitest';
import { textToNatoAlphabet } from './text-to-nato-alphabet.service';

describe('text-to-nato-alphabet service', () => {
  describe('textToNatoAlphabet', () => {
    it('converts a single letter to its NATO word', () => {
      expect(textToNatoAlphabet({ text: 'A' })).toBe('Alpha');
      expect(textToNatoAlphabet({ text: 'B' })).toBe('Bravo');
      expect(textToNatoAlphabet({ text: 'Z' })).toBe('Zulu');
    });

    it('is case-insensitive', () => {
      expect(textToNatoAlphabet({ text: 'a' })).toBe('Alpha');
      expect(textToNatoAlphabet({ text: 'z' })).toBe('Zulu');
    });

    it('converts a word to space-separated NATO words', () => {
      expect(textToNatoAlphabet({ text: 'SOS' })).toBe('Sierra Oscar Sierra');
    });

    it('preserves non-alphabetic characters as-is', () => {
      expect(textToNatoAlphabet({ text: 'A1B' })).toBe('Alpha 1 Bravo');
      expect(textToNatoAlphabet({ text: 'A B' })).toBe('Alpha   Bravo');
    });

    it('returns empty string for empty input', () => {
      expect(textToNatoAlphabet({ text: '' })).toBe('');
    });

    it('converts full alphabet', () => {
      const result = textToNatoAlphabet({ text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
      const words = result.split(' ');
      expect(words).toEqual([
        'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot',
        'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike',
        'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra',
        'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu',
      ]);
    });
  });
});
