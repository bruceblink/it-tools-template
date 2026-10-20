import type { DatabaseEngine, DatabaseMutationKind } from './database';

const MAX_QUERY_CHARACTERS = 16_384;
const FORBIDDEN_WORDS = new Set([
  'ALTER', 'ANALYZE', 'ATTACH', 'BEGIN', 'CALL', 'COMMIT', 'COPY', 'CREATE', 'DETACH', 'DROP', 'EXECUTE',
  'GRANT', 'LOAD', 'LOCK', 'MERGE', 'PRAGMA', 'REFRESH', 'RELEASE', 'RENAME', 'RESET', 'REVOKE', 'ROLLBACK',
  'SAVEPOINT', 'SHOW', 'TRUNCATE', 'VACUUM', 'REPLACE', 'RETURNING', 'OUTPUT',
]);
const FORBIDDEN_FUNCTIONS = new Set([
  'BENCHMARK', 'DBLINK_CONNECT', 'DBLINK_EXEC', 'GET_LOCK', 'LOAD_EXTENSION', 'LOAD_FILE', 'LO_EXPORT', 'LO_IMPORT',
  'MASTER_POS_WAIT', 'NEXTVAL', 'PG_ADVISORY_LOCK', 'PG_ADVISORY_LOCK_SHARED', 'PG_ADVISORY_UNLOCK',
  'PG_ADVISORY_UNLOCK_SHARED', 'PG_ADVISORY_XACT_LOCK', 'PG_ADVISORY_XACT_LOCK_SHARED', 'PG_CANCEL_BACKEND',
  'PG_LOGFILE_ROTATE', 'PG_NOTIFY', 'PG_READ_BINARY_FILE', 'PG_READ_FILE', 'PG_REPLICATION_ORIGIN_ADVANCE',
  'PG_TERMINATE_BACKEND', 'PG_TRY_ADVISORY_LOCK', 'PG_TRY_ADVISORY_LOCK_SHARED', 'PG_TRY_ADVISORY_XACT_LOCK',
  'PG_TRY_ADVISORY_XACT_LOCK_SHARED', 'READFILE', 'RELEASE_LOCK', 'SET_CONFIG', 'SETVAL', 'SLEEP',
  'WAIT_FOR_EXECUTED_GTID_SET', 'WRITEFILE',
]);
const STATEMENT_WORDS = new Set([
  'ALTER', 'ANALYZE', 'BEGIN', 'CALL', 'COMMIT', 'COPY', 'CREATE', 'DELETE', 'DROP', 'EXECUTE', 'INSERT', 'MERGE',
  'REPLACE', 'ROLLBACK', 'SELECT', 'TRUNCATE', 'UPDATE', 'VACUUM',
]);
const MUTATION_WORDS = new Set(['DELETE', 'INSERT', 'UPDATE']);

export type NormalizedDatabaseStatement =
  | { kind: 'select'; sql: string }
  | { kind: DatabaseMutationKind; sql: string };

export interface EditableSelectTarget {
  schema: string | null;
  table: string;
  columns: string[];
}

/** Recognize only direct projections from a single named table. */
export function parseEditableSelectTarget(sql: string, engine: DatabaseEngine): EditableSelectTarget | null {
  const identifier = engine === 'mysql'
    ? '(?:`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_$]*)'
    : engine === 'sqlite'
      ? '(?:"(?:""|[^"])+"|\\[(?:\\]\\]|[^\\]])+\\]|[A-Za-z_][A-Za-z0-9_$]*)'
      : '(?:"(?:""|[^"])+"|[A-Za-z_][A-Za-z0-9_$]*)';
  const projection = `(\\*|${identifier}(?:\\s*,\\s*${identifier})*)`;
  const relation = `(${identifier}(?:\\s*\\.\\s*${identifier})?)`;
  const match = sql.trim().match(new RegExp(`^SELECT\\s+${projection}\\s+FROM\\s+${relation}(?=\\s|$)(?:\\s+(?:WHERE|ORDER\\s+BY|LIMIT)\\b[\\s\\S]*)?$`, 'i'));
  if (!match) {
    return null;
  }
  const columns = match[1] === '*'
    ? ['*']
    : match[1]!.split(',').map(part => normalizeSqlIdentifier(part.trim(), engine));
  const parts = match[2]!.split('.').map(part => normalizeSqlIdentifier(part.trim(), engine));
  if (columns.some(column => !column) || parts.some(part => !part) || new Set(columns).size !== columns.length) {
    return null;
  }
  return {
    schema: parts.length === 2 ? parts[0]! : null,
    table: parts.at(-1)!,
    columns,
  };
}

