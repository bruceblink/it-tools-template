import { randomUUID } from 'node:crypto';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type {
  DatabaseBridgeResult,
  DatabaseErrorCode,
  PostgresConnectionInput,
  PostgresDataPage,
  PostgresDataPageInput,
  PostgresSchemaInfo,
  PostgresSessionInfo,
  PostgresStructureInfo,
  PostgresTableInfo,
} from '../../src/shared/desktop-services/database';
import { isTrustedDesktopSender } from '../plugin-ipc-security';
import { DatabaseServiceHost } from './database-service-host';

const CONNECTION_CHANNEL = 'desktop:database:postgres:connect';
const DISCONNECT_CHANNEL = 'desktop:database:disconnect';
const SCHEMAS_CHANNEL = 'desktop:database:schemas';
const TABLES_CHANNEL = 'desktop:database:tables';
const STRUCTURE_CHANNEL = 'desktop:database:structure';
const DATA_PAGE_CHANNEL = 'desktop:database:data-page';

interface DatabaseIpcDependencies {
  trustedRendererUrl: () => string;
  workerPath: string;
}

interface OwnedSession {
  rendererId: number;
  sessionId: string;
}

/** Expose only the operations required for PostgreSQL metadata browsing to the trusted app frame. */
export function registerDatabaseIpc(dependencies: DatabaseIpcDependencies) {
  const serviceHost = new DatabaseServiceHost(dependencies.workerPath);
  const sessions = new Map<string, OwnedSession>();
  const rendererSessions = new Map<number, string>();

  ipcMain.handle(CONNECTION_CHANNEL, async (event, value: unknown) => {
    if (!isTrustedDesktopSender(event, dependencies.trustedRendererUrl())) {
      return { ok: false, error: 'untrusted-renderer' } satisfies DatabaseBridgeResult<never>;
    }
    const input = parsePostgresConnectionRequest(value);
    if (!input) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }

    await disconnectRendererSession(event.sender.id);
    const sessionId = randomUUID();
    const result = await serviceHost.request<PostgresSessionInfo>({ operation: 'connect', sessionId, input });
    if (result.ok) {
      sessions.set(sessionId, { rendererId: event.sender.id, sessionId });
      rendererSessions.set(event.sender.id, sessionId);
    }
    return result;
  });

  ipcMain.handle(DISCONNECT_CHANNEL, async (event, value: unknown) => {
    const sessionId = parseSessionRequest(value);
    if (!isTrustedDesktopSender(event, dependencies.trustedRendererUrl())) {
      return { ok: false, error: 'untrusted-renderer' } satisfies DatabaseBridgeResult<never>;
    }
    if (!sessionId) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }
    if (!ownsSession(event.sender.id, sessionId)) {
      return { ok: false, error: 'not-connected' } satisfies DatabaseBridgeResult<never>;
    }
    return disconnectSession(sessionId);
  });

  ipcMain.handle(SCHEMAS_CHANNEL, async (event, value: unknown) => {
    const sessionId = parseSessionRequest(value);
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError } satisfies DatabaseBridgeResult<never>;
    }
    if (!sessionId) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }
    if (!ownsSession(event.sender.id, sessionId)) {
      return { ok: false, error: 'not-connected' } satisfies DatabaseBridgeResult<never>;
    }
    return serviceHost.request<PostgresSchemaInfo[]>({ operation: 'list-schemas', sessionId });
  });

  ipcMain.handle(TABLES_CHANNEL, async (event, value: unknown) => {
    const request = parseSchemaRequest(value);
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError } satisfies DatabaseBridgeResult<never>;
    }
    if (!request) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }
    if (!ownsSession(event.sender.id, request.sessionId)) {
      return { ok: false, error: 'not-connected' } satisfies DatabaseBridgeResult<never>;
    }
    return serviceHost.request<PostgresTableInfo[]>({
      operation: 'list-tables',
      sessionId: request.sessionId,
      schema: request.schema,
    });
  });

  ipcMain.handle(STRUCTURE_CHANNEL, async (event, value: unknown) => {
    const request = parseTableRequest(value);
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError } satisfies DatabaseBridgeResult<never>;
    }
    if (!request) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }
    if (!ownsSession(event.sender.id, request.sessionId)) {
      return { ok: false, error: 'not-connected' } satisfies DatabaseBridgeResult<never>;
    }
    return serviceHost.request<PostgresStructureInfo>({
      operation: 'get-structure',
      sessionId: request.sessionId,
      schema: request.schema,
      table: request.table,
    });
  });

  ipcMain.handle(DATA_PAGE_CHANNEL, async (event, value: unknown) => {
    const request = parseDataPageRequest(value);
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError } satisfies DatabaseBridgeResult<never>;
    }
    if (!request) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }
    if (!ownsSession(event.sender.id, request.sessionId)) {
      return { ok: false, error: 'not-connected' } satisfies DatabaseBridgeResult<never>;
    }
    return serviceHost.request<PostgresDataPage>({
      operation: 'get-data-page',
      sessionId: request.sessionId,
      schema: request.schema,
      table: request.table,
      page: request.page,
    });
  });

  async function disconnectRendererSession(rendererId: number): Promise<void> {
    const sessionId = rendererSessions.get(rendererId);
    if (sessionId) {
      await disconnectSession(sessionId);
    }
  }

  async function disconnectSession(sessionId: string): Promise<DatabaseBridgeResult<boolean>> {
    const owner = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (owner && rendererSessions.get(owner.rendererId) === sessionId) {
      rendererSessions.delete(owner.rendererId);
    }
    return serviceHost.request<boolean>({ operation: 'disconnect', sessionId });
  }

  function ownsSession(rendererId: number, sessionId: string): boolean {
    return sessions.get(sessionId)?.rendererId === rendererId;
  }

  return {
    closeRenderer(rendererId: number): void {
      void disconnectRendererSession(rendererId);
    },
    shutdown(): void {
      serviceHost.close();
      sessions.clear();
      rendererSessions.clear();
      ipcMain.removeHandler(CONNECTION_CHANNEL);
      ipcMain.removeHandler(DISCONNECT_CHANNEL);
      ipcMain.removeHandler(SCHEMAS_CHANNEL);
      ipcMain.removeHandler(TABLES_CHANNEL);
      ipcMain.removeHandler(STRUCTURE_CHANNEL);
      ipcMain.removeHandler(DATA_PAGE_CHANNEL);
    },
  };
}

