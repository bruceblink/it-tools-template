import { describe, expect, it } from 'vitest';
import { analyzeSecurityHeaders } from './security-headers-analyzer.service';

const secureHeaders = `HTTP/2 200
strict-transport-security: max-age=31536000; includeSubDomains
content-security-policy: default-src 'self'; object-src 'none'; frame-ancestors 'none'
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=()
cross-origin-opener-policy: same-origin
cross-origin-embedder-policy: require-corp
cross-origin-resource-policy: same-origin`;

describe('security-headers-analyzer service', () => {
  it('marks a hardened response as passing', () => {
    const analysis = analyzeSecurityHeaders(secureHeaders);

    expect(analysis).toMatchObject({
      passed: 11,
      warnings: 0,
      failed: 0,
      score: 100,
      grade: 'A',
      recommendedHeaders: '',
      headersToRemove: [],
    });
    expect(analysis.checks.every(({ status }) => status === 'pass')).toBe(true);
  });

  it('reports missing and disclosure headers as issues', () => {
    const analysis = analyzeSecurityHeaders(`HTTP/2 200
content-type: text/html
server: nginx/1.25
x-powered-by: Express`);

    expect(analysis.failed).toBe(3);
    expect(analysis.warnings).toBe(8);
    expect(analysis.score).toBe(36);
    expect(analysis.grade).toBe('F');
    expect(analysis.headersToRemove).toEqual(['Server', 'X-Powered-By']);
    expect(analysis.recommendedHeaders).toContain('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    expect(analysis.recommendedHeaders).toContain("Content-Security-Policy: default-src 'self'; object-src 'none'; frame-ancestors 'none'");
    expect(analysis.recommendedHeaders).toContain('X-Content-Type-Options: nosniff');
    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Strict-Transport-Security', status: 'fail' }),
      expect.objectContaining({ name: 'Content-Security-Policy', status: 'fail' }),
      expect.objectContaining({ name: 'X-Content-Type-Options', status: 'fail' }),
      expect.objectContaining({ name: 'Server', status: 'warning', value: 'nginx/1.25' }),
      expect.objectContaining({ name: 'X-Powered-By', status: 'warning', value: 'Express' }),
    ]));
  });

  it('accepts CSP frame-ancestors as clickjacking protection', () => {
    const analysis = analyzeSecurityHeaders(`HTTP/2 200
content-security-policy: default-src 'self'; frame-ancestors 'self'
x-content-type-options: nosniff`);

    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'X-Frame-Options', status: 'pass' }),
    ]));
  });

  it('warns about weak but present HSTS settings', () => {
    const analysis = analyzeSecurityHeaders(`HTTP/2 200
strict-transport-security: max-age=3600`);

    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Strict-Transport-Security', status: 'warning' }),
    ]));
  });

  it('checks cross-origin embedder policy values', () => {
    expect(analyzeSecurityHeaders(`HTTP/2 200
cross-origin-embedder-policy: require-corp`).checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Cross-Origin-Embedder-Policy', status: 'pass' }),
    ]));

    expect(analyzeSecurityHeaders(`HTTP/2 200
cross-origin-embedder-policy: invalid`).checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Cross-Origin-Embedder-Policy', status: 'fail' }),
    ]));
  });

  it('reuses HTTP header parsing errors for malformed input', () => {
    expect(() => analyzeSecurityHeaders('HTTP/2 200\nbad header')).toThrow('Invalid HTTP header line');
  });
});
