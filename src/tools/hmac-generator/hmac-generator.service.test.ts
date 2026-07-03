import { describe, expect, it } from 'vitest';
import { generateHmac } from './hmac-generator.service';

describe('hmac-generator service', () => {
  it('generates HMAC-SHA256 in hexadecimal', () => {
    expect(generateHmac({
      algorithm: 'SHA256',
      encoding: 'Hex',
      plainText: 'The quick brown fox jumps over the lazy dog',
      secret: 'key',
    })).toEqual({
      value: 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
      warnings: [],
    });
  });

  it('supports base64 output', () => {
    expect(generateHmac({
      algorithm: 'SHA1',
      encoding: 'Base64',
      plainText: 'hello',
      secret: 'secret',
    }).value).toBe('URIFXAX5RPhXVe/FzYlw4ZTp9Fs=');
  });

  it('supports binary output', () => {
    expect(generateHmac({
      algorithm: 'MD5',
      encoding: 'Bin',
      plainText: 'a',
      secret: 'b',
    }).value).toMatch(/^[01]+$/);
  });

  it('warns when the secret key is empty', () => {
    expect(generateHmac({
      algorithm: 'SHA256',
      encoding: 'Hex',
      plainText: 'payload',
      secret: '',
    }).warnings).toEqual(['Secret key is empty.']);
  });
});
