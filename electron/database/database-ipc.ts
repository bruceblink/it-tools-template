import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type {
  DatabaseBatchMutationInput,
  DatabaseBatchMutationResult,
  DatabaseBridgeResult,
  DatabaseAccessMode,
  DatabaseCellUpdateInput,
  DatabaseEngine,
  DatabaseErrorCode,
  DatabaseStatementResult,
  DatabaseSchemaInfo,
  DatabaseStructureInfo,
  DatabaseTableInfo,
  MySqlConnectionInput,
  MySqlSessionInfo,
  PostgresConnectionInput,
  PostgresDataPage,
  PostgresDataPageInput,
  PostgresSchemaInfo,
  PostgresSessionInfo,
  PostgresStructureInfo,
  PostgresTableInfo,
  SQLiteSessionInfo,
} from '../../src/shared/desktop-services/database';
import { isTrustedDesktopSender } from '../plugin-ipc-security';
import { DatabaseServiceHost } from './database-service-host';
import { PostgresConnectionProfileStore } from './postgres-connection-profile-store';
import { isValidSQLiteFilePath } from './sqlite-service';
import { MAX_QUERY_OFFSET } from './query-results';
import { normalizeDatabaseStatement } from './sql-query';
import { isValidBatchMutationInput, isValidCellUpdateInput } from './cell-edit';
import { isValidTablePageRequest } from './table-page-options';

const CONNECTION_CHANNEL = 'desktop:database:postgres:connect';
const MYSQL_CONNECTION_CHANNEL = 'desktop:database:mysql:connect';
const SQLITE_CONNECTION_CHANNEL = 'desktop:database:sqlite:connect';
const DISCONNECT_CHANNEL = 'desktop:database:disconnect';
const SCHEMAS_CHANNEL = 'desktop:database:schemas';
const TABLES_CHANNEL = 'desktop:database:tables';
const STRUCTURE_CHANNEL = 'desktop:database:structure';
const DATA_PAGE_CHANNEL = 'desktop:database:data-page';
const QUERY_CHANNEL = 'desktop:database:query';
const CANCEL_DATA_PAGE_CHANNEL = 'desktop:database:data-page:cancel';
const CANCEL_QUERY_CHANNEL = 'desktop:database:query:cancel';
const UPDATE_CELL_CHANNEL = 'desktop:database:cell:update';
const BATCH_MUTATION_CHANNEL = 'desktop:database:batch-mutation';
const LIST_PROFILES_CHANNEL = 'desktop:database:postgres-profiles:list';
const SAVE_PROFILE_CHANNEL = 'desktop:database:postgres-profiles:save';
const DELETE_PROFILE_CHANNEL = 'desktop:database:postgres-profiles:delete';

interface DatabaseIpcDependencies {
  trustedRendererUrl: () => string;
  workerPath: string;
  userDataRoot: string;
}

interface OwnedSession {
  rendererId: number;
  sessionId: string;
  engine: DatabaseEngine;
  accessMode: DatabaseAccessMode;
  targetLabel: string;
}

interface OwnedPageRequest {
  rendererId: number;
  requestId: string;
  started: boolean;
  cancelRequested: boolean;
  finished: Promise<void>;
  finish: () => void;
}

interface OwnedQueryRequest {
  rendererId: number;
  requestId: string;
  started: boolean;
  cancelRequested: boolean;
  finished: Promise<void>;
  finish: () => void;
}

