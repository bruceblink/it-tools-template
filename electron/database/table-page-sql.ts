import type {
  DatabaseDataFilter,
  DatabaseDataSort,
} from '../../src/shared/desktop-services/database';

export type TablePageSqlDialect = 'postgres' | 'mysql' | 'sqlite';

export interface TablePageSqlColumn {
  name: string;
  dataType: string;
}

export interface TablePageFilterSql {
  clauses: string[];
  values: string[];
}

/** Build parameterized filter predicates after checking every column against table metadata. */
export function buildTablePageFilterSql(
  filters: DatabaseDataFilter[],
  columns: readonly TablePageSqlColumn[],
  dialect: TablePageSqlDialect,
  alias: string,
  quoteIdentifier: (value: string) => string,
  startParameterIndex = 1,
): TablePageFilterSql | null {
  const clauses: string[] = [];
  const values: string[] = [];
  let parameterIndex = startParameterIndex;
  for (const filter of filters) {
    const column = columns.find(item => dialect === 'mysql'
      ? item.name.toLowerCase() === filter.column.toLowerCase()
      : item.name === filter.column);
    if (!column) {
      return null;
    }
    const expression = `${alias}.${quoteIdentifier(column.name)}`;
    if (filter.operator === 'is-null') {
      clauses.push(`${expression} IS NULL`);
      continue;
    }
    if (filter.operator === 'is-not-null') {
      clauses.push(`${expression} IS NOT NULL`);
      continue;
    }

    const value = filter.value;
    if (value === null) {
      return null;
    }
    const placeholder = dialect === 'postgres' ? `$${parameterIndex}` : '?';
    parameterIndex += 1;
    if (filter.operator === 'equals') {
      clauses.push(dialect === 'postgres'
        ? `${expression} IS NOT DISTINCT FROM ${placeholder}`
        : dialect === 'mysql'
          ? `${expression} <=> ${placeholder}`
          : `${expression} IS ${placeholder}`);
      values.push(value);
      continue;
    }
    if (filter.operator === 'not-equals') {
      clauses.push(dialect === 'postgres'
        ? `${expression} IS DISTINCT FROM ${placeholder}`
        : dialect === 'mysql'
          ? `NOT (${expression} <=> ${placeholder})`
          : `${expression} IS NOT ${placeholder}`);
      values.push(value);
      continue;
    }

    const escaped = escapeLikePattern(value);
    const pattern = filter.operator === 'contains'
      ? `%${escaped}%`
      : filter.operator === 'starts-with'
        ? `${escaped}%`
        : `%${escaped}`;
    const textExpression = dialect === 'postgres'
      ? `${expression}::text`
      : dialect === 'mysql'
        ? `CAST(${expression} AS CHAR)`
        : `CAST(${expression} AS TEXT)`;
    clauses.push(`${textExpression} LIKE ${placeholder} ESCAPE '\\'`);
    values.push(pattern);
  }
  return { clauses, values };
}

/** Build a bounded ORDER BY list from metadata-backed columns and directions. */
export function buildTablePageSortSql(
  sorts: DatabaseDataSort[],
  columns: readonly TablePageSqlColumn[],
  dialect: TablePageSqlDialect,
  alias: string,
  quoteIdentifier: (value: string) => string,
): string | null {
  const expressions: string[] = [];
  for (const sort of sorts) {
    const column = columns.find(item => dialect === 'mysql'
      ? item.name.toLowerCase() === sort.column.toLowerCase()
      : item.name === sort.column);
    if (!column) {
      return null;
    }
    expressions.push(`${alias}.${quoteIdentifier(column.name)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`);
  }
  return expressions.length > 0 ? expressions.join(', ') : '';
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}
