import type {
  DatabaseBridgeResult,
  DatabaseQueryPage,
  DatabaseSchemaInfo,
  DatabaseStructureInfo,
  DatabaseTableInfo,
  MySqlConnectionInput,
  MySqlSessionInfo,
  PostgresConnectionInput,
  PostgresConnectionProfile,
  PostgresConnectionProfileInput,
  PostgresDataPage,
  PostgresDataPageInput,
  PostgresSessionInfo,
  SQLiteSessionInfo,
} from '../shared/desktop-services/database';

export {};

declare global {
  type DesktopPluginCapability = 'runtime.info' | 'clipboard.write';
  type DesktopPluginOperationResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

  interface DesktopPluginSnapshot {
    pluginId: string;
    name: string;
    version: string;
    requestedCapabilities: readonly string[];
    grantedCapabilities: readonly DesktopPluginCapability[];
    status: 'installed' | 'active' | 'invalid';
    errorCode?: string;
  }

  interface DesktopPluginSignerSnapshot {
    keyId: string;
    fingerprint: string;
    allowedPluginIds: readonly string[];
  }

  interface DesktopPluginSignerInput {
    keyId: string;
    publicKey: string;
    allowedPluginIds: readonly string[];
  }

  interface Window {
    itToolsDesktop?: {
      getRuntimeInfo(): Promise<{
        platform: string;
        version: string;
      }>;
      connectPostgres?(input: PostgresConnectionInput): Promise<DatabaseBridgeResult<PostgresSessionInfo>>;
      connectMySql?(input: MySqlConnectionInput): Promise<DatabaseBridgeResult<MySqlSessionInfo>>;
      connectSQLite?(): Promise<DatabaseBridgeResult<SQLiteSessionInfo | null>>;
      disconnectDatabase?(sessionId: string): Promise<DatabaseBridgeResult<boolean>>;
      listDatabaseSchemas?(sessionId: string): Promise<DatabaseBridgeResult<DatabaseSchemaInfo[]>>;
      listDatabaseTables?(sessionId: string, schema: string): Promise<DatabaseBridgeResult<DatabaseTableInfo[]>>;
      getDatabaseStructure?(
        sessionId: string,
        schema: string,
        table: string,
      ): Promise<DatabaseBridgeResult<DatabaseStructureInfo>>;
      getDatabaseDataPage?(
        sessionId: string,
        requestId: string,
        schema: string,
        table: string,
        page: PostgresDataPageInput,
      ): Promise<DatabaseBridgeResult<PostgresDataPage>>;
      runDatabaseQuery?(
        sessionId: string,
        sql: string,
        offset: number,
      ): Promise<DatabaseBridgeResult<DatabaseQueryPage>>;
      cancelDatabaseDataPage?(sessionId: string, requestId: string): Promise<DatabaseBridgeResult<boolean>>;
      listPostgresProfiles?(): Promise<DatabaseBridgeResult<PostgresConnectionProfile[]>>;
      savePostgresProfile?(
        input: PostgresConnectionProfileInput,
      ): Promise<DatabaseBridgeResult<PostgresConnectionProfile>>;
      deletePostgresProfile?(profileId: string): Promise<DatabaseBridgeResult<boolean>>;
      listPlugins?(): Promise<DesktopPluginOperationResult<DesktopPluginSnapshot[]>>;
      installPluginPackage?(): Promise<DesktopPluginOperationResult<DesktopPluginSnapshot | null>>;
      activatePlugin?(
        pluginId: string,
        version: string,
        grantedCapabilities: readonly DesktopPluginCapability[],
      ): Promise<DesktopPluginOperationResult<DesktopPluginSnapshot | null>>;
      disablePlugin?(pluginId: string): Promise<DesktopPluginOperationResult<boolean>>;
      uninstallPlugin?(pluginId: string, version: string): Promise<DesktopPluginOperationResult<boolean>>;
      listTrustedPluginSigners?(): Promise<DesktopPluginOperationResult<DesktopPluginSignerSnapshot[]>>;
      previewPluginSigner?(input: DesktopPluginSignerInput): Promise<DesktopPluginOperationResult<DesktopPluginSignerSnapshot>>;
      trustPluginSigner?(
        input: DesktopPluginSignerInput,
        confirmedFingerprint: string,
      ): Promise<DesktopPluginOperationResult<DesktopPluginSignerSnapshot | null>>;
      revokePluginSigner?(keyId: string): Promise<DesktopPluginOperationResult<boolean>>;
    };
  }
}
