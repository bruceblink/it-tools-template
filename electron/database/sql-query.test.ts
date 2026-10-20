import { describe, expect, it } from 'vitest';
import { normalizeDatabaseStatement, normalizeReadOnlySelectQuery, parseEditableSelectTarget } from './sql-query';

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
      ['SELECT "pg_read_file"(\'/etc/passwd\')', 'postgres'],
      ['ATTACH DATABASE \'other.sqlite\' AS other', 'sqlite'],
    ] as const) {
      expect(normalizeReadOnlySelectQuery(query, engine)).toBeNull();
    }
  });

  it('accepts single INSERT, UPDATE, and DELETE statements for each supported engine', () => {
    for (const engine of ['postgres', 'mysql', 'sqlite'] as const) {
      expect(normalizeDatabaseStatement('INSERT INTO records (value) VALUES (\'new\');', engine))
        .toEqual({ kind: 'insert', sql: "INSERT INTO records (value) VALUES ('new')" });
      expect(normalizeDatabaseStatement('UPDATE records SET value = \'changed\' WHERE id = 1', engine))
        .toEqual({ kind: 'update', sql: "UPDATE records SET value = 'changed' WHERE id = 1" });
      expect(normalizeDatabaseStatement('DELETE FROM records WHERE id = 1', engine))
        .toEqual({ kind: 'delete', sql: 'DELETE FROM records WHERE id = 1' });
    }
    expect(normalizeDatabaseStatement('INSERT INTO records(value) VALUES (1) ON CONFLICT (value) DO UPDATE SET value = 2', 'postgres')?.kind)
      .toBe('insert');
  });

  it('rejects mutation output, hidden DML in read queries, and database-definition statements', () => {
    for (const [query, engine] of [
      ['DELETE FROM records RETURNING *', 'postgres'],
      ['INSERT INTO records(value) VALUES (1) RETURNING id', 'sqlite'],
      ['WITH changed AS (DELETE FROM records RETURNING id) SELECT * FROM changed', 'postgres'],
      ['SELECT value INTO archive FROM records', 'mysql'],
      ['DROP TABLE records', 'sqlite'],
      ['UPDATE records SET value = 1; DELETE FROM records', 'postgres'],
    ] as const) {
      expect(normalizeDatabaseStatement(query, engine)).toBeNull();
    }
  });

  it('rejects multiple statements, parameters, malformed quoting, and oversized input', () => {
    expect(normalizeReadOnlySelectQuery('SELECT 1; DELETE FROM records', 'sqlite')).toBeNull();
    expect(normalizeReadOnlySelectQuery('SELECT $1', 'postgres')).toBeNull();
    expect(normalizeReadOnlySelectQuery('SELECT ?', 'mysql')).toBeNull();
    expect(normalizeReadOnlySelectQuery('SELECT \'unfinished', 'postgres')).toBeNull();
    expect(normalizeReadOnlySelectQuery(`SELECT '${'x'.repeat(16_384)}'`, 'sqlite')).toBeNull();
  });

  it('recognizes only direct single-table projections as editable query results', () => {
    expect(parseEditableSelectTarget('SELECT id, value FROM public.records WHERE id > 1 ORDER BY id', 'postgres'))
      .toEqual({ schema: 'public', table: 'records', columns: ['id', 'value'] });
    expect(parseEditableSelectTarget('SELECT * FROM `app`.`records`', 'mysql'))
      .toEqual({ schema: 'app', table: 'records', columns: ['*'] });
    expect(parseEditableSelectTarget('SELECT "id", "value" FROM "main"."records"', 'sqlite'))
      .toEqual({ schema: 'main', table: 'records', columns: ['id', 'value'] });
    for (const [query, engine] of [
      ['SELECT count(*) FROM records', 'postgres'],
      ['SELECT id AS key FROM records', 'postgres'],
      ['SELECT a.id FROM records a', 'postgres'],
      ['SELECT id FROM records JOIN other USING (id)', 'mysql'],
      ['WITH selected AS (SELECT id FROM records) SELECT id FROM selected', 'sqlite'],
      ['SELECT id, id FROM records', 'postgres'],
    ] as const) {
      expect(parseEditableSelectTarget(query, engine)).toBeNull();
    }
  });
});
