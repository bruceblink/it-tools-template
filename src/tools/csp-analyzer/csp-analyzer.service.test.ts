import { describe, expect, it } from 'vitest';
import { analyzeCsp, parseCsp } from './csp-analyzer.service';

const strongPolicy = [
  "default-src 'self'",
  "script-src 'nonce-abc123' 'strict-dynamic'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
  'report-to csp-endpoint',
].join('; ');

describe('csp-analyzer service', () => {
  it('parses a CSP header value and strips the header name', () => {
    expect(parseCsp(`Content-Security-Policy: ${strongPolicy}`)).toEqual([
      { name: 'default-src', values: ["'self'"] },
      { name: 'script-src', values: ["'nonce-abc123'", "'strict-dynamic'"] },
      { name: 'object-src', values: ["'none'"] },
      { name: 'frame-ancestors', values: ["'none'"] },
      { name: 'base-uri', values: ["'self'"] },
      { name: 'form-action', values: ["'self'"] },
      { name: 'upgrade-insecure-requests', values: [] },
      { name: 'report-to', values: ['csp-endpoint'] },
    ]);
  });

  it('scores a restrictive policy highly', () => {
    const analysis = analyzeCsp(strongPolicy);

    expect(analysis.grade).toBe('A');
    expect(analysis.failed).toBe(0);
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'default-src', status: 'pass' }),
      expect.objectContaining({ name: 'strict-dynamic', status: 'pass' }),
      expect.objectContaining({ name: 'object-src', status: 'pass' }),
      expect.objectContaining({ name: 'frame-ancestors', status: 'pass' }),
      expect.objectContaining({ name: 'form-action', status: 'pass' }),
    ]));
  });

  it('flags unsafe script execution, object loading, wildcard sources, and HTTP sources', () => {
    const analysis = analyzeCsp("default-src * http:; script-src 'unsafe-inline' 'unsafe-eval'; object-src *; frame-ancestors *");

    expect(analysis.failed).toBeGreaterThan(0);
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'default-src', status: 'fail' }),
      expect.objectContaining({ name: 'script inline execution', status: 'fail' }),
      expect.objectContaining({ name: 'script eval execution', status: 'fail' }),
      expect.objectContaining({ name: 'object-src', status: 'fail' }),
      expect.objectContaining({ name: 'frame-ancestors', status: 'fail' }),
      expect.objectContaining({ name: 'plain HTTP sources', status: 'fail' }),
      expect.objectContaining({ name: 'wildcards', status: 'fail' }),
    ]));
  });

  it('warns when nonce based scripts do not use strict-dynamic', () => {
    const analysis = analyzeCsp("default-src 'self'; script-src 'nonce-abc123'; object-src 'none'; frame-ancestors 'self'");

    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'script inline execution', status: 'pass' }),
      expect.objectContaining({ name: 'strict-dynamic', status: 'warning' }),
    ]));
  });

  it('checks form-action submission targets', () => {
    expect(analyzeCsp("default-src 'self'; form-action *").checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'form-action', status: 'fail' }),
    ]));

    expect(analyzeCsp("default-src 'self'; form-action https://forms.example.com").checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'form-action', status: 'warning' }),
    ]));
  });

  it('detects unknown quoted keyword sources', () => {
    const analysis = analyzeCsp("default-src 'self'; script-src 'unsafeinline'");

    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'keyword sources', status: 'warning', value: "'unsafeinline'" }),
    ]));
  });

  it('rejects duplicate directives', () => {
    expect(() => parseCsp("default-src 'self'; default-src 'none'")).toThrow('Duplicate CSP directive: default-src');
  });

  it('returns a failing analysis for empty input', () => {
    expect(analyzeCsp('')).toMatchObject({
      failed: 1,
      checks: [
        expect.objectContaining({
          name: 'policy',
          status: 'fail',
        }),
      ],
    });
  });
});
