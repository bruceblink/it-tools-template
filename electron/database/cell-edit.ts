import type {
  DatabaseBatchMutationInput,
  DatabaseCellUpdateInput,
  DatabaseEngine,
} from '../../src/shared/desktop-services/database';

export const MAX_CELL_EDIT_CHARACTERS = 4_096;
export const MAX_CELL_EDIT_PRIMARY_KEYS = 32;
export const MAX_BATCH_MUTATION_ROWS = 100;
export const MAX_BATCH_MUTATION_COLUMNS = 64;

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

/** Validate a small, parameterized batch before it crosses the renderer or worker boundary. */
export function isValidBatchMutationInput(
  value: unknown,
  engine: DatabaseEngine,
): value is DatabaseBatchMutationInput {
  if (!isRecord(value)
    || !hasExactKeys(value, ['schema', 'table', 'inserts', 'deletes'])
    || !isIdentifier(value.schema, engine)
    || !isIdentifier(value.table, engine)
    || !Array.isArray(value.inserts)
    || !Array.isArray(value.deletes)
    || value.inserts.length + value.deletes.length === 0
    || value.inserts.length + value.deletes.length > MAX_BATCH_MUTATION_ROWS
    || !value.inserts.every(row => isValidBatchInsertRow(row, engine))
    || !value.deletes.every(row => isValidBatchDeleteRow(row, engine))) {
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

function isValidBatchInsertRow(value: unknown, engine: DatabaseEngine): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, ['values'])
    || !Array.isArray(value.values)
    || value.values.length > MAX_BATCH_MUTATION_COLUMNS
    || !value.values.every(item => isValidBatchValue(item, engine))) {
    return false;
  }
  return new Set(value.values.map(item => (item as { column: string }).column)).size === value.values.length;
}

function isValidBatchDeleteRow(value: unknown, engine: DatabaseEngine): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, ['primaryKeys', 'originalValues'])
    || !Array.isArray(value.primaryKeys)
    || value.primaryKeys.length === 0
    || value.primaryKeys.length > MAX_CELL_EDIT_PRIMARY_KEYS
    || !value.primaryKeys.every(item => isValidPrimaryKey(item, engine))
    || new Set(value.primaryKeys.map(item => (item as { column: string }).column)).size !== value.primaryKeys.length
    || !Array.isArray(value.originalValues)
    || value.originalValues.length === 0
    || value.originalValues.length > MAX_BATCH_MUTATION_COLUMNS
    || !value.originalValues.every(item => isValidBatchValue(item, engine))) {
    return false;
  }
  return new Set(value.originalValues.map(item => (item as { column: string }).column)).size === value.originalValues.length;
}

function isValidBatchValue(value: unknown, engine: DatabaseEngine): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['column', 'value'])
    && isIdentifier(value.column, engine)
    && isCellValue(value.value);
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
