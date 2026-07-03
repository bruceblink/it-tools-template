import { describe, expect, it } from 'vitest';
import { buildQueryString, buildUrlWithQuery, parseQueryParameters, summarizeQueryParameters } from './url-query-builder.service';

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
    expect(parseQueryParameters('{"tag":["vue","vite"],"page":1,"empty":null,"filter":{"status":"open"}}')).toEqual([
      { key: 'tag', value: 'vue' },
      { key: 'tag', value: 'vite' },
      { key: 'page', value: '1' },
      { key: 'empty', value: '' },
      { key: 'filter', value: '{"status":"open"}' },
    ]);
  });

  it('flattens nested JSON object parameters when requested', () => {
    expect(parseQueryParameters('{"filter":{"status":"open","labels":["bug","ui"]},"page":1}', { flattenNestedObjects: true })).toEqual([
      { key: 'filter[status]', value: 'open' },
      { key: 'filter[labels]', value: 'bug' },
      { key: 'filter[labels]', value: 'ui' },
      { key: 'page', value: '1' },
    ]);
  });

  it('builds sorted encoded query strings', () => {
    expect(buildQueryString('b=two words\na=1\nempty=', { sortKeys: true, includeEmptyValues: false }))
      .toBe('a=1&b=two+words');
  });

  it('builds encoded query strings from flattened nested JSON objects', () => {
    expect(buildQueryString('{"filter":{"status":"open"},"page":1}', { flattenNestedObjects: true, sortKeys: true }))
      .toBe('filter%5Bstatus%5D=open&page=1');
  });

  it('summarizes parsed query parameters', () => {
    expect(summarizeQueryParameters('tag=vue\ntag=vite\nempty=', { includeEmptyValues: false })).toEqual({
      totalParameters: 2,
      uniqueKeys: 1,
      duplicateKeys: ['tag'],
    });
  });

  it('appends query parameters before URL hashes', () => {
    expect(buildUrlWithQuery('https://example.com/search#top', 'q=it tools&page=1'))
      .toBe('https://example.com/search?q=it+tools&page=1#top');
  });
});
