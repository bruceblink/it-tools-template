import type {
  DatabaseDataFilter,
  DatabaseDataFilterOperator,
  DatabaseDataSort,
  PostgresDataPageInput,
} from '../../src/shared/desktop-services/database';

export const MAX_DATA_FILTERS = 3;
export const MAX_DATA_SORTS = 3;
export const MAX_DATA_FILTER_VALUE_CHARACTERS = 256;

const FILTER_OPERATORS = new Set<DatabaseDataFilterOperator>([
  'equals',
  'not-equals',
  'contains',
  'starts-with',
  'ends-with',
  'is-null',
  'is-not-null',
]);

/** Validate generated page options before a database driver sees them. */
export function isValidTablePageRequest(
  value: unknown,
  isIdentifier: (value: unknown) => boolean,
  allowCursor: boolean,
): value is PostgresDataPageInput {
  if (!isRecord(value)
    || !hasAllowedKeys(value, ['cursor', 'offset'], ['filters', 'sort'])
    || !Number.isInteger(value.offset)
    || (value.offset as number) < 0
    || (value.offset as number) > 1_000_000
    || (value.offset as number) % 25 !== 0) {
    return false;
  }
  if (!allowCursor && value.cursor !== null) {
    return false;
  }
  if (value.cursor !== null
    && (typeof value.cursor !== 'string' || value.cursor.length === 0 || value.cursor.length > 4_096 || value.offset !== 0)) {
    return false;
  }

  const filters = value.filters ?? [];
  const sorts = value.sort ?? [];
  if (!isValidFilters(filters, isIdentifier) || !isValidSorts(sorts, isIdentifier)) {
    return false;
  }
  return (filters.length === 0 && sorts.length === 0) || value.cursor === null;
}

export function getPageFilters(page: PostgresDataPageInput): DatabaseDataFilter[] {
  return page.filters ?? [];
}

export function getPageSort(page: PostgresDataPageInput): DatabaseDataSort[] {
  return page.sort ?? [];
}

function isValidFilters(value: unknown, isIdentifier: (value: unknown) => boolean): value is DatabaseDataFilter[] {
  return Array.isArray(value)
    && value.length <= MAX_DATA_FILTERS
    && value.every(filter => isRecord(filter)
      && hasExactKeys(filter, ['column', 'operator', 'value'])
      && typeof filter.column === 'string'
      && isIdentifier(filter.column)
      && typeof filter.operator === 'string'
      && FILTER_OPERATORS.has(filter.operator as DatabaseDataFilterOperator)
      && isValidFilterValue(filter.operator as DatabaseDataFilterOperator, filter.value));
}

function isValidSorts(value: unknown, isIdentifier: (value: unknown) => boolean): value is DatabaseDataSort[] {
  if (!Array.isArray(value) || value.length > MAX_DATA_SORTS) {
    return false;
  }
  const columns = new Set<string>();
  return value.every(sort => isRecord(sort)
    && hasExactKeys(sort, ['column', 'direction'])
    && typeof sort.column === 'string'
    && isIdentifier(sort.column)
    && (sort.direction === 'asc' || sort.direction === 'desc')
    && !columns.has(sort.column)
    && Boolean(columns.add(sort.column)));
}

function isValidFilterValue(operator: DatabaseDataFilterOperator, value: unknown): boolean {
  if (operator === 'is-null' || operator === 'is-not-null') {
    return value === null;
  }
  return typeof value === 'string'
    && value.length <= MAX_DATA_FILTER_VALUE_CHARACTERS
    && !value.includes('\u0000');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasAllowedKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const keys = Object.keys(value);
  return required.every(key => keys.includes(key))
    && keys.every(key => required.includes(key) || optional.includes(key));
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
