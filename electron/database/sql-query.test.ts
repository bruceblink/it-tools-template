import { describe, expect, it } from 'vitest';
import { normalizeReadOnlySelectQuery } from './sql-query';

describe('read-only SQL editor validation', () => {
  it('accepts a single SELECT and removes one final statement delimiter', () => {
    expect(normalizeReadOnlySelectQuery('  SELECT 1; -- comment\n', 'postgres')).toBe('SELECT 1');
    expect(normalizeReadOnlySelectQuery('SELECT 1 /* trailing comment */;', 'sqlite'))
      .toBe('SELECT 1 /* trailing comment */');
    expect(normalizeReadOnlySelectQuery('SELECT NULL::text', 'postgres')).toBe('SELECT NULL::text');
  });

  it('accepts a SELECT CTE and ignores keywords inside strings, quoted identifiers, and comments', () => {
    expect(normalizeReadOnlySelectQuery(
      'WITH records AS (SELECT \'UPDATE; DROP\' AS "delete") SELECT * FROM records',
      'postgres',
    )).toBe('WITH records AS (SELECT \'UPDATE; DROP\' AS "delete") SELECT * FROM records');
    expect(normalizeReadOnlySelectQuery('SELECT `update` FROM `records` -- delete\n', 'mysql'))
      .toBe('SELECT `update` FROM `records` -- delete');
    expect(normalizeReadOnlySelectQuery('SELECT [delete] FROM records', 'sqlite'))
      .toBe('SELECT [delete] FROM records');
    expect(normalizeReadOnlySelectQuery('SELECT $$delete; drop$$ AS value', 'postgres'))
      .toBe('SELECT $$delete; drop$$ AS value');
  });

  it('rejects writes, transaction commands, lock clauses, and attachment operations', () => {
    for (const [query, engine] of [
      ['UPDATE records SET value = 1', 'postgres'],
      ['WITH candidate AS (SELECT 1) DELETE FROM records', 'postgres'],
      ['SELECT * FROM records FOR UPDATE', 'postgres'],
      ['SELECT value INTO OUTFILE \'/tmp/out\' FROM records', 'mysql'],
      ['PRAGMA journal_mode = WAL', 'sqlite'],
      ['SELECT load_file(\'/etc/passwd\')', 'mysql'],
      ['SELECT pg_notify(\'channel\', \'message\')', 'postgres'],
      ['SELECT pg_advisory_unlock(1)', 'postgres'],
      ['SELECT load_extension(\'extension.so\')', 'sqlite'],
      ['ATTACH DATABASE \'other.sqlite\' AS other', 'sqlite'],
    ] as const) {
      expect(normalizeReadOnlySelectQuery(query, engine)).toBeNull();
    }
  });

  it('rejects multiple statements, parameters, malformed quoting, and oversized input', () => {
    expect(normalizeReadOnlySelectQuery('SELECT 1; DELETE FROM records', 'sqlite')).toBeNull();
    expect(normalizeReadOnlySelectQuery('SELECT $1', 'postgres')).toBeNull();
    expect(normalizeReadOnlySelectQuery('SELECT ?', 'mysql')).toBeNull();
    expect(normalizeReadOnlySelectQuery('SELECT \'unfinished', 'postgres')).toBeNull();
    expect(normalizeReadOnlySelectQuery(`SELECT '${'x'.repeat(16_384)}'`, 'sqlite')).toBeNull();
  });
});
