import { describe, expect, it } from 'vitest';
import { isValidTablePageRequest } from './table-page-options';

const isIdentifier = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

describe('table page option validation', () => {
  it('accepts bounded filters and sorts without a cursor', () => {
    expect(isValidTablePageRequest({
      cursor: null,
      offset: 0,
      filters: [
        { column: 'username', operator: 'contains', value: 'sqlite' },
        { column: 'nickname', operator: 'is-null', value: null },
      ],
      sort: [{ column: 'id', direction: 'desc' }],
    }, isIdentifier, false)).toBe(true);
  });

  it('rejects cursors, unknown fields, duplicate sorts and oversized values', () => {
    const valid = { cursor: null, offset: 0, filters: [{ column: 'id', operator: 'equals', value: '1' }] };
    expect(isValidTablePageRequest({ ...valid, cursor: '{"id":1}' }, isIdentifier, false)).toBe(false);
    expect(isValidTablePageRequest({ ...valid, unexpected: true }, isIdentifier, false)).toBe(false);
    expect(isValidTablePageRequest({
      cursor: null,
      offset: 0,
      sort: [{ column: 'id', direction: 'asc' }, { column: 'id', direction: 'desc' }],
    }, isIdentifier, false)).toBe(false);
    expect(isValidTablePageRequest({
      ...valid,
      filters: [{ column: 'id', operator: 'equals', value: 'x'.repeat(257) }],
    }, isIdentifier, false)).toBe(false);
  });

  it('accepts a keyset cursor only for an unfiltered page', () => {
    expect(isValidTablePageRequest({ cursor: '{"id":1}', offset: 0 }, isIdentifier, true)).toBe(true);
    expect(isValidTablePageRequest({
      cursor: '{"id":1}',
      offset: 0,
      sort: [{ column: 'id', direction: 'asc' }],
    }, isIdentifier, true)).toBe(false);
  });
});
