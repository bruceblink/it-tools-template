import { describe, expect, it } from 'vitest';
import { areValidQueryFieldNames, createBoundedQuerySql, createDatabaseQueryPage } from './query-results';

describe('bounded SQL query result contract', () => {
  it('builds a fixed projection and row bound for each supported engine', () => {
    const postgresSql = createBoundedQuerySql('postgres', 'SELECT value FROM records', ['value'], 25);
    expect(postgresSql).toContain('LEFT(CAST("__it_tools_query"."value" AS text), 257)');
    expect(postgresSql).toContain('LIMIT 26 OFFSET 25');

    const mysqlSql = createBoundedQuerySql('mysql', 'SELECT value FROM records', ['value'], 25);
    expect(mysqlSql).toContain('LEFT(CAST(`__it_tools_query`.`value` AS CHAR), 257)');
    expect(mysqlSql).toContain('AS `__it_tools_query`');

    const sqliteSql = createBoundedQuerySql('sqlite', 'SELECT value FROM records', ['value'], 25);
    expect(sqliteSql).toContain("typeof(\"__it_tools_query\".\"value\") = 'blob'");
    expect(sqliteSql).toContain('LIMIT 26 OFFSET 25');
  });

  it('keeps only bounded renderer rows, cells, and columns', () => {
    const columns = Array.from({ length: 18 }, (_, index) => `column_${index}`);
    const rawRows = Array.from({ length: 26 }, () => Array.from({ length: 36 }, (_, index) => index % 2 === 0 ? 'x'.repeat(257) : 1));
    const page = createDatabaseQueryPage(columns, rawRows, 25, Date.now() - 7);

    expect(page.columns).toHaveLength(16);
    expect(page.columnsTruncated).toBe(true);
    expect(page.rows).toHaveLength(25);
    expect(page.rows[0]?.cells).toHaveLength(16);
    expect(page.rows[0]?.cells[0]).toEqual({ value: 'x'.repeat(256), truncated: true });
    expect(page.hasNext).toBe(true);
    expect(page.nextOffset).toBe(50);
    expect(page.elapsedMilliseconds).toBeGreaterThanOrEqual(7);
  });

  it('rejects missing, oversized, or ambiguous result field names', () => {
    expect(areValidQueryFieldNames([], 'postgres')).toBe(false);
    expect(areValidQueryFieldNames(['name', 'name'], 'postgres')).toBe(false);
    expect(areValidQueryFieldNames(['Name', 'name'], 'mysql')).toBe(false);
    expect(areValidQueryFieldNames(['x'.repeat(257)], 'sqlite')).toBe(false);
    expect(areValidQueryFieldNames(['safe'], 'sqlite')).toBe(true);
  });
});
