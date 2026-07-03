import { describe, expect, it } from 'vitest';
import { analyzeHttpCache } from './http-cache-analyzer.service';

describe('http-cache-analyzer service', () => {
  it('analyzes a cacheable immutable asset response', () => {
    const analysis = analyzeHttpCache(`HTTP/2 200
cache-control: public, max-age=31536000, immutable
etag: "asset-v1"
vary: Accept-Encoding`);

    expect(analysis).toMatchObject({
      cacheControl: 'public, max-age=31536000, immutable',
      freshness: '365 days',
      sharedFreshness: 'Not specified',
      cacheability: 'cacheable',
      validators: ['ETag'],
      vary: ['Accept-Encoding'],
      warnings: [],
    });
    expect(analysis.directives).toEqual([
      { name: 'public', value: true },
      { name: 'max-age', value: '31536000' },
      { name: 'immutable', value: true },
    ]);
  });

  it('marks sensitive no-store responses as not cacheable', () => {
    const analysis = analyzeHttpCache(`HTTP/2 200
cache-control: no-store, max-age=0
authorization: Bearer token`);

    expect(analysis.cacheability).toBe('not-cacheable');
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Storage policy', status: 'pass' }),
      expect.objectContaining({ name: 'Authorization response', status: 'pass' }),
    ]));
  });

  it('detects missing cache policy and validator warnings', () => {
    const analysis = analyzeHttpCache(`HTTP/2 200
content-type: application/json`);

    expect(analysis.cacheability).toBe('unknown');
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Cache-Control', status: 'fail' }),
      expect.objectContaining({ name: 'Freshness lifetime', status: 'fail' }),
      expect.objectContaining({ name: 'Validators', status: 'warning' }),
    ]));
  });

  it('detects conflicting directives and Vary wildcard', () => {
    const analysis = analyzeHttpCache(`HTTP/2 200
cache-control: public, private, max-age=120
vary: *`);

    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Directive conflict', status: 'fail' }),
      expect.objectContaining({ name: 'Vary', status: 'fail' }),
    ]));
  });

  it('detects invalid freshness lifetimes', () => {
    const analysis = analyzeHttpCache(`HTTP/2 200
cache-control: public, max-age=soon`);

    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Freshness lifetime',
        status: 'fail',
        summary: 'max-age or s-maxage is not a valid non-negative number of seconds.',
      }),
    ]));
  });

  it('reuses HTTP header parser errors for malformed input', () => {
    expect(() => analyzeHttpCache('HTTP/2 200\nbad header')).toThrow('Invalid HTTP header line');
  });
});
