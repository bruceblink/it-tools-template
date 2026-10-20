import type {
  DatabaseEngine,
  DatabaseQueryPage,
  PostgresDataCell,
} from '../../src/shared/desktop-services/database';

export const MAX_QUERY_COLUMNS = 16;
export const MAX_QUERY_ROWS = 25;
export const MAX_QUERY_CELL_CHARACTERS = 256;
export const MAX_QUERY_OFFSET = 1_000_000;
export const MAX_QUERY_FIELDS = 256;

/** Build an outer projection that bounds each value before a database driver receives it. */
export function createBoundedQuerySql(
  engine: DatabaseEngine,
  query: string,
  columnNames: readonly string[],
  offset: number,
): string {
  const visibleNames = columnNames.slice(0, MAX_QUERY_COLUMNS);
  const expressions = visibleNames.flatMap((name, index) => {
    const column = `${quoteIdentifier('__it_tools_query', engine)}.${quoteIdentifier(name, engine)}`;
    const valueAlias = quoteIdentifier(`__it_value_${index}`, engine);
    const truncatedAlias = quoteIdentifier(`__it_truncated_${index}`, engine);
    if (engine === 'sqlite') {
      const value = `CASE WHEN typeof(${column}) = 'blob' THEN '0x' || hex(substr(${column}, 1, ${MAX_QUERY_CELL_CHARACTERS / 2})) ELSE substr(CAST(${column} AS TEXT), 1, ${MAX_QUERY_CELL_CHARACTERS + 1}) END`;
      const truncated = `CASE WHEN ${column} IS NULL THEN 0 WHEN typeof(${column}) = 'blob' THEN length(${column}) > ${MAX_QUERY_CELL_CHARACTERS / 2} ELSE length(CAST(${column} AS TEXT)) > ${MAX_QUERY_CELL_CHARACTERS} END`;
      return [`${value} AS ${valueAlias}`, `${truncated} AS ${truncatedAlias}`];
    }
    const castType = engine === 'mysql' ? 'CHAR' : 'text';
    const lengthFunction = engine === 'mysql' ? 'CHAR_LENGTH' : 'char_length';
    const cast = `CAST(${column} AS ${castType})`;
    const value = `LEFT(${cast}, ${MAX_QUERY_CELL_CHARACTERS + 1})`;
    const truncated = `${lengthFunction}(${cast}) > ${MAX_QUERY_CELL_CHARACTERS}`;
    return [`${value} AS ${valueAlias}`, `${truncated} AS ${truncatedAlias}`];
  });
  return `SELECT ${expressions.join(', ')}\nFROM (\n${query}\n) AS ${quoteIdentifier('__it_tools_query', engine)}\nLIMIT ${MAX_QUERY_ROWS + 1} OFFSET ${offset}`;
}

/** Convert the bounded driver rows into a stable renderer shape and page summary. */
export function createDatabaseQueryPage(
  fieldNames: readonly string[],
  rawRows: readonly (readonly unknown[])[],
  offset: number,
  startedAtMilliseconds: number,
): DatabaseQueryPage {
  const visibleColumns = fieldNames.slice(0, MAX_QUERY_COLUMNS);
  const rows = rawRows.slice(0, MAX_QUERY_ROWS).map((rawRow) => ({
    cells: visibleColumns.map((_, index) => ({
      value: normalizeCell(rawRow[index * 2]),
      truncated: rawRow[index * 2 + 1] === true || rawRow[index * 2 + 1] === 1,
    } satisfies PostgresDataCell)),
  }));
  const hasMoreRows = rawRows.length > MAX_QUERY_ROWS;
  const nextOffset = hasMoreRows && offset + rows.length <= MAX_QUERY_OFFSET ? offset + rows.length : null;
  return {
    columns: visibleColumns.map(name => ({ name, dataType: 'text' })),
    rows,
    columnsTruncated: fieldNames.length > MAX_QUERY_COLUMNS,
    hasNext: nextOffset !== null,
    nextOffset,
    limitReached: hasMoreRows && nextOffset === null,
    elapsedMilliseconds: Math.max(0, Date.now() - startedAtMilliseconds),
  };
}

/** Keep user query names as data and escape them only when constructing the bounded outer projection. */
export function areValidQueryFieldNames(fieldNames: readonly string[], engine: DatabaseEngine): boolean {
  if (fieldNames.length === 0 || fieldNames.length > MAX_QUERY_FIELDS) {
    return false;
  }
  const seen = new Set<string>();
  for (const name of fieldNames) {
    const key = engine === 'mysql' ? name.toLowerCase() : name;
    if (name.length === 0 || name.length > 256 || name.includes('\u0000') || seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
}

function quoteIdentifier(value: string, engine: DatabaseEngine): string {
  if (engine === 'mysql') {
    return `\`${value.replaceAll('`', '``')}\``;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeCell(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return `0x${value.toString('hex').slice(0, MAX_QUERY_CELL_CHARACTERS)}`;
  }
  if (value instanceof Uint8Array) {
    return `0x${Buffer.from(value).toString('hex').slice(0, MAX_QUERY_CELL_CHARACTERS)}`;
  }
  const text = String(value);
  return text.length > MAX_QUERY_CELL_CHARACTERS ? text.slice(0, MAX_QUERY_CELL_CHARACTERS) : text;
}
