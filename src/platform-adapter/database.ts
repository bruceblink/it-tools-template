import type {
  DatabaseBridgeResult,
  DatabaseErrorCode,
  PostgresConnectionInput,
  PostgresSchemaInfo,
  PostgresSessionInfo,
  PostgresStructureInfo,
  PostgresTableInfo,
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

export function disconnectDatabase(sessionId: string): Promise<DatabaseOperation<boolean>> {
  return callDesktopDatabase(bridge => bridge.disconnectDatabase?.(sessionId));
}

export function listDatabaseSchemas(sessionId: string): Promise<DatabaseOperation<PostgresSchemaInfo[]>> {
  return callDesktopDatabase(bridge => bridge.listDatabaseSchemas?.(sessionId));
}

export function listDatabaseTables(sessionId: string, schema: string): Promise<DatabaseOperation<PostgresTableInfo[]>> {
  return callDesktopDatabase(bridge => bridge.listDatabaseTables?.(sessionId, schema));
}

export function getDatabaseStructure(
  sessionId: string,
  schema: string,
  table: string,
): Promise<DatabaseOperation<PostgresStructureInfo>> {
  return callDesktopDatabase(bridge => bridge.getDatabaseStructure?.(sessionId, schema, table));
}
