import { describe, expect, it } from 'vitest';
import { HexStringConverterError, hexToText, isValidHex, summarizeHexInput, textToHex } from './hex-string-converter.service';

describe('hex-string-converter service', () => {
  it('encodes UTF-8 text to lowercase hex by default', () => {
    expect(textToHex('Hello')).toBe('48656c6c6f');
  });

  it('encodes UTF-8 text with uppercase hex and separators', () => {
    expect(textToHex('Hello', { uppercase: true, separator: ' ' })).toBe('48 65 6C 6C 6F');
  });

  it('round-trips unicode text', () => {
    const text = '你好, hex';

    expect(hexToText(textToHex(text))).toBe(text);
  });

  it('decodes contiguous hex text', () => {
    expect(hexToText('48656c6c6f')).toBe('Hello');
  });

  it('decodes common separator formats by default', () => {
    expect(hexToText('0x48 0x65:6c-6c_6f')).toBe('Hello');
  });

  it('rejects separators when separator support is disabled', () => {
    expect(isValidHex('48 65', { allowSeparators: false })).toBe(false);
    expect(() => hexToText('48 65', { allowSeparators: false })).toThrow(HexStringConverterError);
  });

  it('rejects odd-length hex input', () => {
    expect(() => hexToText('486')).toThrow('Hex input must contain an even number of digits.');
  });

  it('rejects non-hex characters', () => {
    expect(() => hexToText('486x')).toThrow('Input contains non-hexadecimal characters.');
  });

  it('rejects invalid UTF-8 bytes', () => {
    expect(() => hexToText('ff')).toThrow('Decoded bytes are not valid UTF-8 text.');
  });

  it('summarizes normalized hex input size', () => {
    expect(summarizeHexInput('0x48 0x65:6c-6c_6f')).toEqual({
      valid: true,
      normalizedLength: 10,
      byteLength: 5,
    });
  });

  it('summarizes invalid hex input without throwing', () => {
    expect(summarizeHexInput('zz', { allowSeparators: false })).toEqual({
      valid: false,
      normalizedLength: 0,
      byteLength: 0,
      error: 'Input contains non-hexadecimal characters.',
    });
  });
});
