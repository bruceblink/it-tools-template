import { contextBridge, ipcRenderer } from 'electron';
import type {
  DatabaseBridgeResult,
  DatabaseAccessMode,
  DatabaseCellUpdateInput,
  DatabaseStatementResult,
  MySqlConnectionInput,
  PostgresConnectionInput,
  PostgresConnectionProfileInput,
  PostgresDataPageInput,
  SQLiteSessionInfo,
} from '../src/shared/desktop-services/database';

contextBridge.exposeInMainWorld('itToolsDesktop', Object.freeze({
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:get-runtime-info'),
  connectPostgres: (input: PostgresConnectionInput) => ipcRenderer.invoke('desktop:database:postgres:connect', input),
  connectMySql: (input: MySqlConnectionInput) => ipcRenderer.invoke('desktop:database:mysql:connect', input),
  connectSQLite: (accessMode: DatabaseAccessMode): Promise<DatabaseBridgeResult<SQLiteSessionInfo | null>> =>
    ipcRenderer.invoke('desktop:database:sqlite:connect', { accessMode }),
  disconnectDatabase: (sessionId: string) => ipcRenderer.invoke('desktop:database:disconnect', { sessionId }),
  listDatabaseSchemas: (sessionId: string) => ipcRenderer.invoke('desktop:database:schemas', { sessionId }),
  listDatabaseTables: (sessionId: string, schema: string) =>
    ipcRenderer.invoke('desktop:database:tables', { sessionId, schema }),
  getDatabaseStructure: (sessionId: string, schema: string, table: string) =>
    ipcRenderer.invoke('desktop:database:structure', { sessionId, schema, table }),
  getDatabaseDataPage: (sessionId: string, requestId: string, schema: string, table: string, page: PostgresDataPageInput) =>
    ipcRenderer.invoke('desktop:database:data-page', { sessionId, requestId, schema, table, page }),
  updateDatabaseCell: (sessionId: string, input: DatabaseCellUpdateInput): Promise<DatabaseBridgeResult<boolean>> =>
    ipcRenderer.invoke('desktop:database:cell:update', { sessionId, input }),
  runDatabaseQuery: (sessionId: string, requestId: string, sql: string, offset: number): Promise<DatabaseBridgeResult<DatabaseStatementResult>> =>
    ipcRenderer.invoke('desktop:database:query', { sessionId, requestId, sql, offset }),
  cancelDatabaseDataPage: (sessionId: string, requestId: string) =>
    ipcRenderer.invoke('desktop:database:data-page:cancel', { sessionId, requestId }),
  cancelDatabaseQuery: (sessionId: string, requestId: string) =>
    ipcRenderer.invoke('desktop:database:query:cancel', { sessionId, requestId }),
  listPostgresProfiles: () => ipcRenderer.invoke('desktop:database:postgres-profiles:list'),
  savePostgresProfile: (input: PostgresConnectionProfileInput) =>
    ipcRenderer.invoke('desktop:database:postgres-profiles:save', input),
  deletePostgresProfile: (profileId: string) =>
    ipcRenderer.invoke('desktop:database:postgres-profiles:delete', { profileId }),
  listPlugins: () => ipcRenderer.invoke('desktop:plugins:list'),
  installPluginPackage: () => ipcRenderer.invoke('desktop:plugins:install'),
  activatePlugin: (pluginId: string, version: string, grantedCapabilities: readonly string[]) =>
    ipcRenderer.invoke('desktop:plugins:activate', { pluginId, version, grantedCapabilities }),
  disablePlugin: (pluginId: string) => ipcRenderer.invoke('desktop:plugins:disable', { pluginId }),
  uninstallPlugin: (pluginId: string, version: string) =>
    ipcRenderer.invoke('desktop:plugins:uninstall', { pluginId, version }),
  listTrustedPluginSigners: () => ipcRenderer.invoke('desktop:plugins:trusted-signers:list'),
  previewPluginSigner: (input: unknown) => ipcRenderer.invoke('desktop:plugins:trusted-signers:preview', input),
  trustPluginSigner: (input: unknown, confirmedFingerprint: string) =>
    ipcRenderer.invoke('desktop:plugins:trusted-signers:add', { input, confirmedFingerprint }),
  revokePluginSigner: (keyId: string) => ipcRenderer.invoke('desktop:plugins:trusted-signers:remove', { keyId }),
}));
