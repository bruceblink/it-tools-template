import type {
  DatabaseBatchMutationInput,
  DatabaseBatchMutationResponse,
  DatabaseBridgeResult,
  DatabaseAccessMode,
  DatabaseCellUpdateInput,
  DatabaseStatementResult,
  DatabaseSchemaInfo,
  DatabaseStructureInfo,
  DatabaseTableInfo,
  DatabaseErrorCode,
  MySqlConnectionInput,
  MySqlSessionInfo,
  PostgresConnectionInput,
  PostgresConnectionProfile,
  PostgresConnectionProfileInput,
  PostgresDataPage,
  PostgresDataPageInput,
  PostgresSessionInfo,
  SQLiteSessionInfo,
} from '@/shared/desktop-services/database';

export type DatabaseOperation<T> =
  | { status: 'success'; value: T }
  | { status: 'unsupported' }
  | { status: 'failed'; error: DatabaseErrorCode };

/** Keep renderer code independent of Electron IPC and normalize unavailable bridge errors. */
async function callDesktopDatabase<T>(
  operation: ((bridge: NonNullable<Window['itToolsDesktop']>) => Promise<DatabaseBridgeResult<T>> | undefined) | undefined,
): Promise<DatabaseOperation<T>> {
  const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
  if (!bridge || !operation) {
    return { status: 'unsupported' };
  }

  try {
    const result = await operation(bridge);
    if (!result) {
      return { status: 'unsupported' };
    }
    return result.ok ? { status: 'success', value: result.value } : { status: 'failed', error: result.error };
  }
  catch {
    return { status: 'failed', error: 'service-unavailable' };
  }
}

export function connectPostgres(input: PostgresConnectionInput): Promise<DatabaseOperation<PostgresSessionInfo>> {
  return callDesktopDatabase(bridge => bridge.connectPostgres?.(input));
}

export function connectMySql(input: MySqlConnectionInput): Promise<DatabaseOperation<MySqlSessionInfo>> {
  return callDesktopDatabase(bridge => bridge.connectMySql?.(input));
}

export function connectSQLite(accessMode: DatabaseAccessMode): Promise<DatabaseOperation<SQLiteSessionInfo | null>> {
  return callDesktopDatabase(bridge => bridge.connectSQLite?.(accessMode));
}

export function disconnectDatabase(sessionId: string): Promise<DatabaseOperation<boolean>> {
  return callDesktopDatabase(bridge => bridge.disconnectDatabase?.(sessionId));
}

export function listDatabaseSchemas(sessionId: string): Promise<DatabaseOperation<DatabaseSchemaInfo[]>> {
  return callDesktopDatabase(bridge => bridge.listDatabaseSchemas?.(sessionId));
}

export function listDatabaseTables(sessionId: string, schema: string): Promise<DatabaseOperation<DatabaseTableInfo[]>> {
  return callDesktopDatabase(bridge => bridge.listDatabaseTables?.(sessionId, schema));
}

export function getDatabaseStructure(
  sessionId: string,
  schema: string,
  table: string,
): Promise<DatabaseOperation<DatabaseStructureInfo>> {
  return callDesktopDatabase(bridge => bridge.getDatabaseStructure?.(sessionId, schema, table));
}

export function getDatabaseDataPage(
  sessionId: string,
  requestId: string,
  schema: string,
  table: string,
  page: PostgresDataPageInput,
): Promise<DatabaseOperation<PostgresDataPage>> {
  return callDesktopDatabase(bridge => bridge.getDatabaseDataPage?.(sessionId, requestId, schema, table, page));
}

export function updateDatabaseCell(
  sessionId: string,
  input: DatabaseCellUpdateInput,
): Promise<DatabaseOperation<boolean>> {
  return callDesktopDatabase(bridge => bridge.updateDatabaseCell?.(sessionId, input));
}

export function applyDatabaseBatchMutation(
  sessionId: string,
  input: DatabaseBatchMutationInput,
): Promise<DatabaseOperation<DatabaseBatchMutationResponse>> {
  return callDesktopDatabase(bridge => bridge.applyDatabaseBatchMutation?.(sessionId, input));
}

export function runDatabaseQuery(
  sessionId: string,
  requestId: string,
  sql: string,
  offset: number,
): Promise<DatabaseOperation<DatabaseStatementResult>> {
  return callDesktopDatabase(bridge => bridge.runDatabaseQuery?.(sessionId, requestId, sql, offset));
}

export function cancelDatabaseDataPage(
  sessionId: string,
  requestId: string,
): Promise<DatabaseOperation<boolean>> {
  return callDesktopDatabase(bridge => bridge.cancelDatabaseDataPage?.(sessionId, requestId));
}

export function cancelDatabaseQuery(
  sessionId: string,
  requestId: string,
): Promise<DatabaseOperation<boolean>> {
  return callDesktopDatabase(bridge => bridge.cancelDatabaseQuery?.(sessionId, requestId));
}

export function listPostgresProfiles(): Promise<DatabaseOperation<PostgresConnectionProfile[]>> {
  return callDesktopDatabase(bridge => bridge.listPostgresProfiles?.());
}

export function savePostgresProfile(input: PostgresConnectionProfileInput): Promise<DatabaseOperation<PostgresConnectionProfile>> {
  return callDesktopDatabase(bridge => bridge.savePostgresProfile?.(input));
}

export function deletePostgresProfile(profileId: string): Promise<DatabaseOperation<boolean>> {
  return callDesktopDatabase(bridge => bridge.deletePostgresProfile?.(profileId));
}
