import { describe, expect, it } from 'vitest';
import { parseApiRequest, parseApiRequestId } from './api-protocol';

const baseRequest = {
  requestId: 'request-1',
  method: 'GET',
  url: 'http://127.0.0.1:43123/health',
  headers: { Accept: 'application/json' },
  body: null,
  timeoutMs: 10_000,
};

describe('API request protocol', () => {
  it('accepts bounded HTTP requests and defaults the timeout', () => {
    const request = parseApiRequest({ ...baseRequest, timeoutMs: undefined });
    expect(request).toMatchObject({ requestId: 'request-1', method: 'GET', timeoutMs: 10_000 });
  });

  it('rejects unsafe URLs, forbidden headers, and bodies on GET', () => {
    expect(parseApiRequest({ ...baseRequest, url: 'file:///tmp/secret' })).toBeNull();
    expect(parseApiRequest({ ...baseRequest, headers: { Host: 'internal' } })).toBeNull();
    expect(parseApiRequest({ ...baseRequest, body: '{}' })).toBeNull();
  });

  it('rejects oversized headers, body, timeout, and unknown request keys', () => {
    expect(parseApiRequest({ ...baseRequest, headers: { 'X-Large': 'x'.repeat(16 * 1024) } })).toBeNull();
    expect(parseApiRequest({ ...baseRequest, method: 'POST', body: 'x'.repeat(256 * 1024 + 1) })).toBeNull();
    expect(parseApiRequest({ ...baseRequest, timeoutMs: 31_000 })).toBeNull();
    expect(parseApiRequest({ ...baseRequest, extra: true })).toBeNull();
  });

  it('accepts only bounded cancellation IDs', () => {
    expect(parseApiRequestId({ requestId: 'request-1' })).toBe('request-1');
    expect(parseApiRequestId({ requestId: 'x'.repeat(65) })).toBeNull();
    expect(parseApiRequestId({ requestId: 'request-1', extra: true })).toBeNull();
  });
});
