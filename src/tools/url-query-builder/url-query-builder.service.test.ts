import { describe, expect, it } from 'vitest';
import { buildQueryString, buildUrlWithQuery, parseQueryParameters } from './url-query-builder.service';

describe('url-query-builder service', () => {
  it('parses key-value lines', () => {
    expect(parseQueryParameters('q=it tools\npage=1\nempty=')).toEqual([
      { key: 'q', value: 'it tools' },
      { key: 'page', value: '1' },
      { key: 'empty', value: '' },
    ]);
  });

  it('parses raw query strings and full URLs', () => {
    expect(parseQueryParameters('?q=it+tools&page=1')).toEqual([
      { key: 'q', value: 'it tools' },
      { key: 'page', value: '1' },
    ]);

    expect(parseQueryParameters('https://example.com/search?q=it+tools&page=1#top')).toEqual([
      { key: 'q', value: 'it tools' },
      { key: 'page', value: '1' },
    ]);
  });

  it('parses JSON object parameters and repeats array values', () => {
    expect(parseQueryParameters('{"tag":["vue","vite"],"page":1,"empty":null}')).toEqual([
      { key: 'tag', value: 'vue' },
      { key: 'tag', value: 'vite' },
      { key: 'page', value: '1' },
      { key: 'empty', value: '' },
    ]);
  });

  it('builds sorted encoded query strings', () => {
    expect(buildQueryString('b=two words\na=1\nempty=', { sortKeys: true, includeEmptyValues: false }))
      .toBe('a=1&b=two+words');
  });

  it('appends query parameters before URL hashes', () => {
    expect(buildUrlWithQuery('https://example.com/search#top', 'q=it tools&page=1'))
      .toBe('https://example.com/search?q=it+tools&page=1#top');
  });
});
