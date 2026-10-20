import type { DatabaseEngine } from '../../src/shared/desktop-services/database';

const MAX_QUERY_CHARACTERS = 16_384;
const FORBIDDEN_WORDS = new Set([
  'ALTER', 'ANALYZE', 'ATTACH', 'BEGIN', 'CALL', 'COMMIT', 'COPY', 'CREATE', 'DELETE', 'DETACH', 'DO', 'DROP',
  'EXECUTE', 'GRANT', 'INTO', 'INSERT', 'LOAD', 'LOCK', 'MERGE', 'PRAGMA', 'REFRESH', 'RELEASE', 'RENAME',
  'RESET', 'REVOKE', 'ROLLBACK', 'SAVEPOINT', 'SET', 'SHOW', 'TRUNCATE', 'UPDATE', 'VACUUM',
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

/** Accept one bounded SELECT statement and reject ambiguous quoting and write-capable tokens. */
export function normalizeReadOnlySelectQuery(value: unknown, engine: DatabaseEngine): string | null {
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
  let dollarQuote: string | null = null;

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
        dollarQuote = quoteMatch[0];
        const endIndex = sql.indexOf(dollarQuote, index + dollarQuote.length);
        if (endIndex < 0) {
          return null;
        }
        index = endIndex + dollarQuote.length - 1;
        dollarQuote = null;
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
      index = end - 1;
    }
  }

  if (state === 'single' || state === 'double' || state === 'backtick' || state === 'bracket'
    || state === 'block-comment' || blockDepth !== 0 || depth !== 0 || dollarQuote !== null) {
    return null;
  }
  if (topLevelWords.length === 0 || allWords.some(word => FORBIDDEN_WORDS.has(word) || FORBIDDEN_FUNCTIONS.has(word))) {
    return null;
  }

  const firstWord = topLevelWords[0];
  if (firstWord === 'SELECT') {
    return semicolonIndex >= 0 ? sql.slice(0, semicolonIndex).trim() : sql;
  }
  if (firstWord !== 'WITH') {
    return null;
  }
  const finalStatement = [...topLevelWords].reverse().find(word => STATEMENT_WORDS.has(word));
  if (finalStatement !== 'SELECT') {
    return null;
  }
  return semicolonIndex >= 0 ? sql.slice(0, semicolonIndex).trim() : sql;
}

function isSqlWhitespace(value: string | undefined): boolean {
  return value === undefined || /\s/.test(value);
}
