import type { DatabaseCellUpdateInput, DatabaseEngine } from '../../src/shared/desktop-services/database';

export const MAX_CELL_EDIT_CHARACTERS = 4_096;
export const MAX_CELL_EDIT_PRIMARY_KEYS = 32;

export function isValidCellUpdateInput(
  value: unknown,
  engine: DatabaseEngine,
): value is DatabaseCellUpdateInput {
  if (!isRecord(value)
    || !hasExactKeys(value, ['schema', 'table', 'column', 'primaryKeys', 'originalValue', 'newValue'])
    || !isIdentifier(value.schema, engine)
    || !isIdentifier(value.table, engine)
    || !isIdentifier(value.column, engine)
    || !Array.isArray(value.primaryKeys)
    || value.primaryKeys.length === 0
    || value.primaryKeys.length > MAX_CELL_EDIT_PRIMARY_KEYS
    || !value.primaryKeys.every(key => isValidPrimaryKey(key, engine))
    || new Set(value.primaryKeys.map(key => (key as { column: string }).column)).size !== value.primaryKeys.length
    || !isCellValue(value.originalValue)
    || !isCellValue(value.newValue)) {
    return false;
  }
  return true;
}

export function isEditableDatabaseColumnType(engine: DatabaseEngine, type: string): boolean {
  const normalized = type.toLowerCase();
  if (engine === 'postgres') {
    return /^(?:smallint|integer|bigint|numeric|decimal|real|double precision|boolean|character varying|character|text|date|time(?: without time zone| with time zone)?|timestamp(?: without time zone| with time zone)?|uuid|json|jsonb|user-defined)$/.test(normalized);
  }
  if (engine === 'mysql') {
    return /^(?:tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|bool|boolean|char|varchar|tinytext|text|mediumtext|longtext|date|datetime|timestamp|time|year|json|enum|set)(?:\b|\()/.test(normalized);
  }
  return !/(?:blob|binary|varbinary)/.test(normalized);
}

function isValidPrimaryKey(value: unknown, engine: DatabaseEngine): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['column', 'value'])
    && isIdentifier(value.column, engine)
    && typeof value.value === 'string'
    && value.value.length <= MAX_CELL_EDIT_CHARACTERS
    && !value.value.includes('\u0000');
}

function isCellValue(value: unknown): value is string | null {
  return value === null
    || (typeof value === 'string' && value.length <= MAX_CELL_EDIT_CHARACTERS && !value.includes('\u0000'));
}

function isIdentifier(value: unknown, engine: DatabaseEngine): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= (engine === 'mysql' ? 64 : engine === 'sqlite' ? 256 : 63)
    && !value.includes('\u0000');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
