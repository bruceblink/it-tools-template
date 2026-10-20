import type {
  DatabaseBridgeResult,
  DatabaseAccessMode,
  DatabaseCellUpdateInput,
  DatabaseEngine,
  MySqlConnectionInput,
  PostgresConnectionInput,
  PostgresDataPageInput,
} from '../../src/shared/desktop-services/database';
import { isValidMySqlConnectionInput, isValidMySqlIdentifier } from './mysql-service';
import { isValidDatabaseIdentifier, isValidPostgresConnectionInput, isValidPostgresPageRequest } from './postgres-service';
import { isValidSQLiteFilePath, isValidSQLiteIdentifier } from './sqlite-service';
import { normalizeDatabaseStatement } from './sql-query';
import { MAX_QUERY_OFFSET } from './query-results';
import { isValidCellUpdateInput } from './cell-edit';

export type DatabaseWorkerCommand =
  | { requestId: string; operation: 'connect'; sessionId: string; input: PostgresConnectionInput }
  | { requestId: string; operation: 'connect-mysql'; sessionId: string; input: MySqlConnectionInput }
  | { requestId: string; operation: 'connect-sqlite'; sessionId: string; filePath: string; accessMode?: DatabaseAccessMode }
  | { requestId: string; operation: 'disconnect'; sessionId: string }
  | { requestId: string; operation: 'disconnect-mysql'; sessionId: string }
  | { requestId: string; operation: 'disconnect-sqlite'; sessionId: string }
  | { requestId: string; operation: 'list-schemas'; sessionId: string }
  | { requestId: string; operation: 'list-mysql-schemas'; sessionId: string }
  | { requestId: string; operation: 'list-sqlite-schemas'; sessionId: string }
  | { requestId: string; operation: 'list-tables'; sessionId: string; schema: string }
  | { requestId: string; operation: 'list-mysql-tables'; sessionId: string; schema: string }
  | { requestId: string; operation: 'list-sqlite-tables'; sessionId: string; schema: string }
  | { requestId: string; operation: 'get-structure'; sessionId: string; schema: string; table: string }
  | { requestId: string; operation: 'get-mysql-structure'; sessionId: string; schema: string; table: string }
  | { requestId: string; operation: 'get-sqlite-structure'; sessionId: string; schema: string; table: string }
  | { requestId: string; operation: 'get-data-page'; sessionId: string; pageRequestId: string; schema: string; table: string; page: PostgresDataPageInput }
  | { requestId: string; operation: 'get-mysql-data-page'; sessionId: string; schema: string; table: string; page: PostgresDataPageInput }
  | { requestId: string; operation: 'get-sqlite-data-page'; sessionId: string; schema: 'main'; table: string; page: PostgresDataPageInput }
  | { requestId: string; operation: 'update-cell'; sessionId: string; engine: DatabaseEngine; input: DatabaseCellUpdateInput }
  | { requestId: string; operation: 'execute-sql-statement'; sessionId: string; engine: DatabaseEngine; sql: string; offset: number }
  | { requestId: string; operation: 'cancel-data-page'; sessionId: string; targetRequestId: string }
  | { requestId: string; operation: 'close' };

export interface DatabaseWorkerResponse {
  requestId: string;
  result: DatabaseBridgeResult<unknown>;
}

