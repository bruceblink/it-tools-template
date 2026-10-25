import { describe, expect, it } from 'vitest';
import {
  API_MAX_BODY_BYTES,
  API_MAX_HEADERS_JSON_BYTES,
  API_MAX_URL_LENGTH,
  utf8ByteLengthWithinLimit,
} from '@/shared/desktop-services/api';
import { validateApiClientInput } from './api-client.validation';

describe('API Client input preflight', () => {
  it('keeps request text within the existing URL and header limits', () => {
    expect(validateApiClientInput('http://localhost/', '{"Accept":"application/json"}', '')).toBeNull();
    expect(validateApiClientInput('http://localhost/', ' '.repeat(API_MAX_HEADERS_JSON_BYTES + 1), ''))
      .toBe('headers-too-large');
  });

  it('enforces URL limits using UTF-8 bytes', () => {
    const base = 'http://a/?q=';
    const maximumUrl = base + 'é'.repeat((API_MAX_URL_LENGTH - base.length) / 2);
    expect(utf8ByteLengthWithinLimit(maximumUrl, API_MAX_URL_LENGTH)).toBe(API_MAX_URL_LENGTH);
    expect(validateApiClientInput(maximumUrl, '{}', '')).toBeNull();
    expect(validateApiClientInput(`${maximumUrl}é`, '{}', '')).toBe('url-too-large');
  });

  it('checks request bodies by UTF-8 byte size, including multibyte characters', () => {
    const maximumAsciiBody = 'x'.repeat(API_MAX_BODY_BYTES);
    expect(validateApiClientInput('http://localhost/', '{}', maximumAsciiBody)).toBeNull();
    expect(validateApiClientInput('http://localhost/', '{}', `${maximumAsciiBody}x`)).toBe('body-too-large');

    const maximumEmojiBody = '😀'.repeat(API_MAX_BODY_BYTES / 4);
    expect(validateApiClientInput('http://localhost/', '{}', maximumEmojiBody)).toBeNull();
    expect(validateApiClientInput('http://localhost/', '{}', `${maximumEmojiBody}😀`)).toBe('body-too-large');
  });

  it('matches TextEncoder byte counts and rejects after crossing its bound', () => {
    for (const value of ['', 'plain text', 'é', '😀', '\uD800', 'a😀é\uDC00']) {
      const byteLength = new TextEncoder().encode(value).byteLength;
      expect(utf8ByteLengthWithinLimit(value, byteLength)).toBe(byteLength);
      expect(utf8ByteLengthWithinLimit(value, byteLength - 1)).toBeNull();
    }
  });
});
