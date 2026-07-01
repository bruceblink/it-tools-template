import { describe, expect, it } from 'vitest';
import { parseHttpHeaders } from './http-headers-parser.service';

describe('http-headers-parser service', () => {
  it('parses a status line, normalizes names, and preserves duplicate headers', () => {
    const parsed = parseHttpHeaders(`
HTTP/2 200
content-type: application/json
set-cookie: session=abc; HttpOnly
Set-Cookie: theme=dark
cache-control: no-cache
`);

    expect(parsed.startLine).toBe('HTTP/2 200');
    expect(parsed.headers).toEqual([
      { name: 'content-type', normalizedName: 'Content-Type', value: 'application/json' },
      { name: 'set-cookie', normalizedName: 'Set-Cookie', value: 'session=abc; HttpOnly' },
      { name: 'Set-Cookie', normalizedName: 'Set-Cookie', value: 'theme=dark' },
      { name: 'cache-control', normalizedName: 'Cache-Control', value: 'no-cache' },
    ]);
    expect(parsed.json).toEqual({
      'Content-Type': 'application/json',
      'Set-Cookie': ['session=abc; HttpOnly', 'theme=dark'],
      'Cache-Control': 'no-cache',
    });
    expect(parsed.duplicates).toEqual([
      { name: 'Set-Cookie', values: ['session=abc; HttpOnly', 'theme=dark'] },
    ]);
  });

  it('folds continuation lines into the previous header value', () => {
    expect(parseHttpHeaders('x-note: first\r\n second\r\n\tthird').headers).toEqual([
      { name: 'x-note', normalizedName: 'X-Note', value: 'first second third' },
    ]);
  });

  it('creates normalized header text and cURL header arguments', () => {
    const parsed = parseHttpHeaders('accept: application/json\nx-request-id: abc123');

    expect(parsed.normalizedText).toBe('Accept: application/json\nX-Request-Id: abc123');
    expect(parsed.curlHeaders).toBe("-H 'Accept: application/json' \\\n  -H 'X-Request-Id: abc123'");
  });

  it('rejects malformed header lines after the optional start line', () => {
    expect(() => parseHttpHeaders('GET / HTTP/1.1\nmissing-colon')).toThrow('Invalid HTTP header line');
    expect(() => parseHttpHeaders(' bad-continuation')).toThrow('Header continuation line');
    expect(() => parseHttpHeaders('bad name: value')).toThrow('Invalid HTTP header name');
  });
});