/** Expose bounded metadata and allowlisted SQL operations only to the trusted app frame. */
export function registerDatabaseIpc(dependencies: DatabaseIpcDependencies) {
  const serviceHost = new DatabaseServiceHost(dependencies.workerPath);
  const profileStore = new PostgresConnectionProfileStore(
    resolve(dependencies.userDataRoot, 'database-manager', 'postgres-profiles.json'),
  );
  const sessions = new Map<string, OwnedSession>();
  const rendererSessions = new Map<number, string>();
  const activePageRequests = new Map<string, OwnedPageRequest>();
  const activeQueryRequests = new Map<string, OwnedQueryRequest>();
  const sessionOperationTails = new Map<string, Promise<void>>();

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
      sessions.set(sessionId, {
        rendererId: event.sender.id,
        sessionId,
        engine: 'postgres',
        accessMode: input.accessMode ?? 'read-only',
        targetLabel: `${input.host}:${input.port}/${input.database}`,
      });
      rendererSessions.set(event.sender.id, sessionId);
    }
    return result;
  });

  ipcMain.handle(MYSQL_CONNECTION_CHANNEL, async (event, value: unknown) => {
    if (!isTrustedDesktopSender(event, dependencies.trustedRendererUrl())) {
      return { ok: false, error: 'untrusted-renderer' } satisfies DatabaseBridgeResult<never>;
    }
    const input = parseMySqlConnectionRequest(value);
    if (!input) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }

    await disconnectRendererSession(event.sender.id);
    const sessionId = randomUUID();
    const result = await serviceHost.request<MySqlSessionInfo>({ operation: 'connect-mysql', sessionId, input });
    if (result.ok) {
      sessions.set(sessionId, {
        rendererId: event.sender.id,
        sessionId,
        engine: 'mysql',
        accessMode: input.accessMode ?? 'read-only',
        targetLabel: `${input.host}:${input.port}/${input.database}`,
      });
      rendererSessions.set(event.sender.id, sessionId);
    }
    return result;
  });

  ipcMain.handle(SQLITE_CONNECTION_CHANNEL, async (event, value: unknown) => {
    if (!isTrustedDesktopSender(event, dependencies.trustedRendererUrl())) {
      return { ok: false, error: 'untrusted-renderer' } satisfies DatabaseBridgeResult<never>;
    }
    const accessMode = parseSQLiteAccessMode(value);
    if (!accessMode) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }

    let selection: Electron.OpenDialogReturnValue;
    try {
      const options: Electron.OpenDialogOptions = {
        title: 'Open SQLite database',
        properties: ['openFile'],
        filters: [
          { name: 'SQLite databases', extensions: ['db', 'sqlite', 'sqlite3'] },
          { name: 'All files', extensions: ['*'] },
        ],
      };
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      selection = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);
    }
    catch {
      return { ok: false, error: 'connection-failed' } satisfies DatabaseBridgeResult<never>;
    }
    if (selection.canceled) {
      return { ok: true, value: null } satisfies DatabaseBridgeResult<SQLiteSessionInfo | null>;
    }
    const filePath = selection.filePaths[0];
    if (!isValidSQLiteFilePath(filePath)) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }

    await disconnectRendererSession(event.sender.id);
    const sessionId = randomUUID();
    const result = await serviceHost.request<SQLiteSessionInfo>({ operation: 'connect-sqlite', sessionId, filePath, accessMode });
    if (result.ok) {
      sessions.set(sessionId, {
        rendererId: event.sender.id,
        sessionId,
        engine: 'sqlite',
        accessMode,
        targetLabel: result.value.fileName,
      });
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
    const engine = sessions.get(sessionId)?.engine;
    return runSessionOperation(sessionId, () => engine === 'mysql'
      ? serviceHost.request<DatabaseSchemaInfo[]>({ operation: 'list-mysql-schemas', sessionId })
      : engine === 'sqlite'
        ? serviceHost.request<DatabaseSchemaInfo[]>({ operation: 'list-sqlite-schemas', sessionId })
        : serviceHost.request<PostgresSchemaInfo[]>({ operation: 'list-schemas', sessionId }));
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
    const engine = sessions.get(request.sessionId)?.engine;
    return runSessionOperation(request.sessionId, () => engine === 'mysql'
      ? serviceHost.request<DatabaseTableInfo[]>({
          operation: 'list-mysql-tables',
          sessionId: request.sessionId,
          schema: request.schema,
        })
      : engine === 'sqlite'
        ? serviceHost.request<DatabaseTableInfo[]>({
            operation: 'list-sqlite-tables',
            sessionId: request.sessionId,
            schema: request.schema,
          })
        : serviceHost.request<PostgresTableInfo[]>({
            operation: 'list-tables',
            sessionId: request.sessionId,
            schema: request.schema,
          }));
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
    const engine = sessions.get(request.sessionId)?.engine;
    return runSessionOperation(request.sessionId, () => engine === 'mysql'
      ? serviceHost.request<DatabaseStructureInfo>({
          operation: 'get-mysql-structure',
          sessionId: request.sessionId,
          schema: request.schema,
          table: request.table,
        })
      : engine === 'sqlite'
        ? serviceHost.request<DatabaseStructureInfo>({
            operation: 'get-sqlite-structure',
            sessionId: request.sessionId,
            schema: request.schema,
            table: request.table,
          })
        : serviceHost.request<PostgresStructureInfo>({
            operation: 'get-structure',
            sessionId: request.sessionId,
            schema: request.schema,
            table: request.table,
          }));
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
    const engine = sessions.get(request.sessionId)?.engine;
    if (!engine) {
      return { ok: false, error: 'not-connected' } satisfies DatabaseBridgeResult<never>;
    }
    if ((engine === 'postgres' && (request.schema.length > 63 || request.table.length > 63))
      || (engine === 'mysql' && (request.schema.length > 64 || request.table.length > 64))
      || (engine === 'sqlite' && (request.schema !== 'main' || request.table.length > 256))
      || (engine !== 'postgres' && request.page.cursor !== null)) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }
    if (engine !== 'postgres') {
      return runSessionOperation(request.sessionId, () => engine === 'mysql'
        ? serviceHost.request<PostgresDataPage>({
            operation: 'get-mysql-data-page',
            sessionId: request.sessionId,
            schema: request.schema,
            table: request.table,
            page: request.page,
          })
        : serviceHost.request<PostgresDataPage>({
            operation: 'get-sqlite-data-page',
            sessionId: request.sessionId,
            schema: request.schema as 'main',
            table: request.table,
            page: request.page,
          }));
    }
    if (activePageRequests.has(request.sessionId)) {
      return { ok: false, error: 'query-failed' } satisfies DatabaseBridgeResult<never>;
    }
    let finishPageRequest!: () => void;
    const pageRequestFinished = new Promise<void>((resolveFinished) => {
      finishPageRequest = resolveFinished;
    });
    const activePage: OwnedPageRequest = {
      rendererId: event.sender.id,
      requestId: request.requestId,
      started: false,
      cancelRequested: false,
      finished: pageRequestFinished,
      finish: finishPageRequest,
    };
    activePageRequests.set(request.sessionId, activePage);
    try {
      return await runSessionOperation(request.sessionId, async () => {
        activePage.started = true;
        if (activePage.cancelRequested) {
          return { ok: false, error: 'query-timeout' } satisfies DatabaseBridgeResult<never>;
        }
        return serviceHost.request<PostgresDataPage>({
          operation: 'get-data-page',
          sessionId: request.sessionId,
          pageRequestId: request.requestId,
          schema: request.schema,
          table: request.table,
          page: request.page,
        });
      });
    }
    finally {
      if (activePageRequests.get(request.sessionId)?.requestId === request.requestId) {
        activePageRequests.delete(request.sessionId);
      }
      activePage.finish();
    }
  });

  ipcMain.handle(QUERY_CHANNEL, async (event, value: unknown) => {
    const request = parseDatabaseQueryRequest(value);
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
    const engine = sessions.get(request.sessionId)?.engine;
    if (!engine) {
      return { ok: false, error: 'not-connected' } satisfies DatabaseBridgeResult<never>;
    }
    const statement = normalizeDatabaseStatement(request.sql, engine);
    if (!statement || (statement.kind !== 'select' && request.offset !== 0)) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }
    const owner = sessions.get(request.sessionId);
    if (statement.kind !== 'select' && owner?.accessMode !== 'read-write') {
      return { ok: false, error: 'write-disabled' } satisfies DatabaseBridgeResult<never>;
    }
    if (activeQueryRequests.has(request.sessionId)) {
      return { ok: false, error: 'query-failed' } satisfies DatabaseBridgeResult<never>;
    }
    let finishQueryRequest!: () => void;
    const queryRequestFinished = new Promise<void>((resolveFinished) => {
      finishQueryRequest = resolveFinished;
    });
    const activeQuery: OwnedQueryRequest = {
      rendererId: event.sender.id,
      requestId: request.requestId,
      started: false,
      cancelRequested: false,
      finished: queryRequestFinished,
      finish: finishQueryRequest,
    };
    activeQueryRequests.set(request.sessionId, activeQuery);
    try {
      return await runSessionOperation(request.sessionId, async () => {
        activeQuery.started = true;
        if (activeQuery.cancelRequested) {
          return { ok: false, error: 'query-timeout' } satisfies DatabaseBridgeResult<never>;
        }
        if (statement.kind !== 'select'
          && !await confirmSqlMutation(event, engine, owner?.targetLabel ?? engine, statement.kind, statement.sql)) {
          return { ok: true, value: { kind: 'cancelled' } } satisfies DatabaseBridgeResult<DatabaseStatementResult>;
        }
        return serviceHost.request<DatabaseStatementResult>({
          operation: 'execute-sql-statement',
          sessionId: request.sessionId,
          engine,
          sql: statement.sql,
          offset: request.offset,
          queryRequestId: request.requestId,
        });
      });
    }
    finally {
      if (activeQueryRequests.get(request.sessionId)?.requestId === request.requestId) {
        activeQueryRequests.delete(request.sessionId);
      }
      activeQuery.finish();
    }
  });

  ipcMain.handle(UPDATE_CELL_CHANNEL, async (event, value: unknown) => {
    const request = parseCellUpdateRequest(value);
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
    const owner = sessions.get(request.sessionId);
    if (!owner) {
      return { ok: false, error: 'not-connected' } satisfies DatabaseBridgeResult<never>;
    }
    const input = request.input;
    if (!isValidCellUpdateInput(input, owner.engine)) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }
    if (owner.accessMode !== 'read-write') {
      return { ok: false, error: 'write-disabled' } satisfies DatabaseBridgeResult<never>;
    }
    return runSessionOperation(request.sessionId, async () => {
      if (!await confirmCellUpdate(event, owner, input)) {
        return { ok: true, value: false } satisfies DatabaseBridgeResult<boolean>;
      }
      return serviceHost.request<boolean>({
        operation: 'update-cell',
        sessionId: request.sessionId,
        engine: owner.engine,
        input,
      });
    });
  });

  ipcMain.handle(BATCH_MUTATION_CHANNEL, async (event, value: unknown) => {
    const request = parseBatchMutationRequest(value);
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
    const owner = sessions.get(request.sessionId);
    if (!owner) {
      return { ok: false, error: 'not-connected' } satisfies DatabaseBridgeResult<never>;
    }
    const input = request.input;
    if (!isValidBatchMutationInput(input, owner.engine)) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }
    if (owner.accessMode !== 'read-write') {
      return { ok: false, error: 'write-disabled' } satisfies DatabaseBridgeResult<never>;
    }
    return runSessionOperation(request.sessionId, async () => {
      if (!await confirmBatchMutation(event, owner, input)) {
        return { ok: true, value: { kind: 'cancelled' } } satisfies DatabaseBridgeResult<DatabaseStatementResult>;
      }
      return serviceHost.request<DatabaseBatchMutationResult>({
        operation: 'batch-mutation',
        sessionId: request.sessionId,
        engine: owner.engine,
        input,
      });
    });
  });

  ipcMain.handle(CANCEL_DATA_PAGE_CHANNEL, async (event, value: unknown) => {
    const request = parseDataPageCancelRequest(value);
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
    const activePage = activePageRequests.get(request.sessionId);
    if (!activePage
      || activePage.rendererId !== event.sender.id
      || activePage.requestId !== request.requestId) {
      return { ok: true, value: false } satisfies DatabaseBridgeResult<boolean>;
    }
    if (!activePage.started) {
      activePage.cancelRequested = true;
      await activePage.finished;
      return { ok: true, value: true } satisfies DatabaseBridgeResult<boolean>;
    }
    const result = await serviceHost.request<boolean>({
      operation: 'cancel-data-page',
      sessionId: request.sessionId,
      targetRequestId: request.requestId,
    });
    await activePage.finished;
    return result;
  });

  ipcMain.handle(CANCEL_QUERY_CHANNEL, async (event, value: unknown) => {
    const request = parseDataPageCancelRequest(value);
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
    const activeQuery = activeQueryRequests.get(request.sessionId);
    if (!activeQuery
      || activeQuery.rendererId !== event.sender.id
      || activeQuery.requestId !== request.requestId) {
      return { ok: true, value: false } satisfies DatabaseBridgeResult<boolean>;
    }
    if (!activeQuery.started) {
      activeQuery.cancelRequested = true;
      await activeQuery.finished;
      return { ok: true, value: true } satisfies DatabaseBridgeResult<boolean>;
    }
    const owner = sessions.get(request.sessionId);
    if (!owner) {
      return { ok: false, error: 'not-connected' } satisfies DatabaseBridgeResult<never>;
    }
    const result = await serviceHost.request<boolean>({
      operation: 'cancel-query',
      sessionId: request.sessionId,
      engine: owner.engine,
      targetRequestId: request.requestId,
    });
    await activeQuery.finished;
    return result;
  });

  ipcMain.handle(LIST_PROFILES_CHANNEL, async (event) => {
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError } satisfies DatabaseBridgeResult<never>;
    }
    return profileStore.list();
  });

  ipcMain.handle(SAVE_PROFILE_CHANNEL, async (event, value: unknown) => {
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError } satisfies DatabaseBridgeResult<never>;
    }
    return profileStore.save(value);
  });

  ipcMain.handle(DELETE_PROFILE_CHANNEL, async (event, value: unknown) => {
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError } satisfies DatabaseBridgeResult<never>;
    }
    const profileId = parseProfileDeleteRequest(value);
    if (!profileId) {
      return { ok: false, error: 'invalid-request' } satisfies DatabaseBridgeResult<never>;
    }
    return profileStore.delete(profileId);
  });

  async function disconnectRendererSession(rendererId: number): Promise<void> {
    const sessionId = rendererSessions.get(rendererId);
    if (sessionId) {
      await disconnectSession(sessionId);
    }
  }

  async function disconnectSession(sessionId: string): Promise<DatabaseBridgeResult<boolean>> {
    const activePage = activePageRequests.get(sessionId);
    if (activePage) {
      if (activePage.started) {
        await serviceHost.request<boolean>({
          operation: 'cancel-data-page',
          sessionId,
          targetRequestId: activePage.requestId,
        });
      }
      else {
        activePage.cancelRequested = true;
      }
      await activePage.finished;
    }
    const owner = sessions.get(sessionId);
    const activeQuery = activeQueryRequests.get(sessionId);
    if (activeQuery) {
      if (activeQuery.started && owner) {
        await serviceHost.request<boolean>({
          operation: 'cancel-query',
          sessionId,
          engine: owner.engine,
          targetRequestId: activeQuery.requestId,
        });
      }
      else {
        activeQuery.cancelRequested = true;
      }
      await activeQuery.finished;
    }
    sessions.delete(sessionId);
    if (owner && rendererSessions.get(owner.rendererId) === sessionId) {
      rendererSessions.delete(owner.rendererId);
    }
    const operation = owner?.engine === 'mysql'
      ? 'disconnect-mysql'
      : owner?.engine === 'sqlite'
        ? 'disconnect-sqlite'
        : 'disconnect';
    return runSessionOperation(sessionId, () => serviceHost.request<boolean>({ operation, sessionId }));
  }

  async function runSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = sessionOperationTails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = previous.then(() => gate);
    sessionOperationTails.set(sessionId, tail);
    await previous;
    try {
      return await operation();
    }
    finally {
      release();
      if (sessionOperationTails.get(sessionId) === tail) {
        sessionOperationTails.delete(sessionId);
      }
    }
  }

  function ownsSession(rendererId: number, sessionId: string): boolean {
    return sessions.get(sessionId)?.rendererId === rendererId;
  }

  async function confirmSqlMutation(
    event: IpcMainInvokeEvent,
    engine: DatabaseEngine,
    targetLabel: string,
    kind: 'insert' | 'update' | 'delete',
    sql: string,
  ): Promise<boolean> {
    const preview = sql.length > 800 ? `${sql.slice(0, 800)}…` : sql;
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'Confirm database write / 确认数据库写入',
      message: `Execute ${kind.toUpperCase()} on ${engine}? / 在 ${engine} 上执行 ${kind.toUpperCase()}？`,
      detail: `Target: ${targetLabel}\nThe statement is limited to 1,000 directly affected rows and runs in a transaction. Triggers and cascades may also have effects.\n目标：${targetLabel}\n语句直接影响的行数上限为 1,000，并在事务中执行。触发器和级联操作也可能产生额外影响。\n\n${preview}`,
      buttons: ['Cancel / 取消', 'Execute write / 执行写入'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const result = parentWindow
        ? await dialog.showMessageBox(parentWindow, options)
        : await dialog.showMessageBox(options);
      return result.response === 1;
    }
    catch {
      return false;
    }
  }

  async function confirmCellUpdate(
    event: IpcMainInvokeEvent,
    owner: OwnedSession,
    input: DatabaseCellUpdateInput,
  ): Promise<boolean> {
    const valueText = (value: string | null) => value === null ? 'NULL' : value.length > 160 ? `${value.slice(0, 160)}…` : value;
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'Confirm cell update / 确认单元格更新',
      message: `Update ${input.schema}.${input.table}.${input.column}? / 更新 ${input.schema}.${input.table}.${input.column}？`,
      detail: `Target: ${owner.targetLabel}\n${valueText(input.originalValue)} → ${valueText(input.newValue)}\n\n目标：${owner.targetLabel}\n${valueText(input.originalValue)} → ${valueText(input.newValue)}`,
      buttons: ['Cancel / 取消', 'Update cell / 更新单元格'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const result = parentWindow
        ? await dialog.showMessageBox(parentWindow, options)
        : await dialog.showMessageBox(options);
      return result.response === 1;
    }
    catch {
      return false;
    }
  }

  async function confirmBatchMutation(
    event: IpcMainInvokeEvent,
    owner: OwnedSession,
    input: DatabaseBatchMutationInput,
  ): Promise<boolean> {
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'Confirm batch write / 确认批量写入',
      message: `Apply ${input.inserts.length} insert and ${input.deletes.length} delete drafts on ${owner.engine}? / 在 ${owner.engine} 上提交 ${input.inserts.length} 条新增和 ${input.deletes.length} 条删除草稿？`,
      detail: `Target: ${owner.targetLabel}\nThe drafts run in one transaction and are limited to 100 rows. Deletes include the loaded row values for conflict checking.\n目标：${owner.targetLabel}\n草稿在一个事务中执行，最多 100 行。删除操作包含读取时的整行值，用于并发冲突检查。`,
      buttons: ['Cancel / 取消', 'Commit batch / 提交批量修改'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const result = parentWindow
        ? await dialog.showMessageBox(parentWindow, options)
        : await dialog.showMessageBox(options);
      return result.response === 1;
    }
    catch {
      return false;
    }
  }

  return {
    closeRenderer(rendererId: number): void {
      void disconnectRendererSession(rendererId);
    },
    shutdown(): void {
      serviceHost.close();
      sessions.clear();
      rendererSessions.clear();
      activePageRequests.clear();
      sessionOperationTails.clear();
      ipcMain.removeHandler(CONNECTION_CHANNEL);
      ipcMain.removeHandler(MYSQL_CONNECTION_CHANNEL);
      ipcMain.removeHandler(SQLITE_CONNECTION_CHANNEL);
      ipcMain.removeHandler(DISCONNECT_CHANNEL);
      ipcMain.removeHandler(SCHEMAS_CHANNEL);
      ipcMain.removeHandler(TABLES_CHANNEL);
      ipcMain.removeHandler(STRUCTURE_CHANNEL);
      ipcMain.removeHandler(DATA_PAGE_CHANNEL);
      ipcMain.removeHandler(QUERY_CHANNEL);
      ipcMain.removeHandler(CANCEL_DATA_PAGE_CHANNEL);
      ipcMain.removeHandler(UPDATE_CELL_CHANNEL);
      ipcMain.removeHandler(BATCH_MUTATION_CHANNEL);
      ipcMain.removeHandler(LIST_PROFILES_CHANNEL);
      ipcMain.removeHandler(SAVE_PROFILE_CHANNEL);
      ipcMain.removeHandler(DELETE_PROFILE_CHANNEL);
    },
  };
}

