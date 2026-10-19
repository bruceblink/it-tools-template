import type { DatabaseBridgeResult, PostgresConnectionInput } from '../../src/shared/desktop-services/database';
import { isValidDatabaseIdentifier, isValidPostgresConnectionInput } from './postgres-service';

export type DatabaseWorkerCommand =
  | { requestId: string; operation: 'connect'; sessionId: string; input: PostgresConnectionInput }
  | { requestId: string; operation: 'disconnect'; sessionId: string }
  | { requestId: string; operation: 'list-schemas'; sessionId: string }
  | { requestId: string; operation: 'list-tables'; sessionId: string; schema: string }
  | { requestId: string; operation: 'get-structure'; sessionId: string; schema: string; table: string }
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
  if (operation === 'disconnect' || operation === 'list-schemas') {
    if (hasExactKeys(value, ['requestId', 'operation', 'sessionId']) && isSessionId(value.sessionId)) {
      return value as DatabaseWorkerCommand;
    }
  }
  if (operation === 'list-tables'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'schema'])
    && isSessionId(value.sessionId)
    && isValidDatabaseIdentifier(value.schema)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'get-structure'
    && hasExactKeys(value, ['requestId', 'operation', 'sessionId', 'schema', 'table'])
    && isSessionId(value.sessionId)
    && isValidDatabaseIdentifier(value.schema)
    && isValidDatabaseIdentifier(value.table)) {
    return value as DatabaseWorkerCommand;
  }
  if (operation === 'close' && hasExactKeys(value, ['requestId', 'operation'])) {
    return value as DatabaseWorkerCommand;
  }

  return null;
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