/** Accept one bounded SELECT or DML statement while rejecting transaction, schema, file, and lock operations. */
export function normalizeDatabaseStatement(value: unknown, engine: DatabaseEngine): NormalizedDatabaseStatement | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_QUERY_CHARACTERS || value.includes('\u0000')) {
    return null;
  }
  const sql = value.trim();
  if (sql.length === 0) {
    return null;
  }

  const allWords: string[] = [];
  const topLevelWords: string[] = [];
  let depth = 0;
  let blockDepth = 0;
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line-comment' | 'block-comment' = 'normal';
  let seenSemicolon = false;
  let semicolonIndex = -1;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    const next = sql[index + 1];

    if (state === 'line-comment') {
      if (character === '\n' || character === '\r') {
        state = 'normal';
      }
      continue;
    }
    if (state === 'block-comment') {
      if (character === '/' && next === '*') {
        if (engine !== 'postgres') {
          return null;
        }
        blockDepth += 1;
        index += 1;
      }
      else if (character === '*' && next === '/') {
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) {
          state = 'normal';
        }
      }
      continue;
    }
    if (state !== 'normal') {
      const closingCharacter = state === 'single' ? '\''
        : state === 'double' ? '"'
          : state === 'backtick' ? '`'
            : ']';
      if (character === '\\') {
        return null;
      }
      if (character === closingCharacter) {
        if (next === closingCharacter) {
          index += 1;
        }
        else {
          if (state !== 'single' && FORBIDDEN_FUNCTIONS.has(readQuotedIdentifier(sql, index, closingCharacter))) {
            return null;
          }
          state = 'normal';
        }
      }
      continue;
    }

    if (seenSemicolon) {
      if (/\s/.test(character)) {
        continue;
      }
      if (character === '-' && next === '-' && (engine !== 'mysql' || isSqlWhitespace(sql[index + 2]))) {
        state = 'line-comment';
        index += 1;
        continue;
      }
      if (character === '/' && next === '*') {
        if (engine === 'mysql' && sql[index + 2] === '!') {
          return null;
        }
        state = 'block-comment';
        blockDepth = 1;
        index += 1;
        continue;
      }
      if (engine === 'mysql' && character === '#') {
        state = 'line-comment';
        continue;
      }
      return null;
    }

    if (character === '-' && next === '-' && (engine !== 'mysql' || isSqlWhitespace(sql[index + 2]))) {
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      if (engine === 'mysql' && sql[index + 2] === '!') {
        return null;
      }
      state = 'block-comment';
      blockDepth = 1;
      index += 1;
      continue;
    }
    if (engine === 'mysql' && character === '#') {
      state = 'line-comment';
      continue;
    }
    if (character === '\'') {
      state = 'single';
      continue;
    }
    if (character === '"') {
      state = 'double';
      continue;
    }
    if (engine === 'mysql' && character === '`') {
      state = 'backtick';
      continue;
    }
    if (engine === 'sqlite' && character === '[') {
      state = 'bracket';
      continue;
    }
    if (engine === 'postgres' && character === '$') {
      const quoteMatch = sql.slice(index).match(/^\$[a-zA-Z_][a-zA-Z0-9_]*\$|^\$\$/);
      if (quoteMatch) {
        const delimiter = quoteMatch[0];
        const endIndex = sql.indexOf(delimiter, index + delimiter.length);
        if (endIndex < 0) {
          return null;
        }
        index = endIndex + delimiter.length - 1;
        continue;
      }
    }
    if (character === '?'
      || (engine === 'postgres' && character === '$' && /\d/.test(next ?? ''))
      || (character === ':' && sql[index - 1] !== ':' && next !== ':' && /[a-zA-Z_]/.test(next ?? ''))) {
      return null;
    }
    if (character === ';') {
      if (depth !== 0 || semicolonIndex >= 0) {
        return null;
      }
      seenSemicolon = true;
      semicolonIndex = index;
      continue;
    }
    if (character === '(') {
      depth += 1;
      continue;
    }
    if (character === ')') {
      depth -= 1;
      if (depth < 0) {
        return null;
      }
      continue;
    }
    if (/[a-zA-Z_]/.test(character)) {
      let end = index + 1;
      while (end < sql.length && /[a-zA-Z0-9_$]/.test(sql[end]!)) {
        end += 1;
      }
      const word = sql.slice(index, end).toUpperCase();
      allWords.push(word);
      if (depth === 0) {
        topLevelWords.push(word);
      }
      if (FORBIDDEN_FUNCTIONS.has(word) && sql.slice(end).match(/^\s*\(/)) {
        return null;
      }
      index = end - 1;
    }
  }

  if (state === 'single' || state === 'double' || state === 'backtick' || state === 'bracket'
    || state === 'block-comment' || blockDepth !== 0 || depth !== 0) {
    return null;
  }
  if (topLevelWords.length === 0 || allWords.some(word => FORBIDDEN_WORDS.has(word))) {
    return null;
  }

  const firstWord = topLevelWords[0];
  let kind: NormalizedDatabaseStatement['kind'];
  if (firstWord === 'SELECT') {
    if (allWords.some(word => MUTATION_WORDS.has(word) || word === 'INTO')) {
      return null;
    }
    kind = 'select';
  }
  else if (firstWord === 'WITH') {
    const finalStatement = [...topLevelWords].reverse().find(word => STATEMENT_WORDS.has(word));
    if (finalStatement !== 'SELECT' || allWords.some(word => MUTATION_WORDS.has(word) || word === 'INTO')) {
      return null;
    }
    kind = 'select';
  }
  else if (firstWord === 'INSERT' && allWords.includes('INTO') && !allWords.includes('DELETE')) {
    kind = 'insert';
  }
  else if (firstWord === 'UPDATE' && allWords.includes('SET') && !allWords.includes('DELETE')) {
    kind = 'update';
  }
  else if (firstWord === 'DELETE' && allWords.includes('FROM') && !allWords.includes('INSERT')) {
    kind = 'delete';
  }
  else {
    return null;
  }
  if (allWords.includes('DO') && !(kind === 'insert' && hasOnConflictAction(topLevelWords))) {
    return null;
  }

  const normalizedSql = semicolonIndex >= 0 ? sql.slice(0, semicolonIndex).trim() : sql;
  return { kind, sql: normalizedSql };
}

