import { describe, expect, it } from 'vitest';
import { analyzeCors } from './cors-analyzer.service';

describe('cors-analyzer service', () => {
  it('passes a narrow non-credentialed CORS policy', () => {
    const analysis = analyzeCors(`HTTP/2 204
access-control-allow-origin: https://app.example.com
access-control-allow-methods: GET, POST
access-control-allow-headers: content-type
access-control-expose-headers: x-request-id
access-control-max-age: 3600
vary: Origin`);

    expect(analysis).toMatchObject({
      allowOrigin: 'https://app.example.com',
      allowCredentials: false,
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['content-type'],
      exposeHeaders: ['x-request-id'],
      maxAge: '1 hour',
      failed: 0,
      score: 100,
      grade: 'A',
    });
  });

  it('fails wildcard origins with credentials', () => {
    const analysis = analyzeCors(`HTTP/2 200
access-control-allow-origin: *
access-control-allow-credentials: true`);

    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Credentials',
        status: 'fail',
        summary: 'Wildcard origins cannot be used with credentials.',
      }),
    ]));
    expect(analysis).toMatchObject({
      passed: 2,
      warnings: 4,
      failed: 1,
      score: 57,
    });
    expect(analysis.grade).toBe('D');
  });

  it('warns when specific origins do not vary on Origin', () => {
    const analysis = analyzeCors(`HTTP/2 200
access-control-allow-origin: https://app.example.com
access-control-allow-methods: GET
vary: Accept-Encoding`);

    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Vary origin',
        status: 'warning',
      }),
    ]));
  });

  it('warns about broad methods and invalid max age', () => {
    const analysis = analyzeCors(`HTTP/2 204
access-control-allow-origin: https://app.example.com
access-control-allow-methods: GET, DELETE
access-control-allow-headers: *
access-control-max-age: soon
vary: Origin`);

    expect(analysis.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Allowed methods', status: 'warning' }),
      expect.objectContaining({ name: 'Allowed headers', status: 'warning' }),
      expect.objectContaining({ name: 'Preflight cache', status: 'fail' }),
    ]));
  });

  it('reuses HTTP header parser errors for malformed input', () => {
    expect(() => analyzeCors('HTTP/2 200\nbad header')).toThrow('Invalid HTTP header line');
  });
});
