import { describe, expect, it } from 'vitest';
import { buildTablePageFilterSql, buildTablePageSortSql } from './table-page-sql';

const columns = [
  { name: 'id', dataType: 'integer' },
  { name: 'username', dataType: 'text' },
  { name: 'nickname', dataType: 'text' },
];

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

describe('table page SQL builders', () => {
  it('builds parameterized PostgreSQL predicates and escapes LIKE patterns', () => {
    const result = buildTablePageFilterSql([
      { column: 'username', operator: 'contains', value: 'a%_\\b' },
      { column: 'nickname', operator: 'is-not-null', value: null },
    ], columns, 'postgres', 'row', quote);
    expect(result).toEqual({
      clauses: [
        `row."username"::text LIKE $1 ESCAPE '\\'`,
        'row."nickname" IS NOT NULL',
      ],
      values: ['%a\\%\\_\\\\b%'],
    });
  });

  it('uses null-safe equality for MySQL and SQLite', () => {
    expect(buildTablePageFilterSql([
      { column: 'id', operator: 'equals', value: '7' },
      { column: 'nickname', operator: 'not-equals', value: 'x' },
    ], columns, 'mysql', '`row`', value => `\`${value}\``)?.clauses).toEqual([
      '`row`.`id` <=> ?',
      'NOT (`row`.`nickname` <=> ?)',
    ]);
    expect(buildTablePageFilterSql([
      { column: 'id', operator: 'equals', value: '7' },
    ], columns, 'sqlite', 'row', quote)?.clauses).toEqual(['row."id" IS ?']);
  });

  it('checks metadata columns before generating SQL', () => {
    expect(buildTablePageFilterSql([
      { column: 'missing', operator: 'equals', value: 'x' },
    ], columns, 'sqlite', 'row', quote)).toBeNull();
    expect(buildTablePageSortSql([
      { column: 'username', direction: 'desc' },
    ], columns, 'sqlite', 'row', quote)).toBe('row."username" DESC');
    expect(buildTablePageSortSql([
      { column: 'missing', direction: 'asc' },
    ], columns, 'sqlite', 'row', quote)).toBeNull();
  });
});
