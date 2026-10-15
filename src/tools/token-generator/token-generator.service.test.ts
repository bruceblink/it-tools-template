import { describe, expect, it, vi } from 'vitest';
import { createToken, summarizeTokenOptions } from './token-generator.service';

describe('token-generator', () => {
  describe('createToken', () => {
    it('should generate an empty string when all params are false', () => {
      const token = createToken({
        withLowercase: false,
        withUppercase: false,
        withNumbers: false,
        withSymbols: false,
        length: 10,
      });

      expect(token).toHaveLength(0);
    });

    it('should generate a random string with the specified length', () => {
      const createTokenWithLength = (length: number) =>
        createToken({
          withLowercase: true,
          withUppercase: true,
          withNumbers: true,
          withSymbols: true,
          length,
        });

      expect(createTokenWithLength(5)).toHaveLength(5);
      expect(createTokenWithLength(10)).toHaveLength(10);
      expect(createTokenWithLength(100)).toHaveLength(100);
    });

    it('selects each character from the alphabet with the injected byte source', () => {
      const zeroSource = (bytes: Uint8Array) => bytes.fill(0);
      const oneSource = (bytes: Uint8Array) => bytes.fill(0x55);

      expect(createToken({ alphabet: 'ab', length: 4 }, zeroSource)).toBe('aaaa');
      expect(createToken({ alphabet: 'ab', length: 4 }, oneSource)).toBe('bbbb');
    });

    it('keeps empty alphabet and length behavior and bounds non-empty output', () => {
      const source = vi.fn((bytes: Uint8Array) => bytes.fill(0));

      expect(createToken({ alphabet: '', length: 4 }, source)).toBe('');
      expect(createToken({ alphabet: 'ab', length: 1.9 }, source)).toHaveLength(1);
      expect(createToken({ alphabet: 'ab', length: Number.NaN }, source)).toBe('');
      expect(() => createToken({ alphabet: 'ab', length: -1 }, source)).toThrow(RangeError);
      expect(() => createToken({ alphabet: 'ab', length: 65_537 }, source)).toThrow(RangeError);
    });

    it('should generate a random string with just uppercase if only withUppercase is set', () => {
      const token = createToken({
        withLowercase: false,
        withUppercase: true,
        withNumbers: false,
        withSymbols: false,
        length: 256,
      });

      expect(token).toHaveLength(256);
      expect(token).toMatch(/^[A-Z]+$/);
    });

    it('should generate a random string with just lowercase if only withLowercase is set', () => {
      const token = createToken({
        withLowercase: true,
        withUppercase: false,
        withNumbers: false,
        withSymbols: false,
        length: 256,
      });

      expect(token).toHaveLength(256);
      expect(token).toMatch(/^[a-z]+$/);
    });

    it('should generate a random string with just numbers if only withNumbers is set', () => {
      const token = createToken({
        withLowercase: false,
        withUppercase: false,
        withNumbers: true,
        withSymbols: false,
        length: 256,
      });

      expect(token).toHaveLength(256);
      expect(token).toMatch(/^[0-9]+$/);
    });

    it('should generate a random string with just symbols if only withSymbols is set', () => {
      const token = createToken({
        withLowercase: false,
        withUppercase: false,
        withNumbers: false,
        withSymbols: true,
        length: 256,
      });

      expect(token).toHaveLength(256);
      expect(token).toMatch(/^[.,;:!?./\-"'#{([-|\\@)\]=}*+]+$/);
    });

    it('should generate a random string with just letters (case incensitive) with withLowercase and withUppercase', () => {
      const token = createToken({
        withLowercase: true,
        withUppercase: true,
        withNumbers: false,
        withSymbols: false,
        length: 256,
      });

      expect(token).toHaveLength(256);
      expect(token).toMatch(/^[a-zA-Z]+$/);
    });
  });

  describe('summarizeTokenOptions', () => {
    it('estimates alphabet size and entropy for default-like options', () => {
      expect(summarizeTokenOptions({
        withLowercase: true,
        withUppercase: true,
        withNumbers: true,
        withSymbols: false,
        length: 32,
      })).toMatchObject({
        alphabetSize: 60,
        length: 32,
        entropyBits: 189,
        combinationsExponent: 57,
        warnings: [],
      });
    });

    it('warns about low entropy tokens', () => {
      expect(summarizeTokenOptions({
        withLowercase: false,
        withUppercase: false,
        withNumbers: true,
        withSymbols: false,
        length: 6,
      }).warnings).toEqual(['Entropy is below 64 bits.']);
    });

    it('warns when no characters are enabled', () => {
      expect(summarizeTokenOptions({
        withLowercase: false,
        withUppercase: false,
        withNumbers: false,
        withSymbols: false,
        length: 10,
      })).toMatchObject({
        alphabetSize: 0,
        entropyBits: 0,
        combinationsExponent: 0,
        warnings: ['No characters are enabled.'],
      });
    });
  });
});