/** Reject unknown fields before dispatch so utility messages cannot grow into a general command channel. */
export function parseDatabaseWorkerCommand(value: unknown): DatabaseWorkerCommand | null {
  if (!isRecord(value) || typeof value.requestId !== 'string' || !isRequestId(value.requestId)) {
    return null;
  }

  const { operation } = value;
  if (operation === 'connect'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'input'])
    && isSessionId(value.sessionId)
    && isValidPostgresConnectionInput(value.input)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'connect-mysql'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'input'])
    && isSessionId(value.sessionId)
    && isValidMySqlConnectionInput(value.input)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'connect-sqlite'
    && (hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'filePath'])
      || hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'filePath', 'accessMode']))
    && isSessionId(value.sessionId)
    && isValidSQLiteFilePath(value.filePath)
    && (value.accessMode === undefined || isDatabaseAccessMode(value.accessMode))) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'disconnect' || operation === 'list-schemas') {
    if (hasExactKeys(value, ['requestId', 'operation', 'sessionId']) && isSessionId(value.sessionId)) {
      return value as DatabaseWorkerCommand;
    }
  }
  if ((operation === 'disconnect-mysql' || operation === 'list-mysql-schemas')
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId'])
    && isSessionId(value.sessionId)) {
    return value as DatabaseWorkerCommand;
  }
  if ((operation === 'disconnect-sqlite' || operation === 'list-sqlite-schemas')
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId'])
    && isSessionId(value.sessionId)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'list-tables'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'schema'])
    && isSessionId(value.sessionId)
    && isValidDatabaseIdentifier(value.schema)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'list-mysql-tables'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'schema'])
    && isSessionId(value.sessionId)
    && isValidMySqlIdentifier(value.schema)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'list-sqlite-tables'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'schema'])
    && isSessionId(value.sessionId)
    && value.schema === 'main') {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'get-structure'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'schema', 'table'])
    && isSessionId(value.sessionId)
    && isValidDatabaseIdentifier(value.schema)
    && isValidDatabaseIdentifier(value.table)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'get-mysql-structure'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'schema', 'table'])
    && isSessionId(value.sessionId)
    && isValidMySqlIdentifier(value.schema)
    && isValidMySqlIdentifier(value.table)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'get-sqlite-structure'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'schema', 'table'])
    && isSessionId(value.sessionId)
    && value.schema === 'main'
    && isValidSQLiteIdentifier(value.table)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'get-data-page'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'pageRequestId', 'schema', 'table', 'page'])
    && isSessionId(value.sessionId)
    && typeof value.pageRequestId === 'string'
    && isRequestId(value.pageRequestId)
    && isValidDatabaseIdentifier(value.schema)
    && isValidDatabaseIdentifier(value.table)
    && isValidPostgresPageRequest(value.page)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'get-mysql-data-page'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'schema', 'table', 'page'])
    && isSessionId(value.sessionId)
    && isValidMySqlIdentifier(value.schema)
    && isValidMySqlIdentifier(value.table)
    && isValidOffsetPageRequest(value.page)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'get-sqlite-data-page'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'schema', 'table', 'page'])
    && isSessionId(value.sessionId)
    && value.schema === 'main'
    && isValidSQLiteIdentifier(value.table)
    && isValidOffsetPageRequest(value.page)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'update-cell'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'engine', 'input'])
    && isSessionId(value.sessionId)
    && (value.engine === 'postgres' || value.engine === 'mysql' || value.engine === 'sqlite')
    && isValidCellUpdateInput(value.input, value.engine)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'execute-sql-statement'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'engine', 'sql', 'offset'])
    && isSessionId(value.sessionId)
    && (value.engine === 'postgres' || value.engine === 'mysql' || value.engine === 'sqlite')
    && normalizeDatabaseStatement(value.sql, value.engine) !== null
    && (normalizeDatabaseStatement(value.sql, value.engine)?.kind === 'select' || value.offset === 0)
    && Number.isInteger(value.offset)
    && typeof value.offset === 'number'
    && value.offset >= 0
    && value.offset <= MAX_QUERY_OFFSET) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'cancel-data-page'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'targetRequestId'])
    && isSessionId(value.sessionId)
    && typeof value.targetRequestId === 'string'
    && isRequestId(value.targetRequestId)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'close' && hasExactKeys(value, ['requestId', 'operation'])) {
    return value as DatabaseWorkerCommand;
  }

  return null;
}

function isValidOffsetPageRequest(value: unknown): value is PostgresDataPageInput {
  return isRecord(value)
    && hasExactKeys(value, ['cursor', 'offset'])
    && value.cursor === null
    && Number.isInteger(value.offset)
    && (value.offset as number) >= 0
    && (value.offset as number) <= 1_000_000
    && (value.offset as number) % 25 === 0;
}

function isDatabaseAccessMode(value: unknown): value is DatabaseAccessMode {
  return value === 'read-only' || value === 'read-write';
}

function isRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSessionId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
