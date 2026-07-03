import { describe, expect, it } from 'vitest';
import {
  Base58StringConverterError,
  base58ToText,
  isValidBase58,
  summarizeBase58Input,
  textToBase58,
} from './base58-string-converter.service';

describe('base58-string-converter service', () => {
  it('encodes text with the Bitcoin alphabet by default', () => {
    expect(textToBase58('Hello World!')).toBe('2NEpo7TZRRrLZSi2U');
  });

  it('decodes text with the Bitcoin alphabet by default', () => {
    expect(base58ToText('2NEpo7TZRRrLZSi2U')).toBe('Hello World!');
  });

  it('round-trips unicode text', () => {
    const text = '你好, base58';

    expect(base58ToText(textToBase58(text))).toBe(text);
  });

  it('preserves leading zero bytes', () => {
    expect(textToBase58('\0\0a')).toBe('112g');
    expect(base58ToText('112g')).toBe('\0\0a');
  });

  it('supports the Flickr alphabet', () => {
    expect(textToBase58('Hello World!', { alphabet: 'flickr' })).toBe('2nePN7syqqRkyrH2t');
    expect(base58ToText('2nePN7syqqRkyrH2t', { alphabet: 'flickr' })).toBe('Hello World!');
  });

  it('rejects characters outside the selected alphabet', () => {
    expect(() => base58ToText('0OIl')).toThrow(Base58StringConverterError);
    expect(isValidBase58('0OIl')).toBe(false);
  });

  it('rejects decoded bytes that are not valid UTF-8 text', () => {
    expect(() => base58ToText('5Q')).toThrow('Decoded bytes are not valid UTF-8 text.');
  });

  it('summarizes Base58 input size', () => {
    expect(summarizeBase58Input(' 112g ')).toEqual({
      valid: true,
      normalizedLength: 4,
      leadingZeroBytes: 2,
      byteLength: 3,
    });
  });

  it('summarizes invalid Base58 input without throwing', () => {
    expect(summarizeBase58Input('0OIl')).toEqual({
      valid: false,
      normalizedLength: 0,
      leadingZeroBytes: 0,
      byteLength: 0,
      error: 'Invalid Base58 character "0".',
    });
  });
});