function getTrustedSenderError(event: IpcMainInvokeEvent, trustedRendererUrl: string): DatabaseErrorCode | null {
  return isTrustedDesktopSender(event, trustedRendererUrl) ? null : 'untrusted-renderer';
}

function parsePostgresConnectionRequest(value: unknown): PostgresConnectionInput | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['host', 'port', 'database', 'username', 'password', 'tlsMode'])
    || typeof value.host !== 'string'
    || value.host.trim().length === 0
    || value.host.length > 253
    || typeof value.port !== 'number'
    || !Number.isInteger(value.port)
    || value.port < 1
    || value.port > 65_535
    || typeof value.database !== 'string'
    || value.database.length === 0
    || value.database.length > 63
    || typeof value.username !== 'string'
    || value.username.length === 0
    || value.username.length > 128
    || typeof value.password !== 'string'
    || value.password.length > 4096
    || (value.tlsMode !== 'verify' && value.tlsMode !== 'disable')) {
    return null;
  }
  return value as unknown as PostgresConnectionInput;
}

function parseSessionRequest(value: unknown): string | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['sessionId'])
    || typeof value.sessionId !== 'string'
    || !isSessionId(value.sessionId)) {
    return null;
  }
  return value.sessionId;
}

function parseSchemaRequest(value: unknown): { sessionId: string; schema: string } | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['sessionId', 'schema'])
    || typeof value.schema !== 'string'
    || !isDatabaseIdentifier(value.schema)) {
    return null;
  }
  const sessionId = parseSessionRequest({ sessionId: value.sessionId });
  return sessionId ? { sessionId, schema: value.schema } : null;
}

function parseTableRequest(value: unknown): { sessionId: string; schema: string; table: string } | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['sessionId', 'schema', 'table'])
    || typeof value.schema !== 'string'
    || !isDatabaseIdentifier(value.schema)
    || typeof value.table !== 'string'
    || !isDatabaseIdentifier(value.table)) {
    return null;
  }
  const sessionId = parseSessionRequest({ sessionId: value.sessionId });
  return sessionId ? { sessionId, schema: value.schema, table: value.table } : null;
}

function parseDataPageRequest(
  value: unknown,
): { sessionId: string; schema: string; table: string; page: PostgresDataPageInput } | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['sessionId', 'schema', 'table', 'page'])
    || typeof value.schema !== 'string'
    || !isDatabaseIdentifier(value.schema)
    || typeof value.table !== 'string'
    || !isDatabaseIdentifier(value.table)
    || !isBoundedPageInput(value.page)) {
    return null;
  }
  const sessionId = parseSessionRequest({ sessionId: value.sessionId });
  return sessionId ? { sessionId, schema: value.schema, table: value.table, page: value.page } : null;
}

function isBoundedPageInput(value: unknown): value is PostgresDataPageInput {
  if (!isRecord(value)
    || !hasExactKeys(value, ['cursor', 'offset'])
    || !Number.isInteger(value.offset)
    || (value.offset as number) < 0
    || (value.offset as number) > 1_000_000
    || (value.offset as number) % 25 !== 0) {
    return false;
  }
  if (value.cursor === null) {
    return true;
  }
  if (typeof value.cursor !== 'string' || value.cursor.length === 0 || value.cursor.length > 4_096 || value.offset !== 0) {
    return false;
  }
  try {
    const cursor: unknown = JSON.parse(value.cursor);
    return isRecord(cursor)
      && Object.keys(cursor).length > 0
      && Object.keys(cursor).length <= 32
      && Object.entries(cursor).every(([key, item]) => key.length > 0
        && key.length <= 63
        && !key.includes('\u0000')
        && item !== null
        && (typeof item === 'boolean'
          || (typeof item === 'string' && item.length <= 128)
          || (typeof item === 'number' && Number.isFinite(item))));
  }
  catch {
    return false;
  }
}

function isSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDatabaseIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 63 && !value.includes('\u0000');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