function parseProfileDeleteRequest(value: unknown): string | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['profileId'])
    || typeof value.profileId !== 'string'
    || !isProfileId(value.profileId)) {
    return null;
  }
  return value.profileId;
}

function isProfileId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getTrustedSenderError(event: IpcMainInvokeEvent, trustedRendererUrl: string): DatabaseErrorCode | null {
  return isTrustedDesktopSender(event, trustedRendererUrl) ? null : 'untrusted-renderer';
}

function parsePostgresConnectionRequest(value: unknown): PostgresConnectionInput | null {
  if (!isRecord(value)
    || (!hasExactKeys(value, ['host', 'port', 'database', 'username', 'password', 'tlsMode'])
      && !hasExactKeys(value, ['host', 'port', 'database', 'username', 'password', 'tlsMode', 'accessMode']))
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
    || (value.tlsMode !== 'verify' && value.tlsMode !== 'disable')
    || (value.accessMode !== undefined && !isDatabaseAccessMode(value.accessMode))) {
    return null;
  }
  return value as unknown as PostgresConnectionInput;
}

function parseMySqlConnectionRequest(value: unknown): MySqlConnectionInput | null {
  if (!isRecord(value)
    || (!hasExactKeys(value, ['host', 'port', 'database', 'username', 'password', 'tlsMode'])
      && !hasExactKeys(value, ['host', 'port', 'database', 'username', 'password', 'tlsMode', 'accessMode']))
    || typeof value.host !== 'string'
    || value.host.trim().length === 0
    || value.host.length > 253
    || typeof value.port !== 'number'
    || !Number.isInteger(value.port)
    || value.port < 1
    || value.port > 65_535
    || typeof value.database !== 'string'
    || !isMySqlIdentifier(value.database)
    || typeof value.username !== 'string'
    || value.username.length === 0
    || value.username.length > 128
    || typeof value.password !== 'string'
    || value.password.length > 4_096
    || (value.tlsMode !== 'verify' && value.tlsMode !== 'disable')
    || (value.accessMode !== undefined && !isDatabaseAccessMode(value.accessMode))) {
    return null;
  }
  return value as unknown as MySqlConnectionInput;
}

