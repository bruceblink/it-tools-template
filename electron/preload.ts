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
import type {
  SystemMonitorBridgeResult,
  SystemMonitorSample,
  SystemMonitorSessionInfo,
} from '../src/shared/desktop-services/system-monitor';

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
  startSystemMonitor: (intervalMs?: number): Promise<SystemMonitorBridgeResult<SystemMonitorSessionInfo>> =>
    ipcRenderer.invoke('desktop:system-monitor:start', intervalMs === undefined ? undefined : { intervalMs }),
  setSystemMonitorPaused: (subscriptionId: string, paused: boolean): Promise<SystemMonitorBridgeResult<boolean>> =>
    ipcRenderer.invoke('desktop:system-monitor:pause', { subscriptionId, paused }),
  refreshSystemMonitor: (subscriptionId: string): Promise<SystemMonitorBridgeResult<boolean>> =>
    ipcRenderer.invoke('desktop:system-monitor:refresh', { subscriptionId }),
  stopSystemMonitor: (subscriptionId: string): Promise<SystemMonitorBridgeResult<boolean>> =>
    ipcRenderer.invoke('desktop:system-monitor:stop', { subscriptionId }),
  onSystemMonitorSample: (callback: (sample: SystemMonitorSample) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, sample: SystemMonitorSample) => callback(sample);
    ipcRenderer.on('desktop:system-monitor:sample', listener);
    return () => ipcRenderer.removeListener('desktop:system-monitor:sample', listener);
  },
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
