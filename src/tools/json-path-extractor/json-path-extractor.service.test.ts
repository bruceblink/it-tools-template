import { describe, expect, it } from 'vitest';
import { extractJsonPath, queryJsonPath, tokenizeJsonPath } from './json-path-extractor.service';

const sample = {
  users: [
    { name: 'Alice', active: true },
    { name: 'Bob', active: false },
  ],
  meta: {
    'request-id': 'abc-123',
  },
};

describe('json-path-extractor service', () => {
  it('tokenizes dot, bracket, wildcard, and index path segments', () => {
    expect(tokenizeJsonPath('$.users[0].name')).toEqual(['users', 0, 'name']);
    expect(tokenizeJsonPath('$["meta"]["request-id"]')).toEqual(['meta', 'request-id']);
    expect(tokenizeJsonPath('users[*].name')).toEqual(['users', '*', 'name']);
  });

  it('queries a nested value', () => {
    expect(queryJsonPath(sample, '$.users[0].name')).toEqual(['Alice']);
  });

  it('supports wildcard extraction', () => {
    expect(queryJsonPath(sample, '$.users[*].name')).toEqual(['Alice', 'Bob']);
  });

  it('supports negative array indexes', () => {
    expect(queryJsonPath(sample, '$.users[-1].name')).toEqual(['Bob']);
  });

  it('formats single and wildcard results as JSON', () => {
    expect(extractJsonPath(JSON.stringify(sample), '$.users[0]')).toMatchInlineSnapshot(`
      "{
        "name": "Alice",
        "active": true
      }"
    `);

    expect(extractJsonPath(JSON.stringify(sample), '$.users[*].name')).toMatchInlineSnapshot(`
      "[
        "Alice",
        "Bob"
      ]"
    `);
  });

  it('returns an empty string when the path does not match', () => {
    expect(extractJsonPath(JSON.stringify(sample), '$.users[9].name')).toBe('');
  });
});