function parseSQLiteAccessMode(value: unknown): DatabaseAccessMode | null {
  if (value === undefined) {
    return 'read-only';
  }
  if (isRecord(value) && hasExactKeys(value, ['accessMode']) && isDatabaseAccessMode(value.accessMode)) {
    return value.accessMode;
  }
  return null;
}

function isDatabaseAccessMode(value: unknown): value is DatabaseAccessMode {
  return value === 'read-only' || value === 'read-write';
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
): { sessionId: string; requestId: string; schema: string; table: string; page: PostgresDataPageInput } | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['sessionId', 'requestId', 'schema', 'table', 'page'])
    || typeof value.requestId !== 'string'
    || !isRequestId(value.requestId)
    || typeof value.schema !== 'string'
    || !isAnyDatabaseIdentifier(value.schema)
    || typeof value.table !== 'string'
    || !isAnyDatabaseIdentifier(value.table)
    || !isBoundedPageInput(value.page)) {
    return null;
  }
  const sessionId = parseSessionRequest({ sessionId: value.sessionId });
  return sessionId ? { sessionId, requestId: value.requestId, schema: value.schema, table: value.table, page: value.page } : null;
}

function parseCellUpdateRequest(value: unknown): { sessionId: string; input: unknown } | null {
  if (!isRecord(value) || !hasExactKeys(value, ['sessionId', 'input']) || !isRecord(value.input)) {
    return null;
  }
  const sessionId = parseSessionRequest({ sessionId: value.sessionId });
  return sessionId ? { sessionId, input: value.input } : null;
}

