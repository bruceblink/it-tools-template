import { describe, expect, it } from 'vitest';
import { parseUrlDetails } from './url-parser.service';

describe('url-parser service', () => {
  it('parses core URL parts and preserves repeated query parameters', () => {
    expect(parseUrlDetails('https://me:pwd@example.com:8443/path/to/page?q=one&q=two#top')).toMatchObject({
      protocol: 'https:',
      username: 'me',
      password: 'pwd',
      hostname: 'example.com',
      port: '8443',
      pathname: '/path/to/page',
      search: '?q=one&q=two',
      hash: '#top',
      origin: 'https://example.com:8443',
      parameters: [
        { key: 'q', value: 'one' },
        { key: 'q', value: 'two' },
      ],
      duplicateParameterNames: ['q'],
      summary: {
        pathSegments: 3,
        queryParameters: 2,
        uniqueParameterNames: 1,
        duplicateParameterNames: 1,
      },
      warnings: [
        'URL contains embedded credentials.',
        'Duplicate query parameters: q.',
      ],
    });
  });

  it('warns when a URL includes an explicit default port', () => {
    expect(parseUrlDetails('http://example.com:80/path').warnings).toEqual([
      'URL explicitly includes the default port for its protocol.',
    ]);
  });

  it('throws for invalid URLs', () => {
    expect(() => parseUrlDetails('not a url')).toThrow();
  });
});
