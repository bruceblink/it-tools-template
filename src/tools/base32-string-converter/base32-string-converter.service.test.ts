import { describe, expect, it } from 'vitest';
import {
  Base32StringConverterError,
  base32ToText,
  isValidBase32,
  textToBase32,
} from './base32-string-converter.service';

describe('base32-string-converter service', () => {
  it.each([
    ['', ''],
    ['f', 'MY======'],
    ['fo', 'MZXQ===='],
    ['foo', 'MZXW6==='],
    ['foob', 'MZXW6YQ='],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI======'],
  ])('encodes %s as RFC4648 Base32', (input, output) => {
    expect(textToBase32(input)).toBe(output);
  });

  it('can omit Base32 padding while encoding', () => {
    expect(textToBase32('foobar', { padding: false })).toBe('MZXW6YTBOI');
  });

  it('decodes padded and unpadded Base32 text', () => {
    expect(base32ToText('MZXW6YTBOI======')).toBe('foobar');
    expect(base32ToText('MZXW6YTBOI')).toBe('foobar');
  });

  it('decodes lowercase input', () => {
    expect(base32ToText('mzxw6ytboi======')).toBe('foobar');
  });

  it('encodes and decodes UTF-8 text', () => {
    const text = '你好, TOTP';

    expect(base32ToText(textToBase32(text))).toBe(text);
  });

  it('optionally accepts spaces and hyphens for copied secrets', () => {
    expect(base32ToText('MZXW 6YTB-OI======', { allowSeparators: true })).toBe('foobar');
    expect(isValidBase32('MZXW 6YTB-OI======', { allowSeparators: true })).toBe(true);
  });

  it('rejects separators when separator support is disabled', () => {
    expect(isValidBase32('MZXW-6YTB')).toBe(false);
    expect(isValidBase32('MZXW 6YTB')).toBe(false);
  });

  it('rejects invalid Base32 characters', () => {
    expect(() => base32ToText('MZXW6YTBO1======')).toThrow(Base32StringConverterError);
  });

  it('rejects invalid padding', () => {
    expect(() => base32ToText('MZXW6Y=')).toThrow('Invalid Base32 padding.');
  });

  it('rejects invalid trailing bits', () => {
    expect(() => base32ToText('MB')).toThrow('Invalid trailing Base32 bits.');
  });
});