/** Keep the earlier read-only validator for bounded result-query callers and tests. */
export function normalizeReadOnlySelectQuery(value: unknown, engine: DatabaseEngine): string | null {
  const statement = normalizeDatabaseStatement(value, engine);
  return statement?.kind === 'select' ? statement.sql : null;
}

function readQuotedIdentifier(sql: string, closingIndex: number, closingCharacter: string): string {
  let openingIndex = closingIndex - 1;
  while (openingIndex >= 0 && sql[openingIndex] !== closingCharacter) {
    openingIndex -= 1;
  }
  return sql.slice(openingIndex + 1, closingIndex).toUpperCase();
}

function hasOnConflictAction(words: readonly string[]): boolean {
  const conflictIndex = words.indexOf('CONFLICT');
  if (conflictIndex <= 0 || words[conflictIndex - 1] !== 'ON') {
    return false;
  }
  const actionIndex = words.indexOf('DO', conflictIndex + 1);
  return actionIndex > conflictIndex && (words[actionIndex + 1] === 'UPDATE' || words[actionIndex + 1] === 'NOTHING');
}

function isSqlWhitespace(value: string | undefined): boolean {
  return value === undefined || /\s/.test(value);
}

function normalizeSqlIdentifier(value: string, engine: DatabaseEngine): string {
  const quote = engine === 'mysql' ? '`' : '"';
  if (value.startsWith('[') && engine === 'sqlite') {
    return value.slice(1, -1).replaceAll(']]', ']');
  }
  if (value.startsWith(quote)) {
    return value.slice(1, -1).replaceAll(quote + quote, quote);
  }
  return engine === 'postgres' ? value.toLowerCase() : value;
}
