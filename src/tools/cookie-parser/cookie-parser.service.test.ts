import { describe, expect, it } from 'vitest';
import { parseCookies } from './cookie-parser.service';

describe('cookie-parser service', () => {
  it('parses request Cookie header pairs', () => {
    const parsed = parseCookies('Cookie: session=abc123; theme=dark; encoded=hello%20world; empty=');

    expect(parsed.requestCookies).toHaveLength(4);
    expect(parsed.responseCookies).toHaveLength(0);
    expect(parsed.json).toEqual({
      session: 'abc123',
      theme: 'dark',
      encoded: 'hello world',
      empty: '',
    });
  });

  it('parses Set-Cookie headers with attributes and security warnings', () => {
    const parsed = parseCookies(`Set-Cookie: session=abc123; Path=/; HttpOnly; Secure; SameSite=Lax
Set-Cookie: tracking=1; Path=/; SameSite=None`);

    expect(parsed.responseCookies).toHaveLength(2);
    expect(parsed.responseCookies[0]).toMatchObject({
      source: 'response',
      name: 'session',
      value: 'abc123',
      warnings: [],
    });
    expect(parsed.responseCookies[0]?.attributes).toEqual([
      { name: 'Path', value: '/' },
      { name: 'HttpOnly', value: true },
      { name: 'Secure', value: true },
      { name: 'SameSite', value: 'Lax' },
    ]);
    expect(parsed.responseCookies[1]?.warnings).toEqual([
      'Missing Secure attribute.',
      'Missing HttpOnly attribute.',
      'SameSite=None requires Secure.',
    ]);
  });

  it('accepts bare request and response cookie values', () => {
    expect(parseCookies('a=1; b=2').requestCookies.map(({ name }) => name)).toEqual(['a', 'b']);
    expect(parseCookies('session=abc; Path=/; Secure; HttpOnly').responseCookies).toHaveLength(1);
  });

  it('ignores status lines and unrelated headers', () => {
    const parsed = parseCookies(`HTTP/2 200
content-type: text/html
link: </app.css>; rel=preload
Set-Cookie: session=abc; Secure; HttpOnly; SameSite=Strict`);

    expect(parsed.cookies.map(({ name }) => name)).toEqual(['session']);
  });

  it('preserves duplicate names as arrays in JSON output', () => {
    const parsed = parseCookies(`Cookie: id=request
Set-Cookie: id=response; Secure; HttpOnly; SameSite=Strict`);

    expect(parsed.json).toEqual({
      id: ['request', 'response'],
    });
  });

  it('warns about invalid cookie prefix and partitioned attribute combinations', () => {
    const parsed = parseCookies(`Set-Cookie: __Secure-id=1; HttpOnly; SameSite=Lax
Set-Cookie: __Host-session=abc; Domain=example.com; Path=/app; HttpOnly; SameSite=Strict
Set-Cookie: partitioned=1; Partitioned; HttpOnly; SameSite=None`);

    expect(parsed.responseCookies[0]?.warnings).toEqual([
      'Missing Secure attribute.',
      '__Secure- cookies require Secure.',
    ]);
    expect(parsed.responseCookies[1]?.warnings).toEqual([
      'Missing Secure attribute.',
      '__Host- cookies require Secure.',
      '__Host- cookies must not include Domain.',
      '__Host- cookies require Path=/.',
    ]);
    expect(parsed.responseCookies[2]?.warnings).toEqual([
      'Missing Secure attribute.',
      'SameSite=None requires Secure.',
      'Partitioned cookies require Secure.',
    ]);
  });

  it('reports invalid names and malformed pairs', () => {
    expect(() => parseCookies('bad name=value')).toThrow('Invalid cookie name');
    expect(() => parseCookies('missing-value')).toThrow('missing a value');
  });
});
