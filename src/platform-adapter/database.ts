import type {
  DatabaseBridgeResult,
  DatabaseErrorCode,
  PostgresConnectionInput,
  PostgresConnectionProfile,
  PostgresConnectionProfileInput,
  PostgresDataPage,
  PostgresDataPageInput,
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

export function getDatabaseDataPage(
  sessionId: string,
  schema: string,
  table: string,
  page: PostgresDataPageInput,
): Promise<DatabaseOperation<PostgresDataPage>> {
  return callDesktopDatabase(bridge => bridge.getDatabaseDataPage?.(sessionId, schema, table, page));
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