function parseBatchMutationRequest(value: unknown): { sessionId: string; input: unknown } | null {
  if (!isRecord(value) || !hasExactKeys(value, ['sessionId', 'input']) || !isRecord(value.input)) {
    return null;
  }
  const sessionId = parseSessionRequest({ sessionId: value.sessionId });
  return sessionId ? { sessionId, input: value.input } : null;
}

function isAnyDatabaseIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.includes('\u0000');
}

function parseDatabaseQueryRequest(
  value: unknown,
): { sessionId: string; requestId: string; sql: string; offset: number } | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['sessionId', 'requestId', 'sql', 'offset'])
    || typeof value.requestId !== 'string'
    || !isRequestId(value.requestId)
    || typeof value.sql !== 'string'
    || !Number.isInteger(value.offset)
    || (value.offset as number) < 0
    || (value.offset as number) > MAX_QUERY_OFFSET) {
    return null;
  }
  const sessionId = parseSessionRequest({ sessionId: value.sessionId });
  return sessionId ? { sessionId, requestId: value.requestId, sql: value.sql, offset: value.offset as number } : null;
}

function parseDataPageCancelRequest(value: unknown): { sessionId: string; requestId: string } | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['sessionId', 'requestId'])
    || typeof value.requestId !== 'string'
    || !isRequestId(value.requestId)) {
    return null;
  }
  const sessionId = parseSessionRequest({ sessionId: value.sessionId });
  return sessionId ? { sessionId, requestId: value.requestId } : null;
}

function isBoundedPageInput(value: unknown): value is PostgresDataPageInput {
  if (!isValidTablePageRequest(value, isAnyDatabaseIdentifier, true)) {
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

function isRequestId(value: string): boolean {
  return isSessionId(value);
}

function isDatabaseIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 63 && !value.includes('\u0000');
}

function isMySqlIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 64 && !value.includes('\u0000');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
