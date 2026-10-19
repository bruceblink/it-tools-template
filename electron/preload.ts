import { contextBridge, ipcRenderer } from 'electron';
import type { PostgresConnectionInput, PostgresDataPageInput } from '../src/shared/desktop-services/database';

contextBridge.exposeInMainWorld('itToolsDesktop', Object.freeze({
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:get-runtime-info'),
  connectPostgres: (input: PostgresConnectionInput) => ipcRenderer.invoke('desktop:database:postgres:connect', input),
  disconnectDatabase: (sessionId: string) => ipcRenderer.invoke('desktop:database:disconnect', { sessionId }),
  listDatabaseSchemas: (sessionId: string) => ipcRenderer.invoke('desktop:database:schemas', { sessionId }),
  listDatabaseTables: (sessionId: string, schema: string) =>
    ipcRenderer.invoke('desktop:database:tables', { sessionId, schema }),
  getDatabaseStructure: (sessionId: string, schema: string, table: string) =>
    ipcRenderer.invoke('desktop:database:structure', { sessionId, schema, table }),
  getDatabaseDataPage: (sessionId: string, schema: string, table: string, page: PostgresDataPageInput) =>
    ipcRenderer.invoke('desktop:database:data-page', { sessionId, schema, table, page }),
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
