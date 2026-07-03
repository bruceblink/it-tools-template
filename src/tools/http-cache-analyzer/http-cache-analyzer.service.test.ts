import { describe, expect, it } from 'vitest';
import { analyzeHttpCache } from './http-cache-analyzer.service';

describe('http-cache-analyzer service', () => {
  const now = new Date('2026-07-04T00:00:00.000Z');

  it('analyzes a cacheable immutable asset response', () => {
    const analysis = analyzeHttpCache(`HTTP/2 200
cache-control: public, max-age=31536000, stale-while-revalidate=86400, stale-if-error=604800, immutable
age: 86400
etag: "asset-v1"
vary: Accept-Encoding`);

    expect(analysis).toMatchObject({
      cacheControl: 'public, max-age=31536000, stale-while-revalidate=86400, stale-if-error=604800, immutable',
      freshness: '365 days',
      expiresAt: '',
      sharedFreshness: 'Not specified',
      responseAge: '1 day',
      remainingFreshness: '364 days',
      staleWhileRevalidate: '1 day',
      staleIfError: '7 days',
      freshnessState: 'fresh',
      cacheability: 'cacheable',
      validators: ['ETag'],
      vary: ['Accept-Encoding'],
      warnings: [],
    });
    expect(analysis.directives).toEqual([
      { name: 'public', value: true },
      { name: 'max-age', value: '31536000' },
      { name: 'stale-while-revalidate', value: '86400' },
      { name: 'stale-if-error', value: '604800' },
      { name: 'immutable', value: true },
    ]);
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Current age',
        status: 'pass',
        summary: 'Response age is 1 day with 364 days remaining.',
      }),
      expect.objectContaining({
        name: 'Stale reuse',
        status: 'pass',
      }),
    ]));
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

  it('uses Date and Expires to estimate freshness without Cache-Control', () => {
    const analysis = analyzeHttpCache(`HTTP/2 200
date: Sat, 04 Jul 2026 00:00:00 GMT
expires: Sat, 04 Jul 2026 00:05:00 GMT
last-modified: Sat, 04 Jul 2026 00:00:00 GMT`, {
      now: new Date('2026-07-04T00:02:00.000Z'),
    });

    expect(analysis).toMatchObject({
      expiresAt: '2026-07-04T00:05:00.000Z',
      freshness: '5 minutes',
      responseAge: '2 minutes',
      remainingFreshness: '3 minutes',
      freshnessState: 'fresh',
      cacheability: 'cacheable',
      validators: ['Last-Modified'],
    });
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Freshness lifetime',
        status: 'warning',
        summary: 'Freshness relies on Expires only: 5 minutes.',
      }),
      expect.objectContaining({
        name: 'Current age',
        status: 'pass',
        summary: 'Response age is 2 minutes with 3 minutes remaining.',
      }),
    ]));
  });

  it('fails invalid Expires freshness values', () => {
    const analysis = analyzeHttpCache(`HTTP/2 200
expires: invalid-date`, { now });

    expect(analysis.expiresAt).toBe('');
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Freshness lifetime',
        status: 'fail',
        summary: 'Expires is not a valid HTTP date.',
      }),
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

  it('detects stale cached responses from Age and freshness lifetime', () => {
    const analysis = analyzeHttpCache(`HTTP/2 200
cache-control: public, max-age=60
age: 120`);

    expect(analysis).toMatchObject({
      responseAge: '2 minutes',
      remainingFreshness: '0 seconds',
      freshnessState: 'stale',
    });
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Current age',
        status: 'warning',
        summary: 'Response age is 2 minutes, which is beyond its freshness lifetime.',
      }),
    ]));
  });

  it('detects invalid stale reuse lifetimes', () => {
    const analysis = analyzeHttpCache(`HTTP/2 200
cache-control: public, max-age=60, stale-while-revalidate=later`);

    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Stale reuse',
        status: 'fail',
        summary: 'stale-while-revalidate or stale-if-error is not a valid non-negative number of seconds.',
      }),
    ]));
  });

  it('reuses HTTP header parser errors for malformed input', () => {
    expect(() => analyzeHttpCache('HTTP/2 200\nbad header')).toThrow('Invalid HTTP header line');
  });
});
