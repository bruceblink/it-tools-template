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
import type {
  SystemMonitorBridgeResult,
  SystemMonitorSample,
  SystemMonitorSessionInfo,
} from '../shared/desktop-services/system-monitor';
import type {
  ApiBridgeResult,
  ApiRequestInput,
  ApiResponse,
} from '../shared/desktop-services/api';
import type {
  GitBridgeResult,
  GitDiff,
  GitLog,
  GitRepositoryInfo,
  GitStatus,
} from '../shared/desktop-services/git';
import type { DesktopUpdateBridge } from '../shared/desktop-services/updates';

import type { StorageConnectInput, StorageConnection, StorageListInput, StoragePage, StoragePreviewInput, StoragePreview, StorageResult, StorageUploadInput, StorageTransferResult, StorageProgress } from '../shared/desktop-services/object-storage';
import type {
  ContainerListRequest,
  ContainerWorkbenchResult,
  DockerContainer,
} from '../shared/desktop-services/container-workbench';
import type { ToolCapability, ToolDataProcessing, ToolOfflineSupport } from '../tools/tools.types';
import type { PluginHostCapability } from '../shared/plugin-capabilities';
import type { PluginToolCommandResult, PluginToolInputValueMap } from '../shared/plugin-tool-workbench';
import type {
  DesktopPluginErrorCode as SharedDesktopPluginErrorCode,
  DesktopPluginMarketplaceInstallInput as SharedDesktopPluginMarketplaceInstallInput,
  DesktopPluginMarketplaceInstallProgress as SharedDesktopPluginMarketplaceInstallProgress,
  DesktopPluginMarketplaceInstallResult as SharedDesktopPluginMarketplaceInstallResult,
  DesktopPluginMarketplaceInstallSource as SharedDesktopPluginMarketplaceInstallSource,
  DesktopPluginSourceBuildInput as SharedDesktopPluginSourceBuildInput,
  DesktopPluginSourceBuildProgress as SharedDesktopPluginSourceBuildProgress,
  DesktopPluginSourceBuildResult as SharedDesktopPluginSourceBuildResult,
  DesktopPluginInstallSource as SharedDesktopPluginInstallSource,
  DesktopPluginSourceSnapshotInstallSource as SharedDesktopPluginSourceSnapshotInstallSource,
  DesktopPluginOperationResult as SharedDesktopPluginOperationResult,
  DesktopPluginV2Snapshot as SharedDesktopPluginV2Snapshot,
  DesktopPluginRuntimeFailureCode,
  DesktopPluginStateChangeEvent as SharedDesktopPluginStateChangeEvent,
} from '../shared/desktop-services/plugins';

export {};

declare global {
  type DesktopPluginCapability = PluginHostCapability;
  type DesktopPluginErrorCode = SharedDesktopPluginErrorCode;
  type DesktopPluginMarketplaceInstallInput = SharedDesktopPluginMarketplaceInstallInput;
  type DesktopPluginMarketplaceInstallProgress = SharedDesktopPluginMarketplaceInstallProgress;
  type DesktopPluginMarketplaceInstallResult = SharedDesktopPluginMarketplaceInstallResult<DesktopPluginSnapshot>;
  type DesktopPluginMarketplaceInstallSource = SharedDesktopPluginMarketplaceInstallSource;
  type DesktopPluginSourceBuildInput = SharedDesktopPluginSourceBuildInput;
  type DesktopPluginSourceBuildProgress = SharedDesktopPluginSourceBuildProgress;
  type DesktopPluginSourceBuildResult = SharedDesktopPluginSourceBuildResult<DesktopPluginSnapshot>;
  type DesktopPluginSourceSnapshotInstallSource = SharedDesktopPluginSourceSnapshotInstallSource;
  type DesktopPluginInstallSource = SharedDesktopPluginInstallSource;
  type DesktopPluginOperationResult<T> = SharedDesktopPluginOperationResult<T>;
  type DesktopPluginV2Snapshot = SharedDesktopPluginV2Snapshot;
  type DesktopPluginStateChangeEvent = SharedDesktopPluginStateChangeEvent;

  interface DesktopPluginSnapshot {
    pluginId: string;
    name: string;
    version: string;
    requestedCapabilities: readonly string[];
    /** Capability IDs that the current Electron host can execute. */
    supportedCapabilities: readonly DesktopPluginCapability[];
    contributions: {
      tools: readonly DesktopPluginToolContribution[];
    };
    grantedCapabilities: readonly DesktopPluginCapability[];
    /** Provenance recorded for a Release or fixed source snapshot install. */
    source?: DesktopPluginInstallSource;
    status: 'installed' | 'active' | 'invalid';
    activeContributionId?: string;
    /** Embedded renderer target used by the current desktop tool route. */
    embedded?: {
      readonly url: string;
      readonly partition: string;
    };
    errorCode?: DesktopPluginErrorCode | DesktopPluginRuntimeFailureCode;
  }

  interface DesktopPluginToolContribution {
    id: string;
    title: string;
    description: string;
    keywords: readonly string[];
    route: string;
    dataProcessing: ToolDataProcessing;
    offline: ToolOfflineSupport;
    capabilities: readonly ToolCapability[];
    /** Runtime failure recorded for this tool contribution only. */
    errorCode?: DesktopPluginRuntimeFailureCode;
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
      updates?: DesktopUpdateBridge;
      connectStorage?(input: StorageConnectInput): Promise<StorageResult<StorageConnection>>;
      listStorageObjects?(input: StorageListInput): Promise<StorageResult<StoragePage>>;
      previewStorageObject?(input: StoragePreviewInput): Promise<StorageResult<StoragePreview>>;
      uploadStorageObject?(input: StorageUploadInput): Promise<StorageResult<StorageTransferResult | null>>;
      downloadStorageObject?(input: StoragePreviewInput): Promise<StorageResult<StorageTransferResult | null>>;
      deleteStorageObject?(input: StoragePreviewInput): Promise<StorageResult<boolean>>;
      onStorageProgress?(callback: (progress: StorageProgress) => void): () => void;
      listDockerContainers?(input: ContainerListRequest): Promise<ContainerWorkbenchResult<DockerContainer[]>>;
      cancelDockerContainerRequest?(input: ContainerListRequest): Promise<ContainerWorkbenchResult<boolean>>;
      cancelStorageRequest?(requestId: string): Promise<StorageResult<boolean>>;
      disconnectStorage?(): Promise<StorageResult<boolean>>;
      getRuntimeInfo(): Promise<{
        platform: string;
        version: string;
      }>;
      connectPostgres?(input: PostgresConnectionInput): Promise<DatabaseBridgeResult<PostgresSessionInfo>>;
      connectMySql?(input: MySqlConnectionInput): Promise<DatabaseBridgeResult<MySqlSessionInfo>>;
      connectSQLite?(accessMode: DatabaseAccessMode): Promise<DatabaseBridgeResult<SQLiteSessionInfo | null>>;
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
      updateDatabaseCell?(
        sessionId: string,
        input: DatabaseCellUpdateInput,
      ): Promise<DatabaseBridgeResult<boolean>>;
      applyDatabaseBatchMutation?(
        sessionId: string,
        input: DatabaseBatchMutationInput,
      ): Promise<DatabaseBridgeResult<DatabaseBatchMutationResponse>>;
      runDatabaseQuery?(
        sessionId: string,
        requestId: string,
        sql: string,
        offset: number,
      ): Promise<DatabaseBridgeResult<DatabaseStatementResult>>;
      cancelDatabaseDataPage?(sessionId: string, requestId: string): Promise<DatabaseBridgeResult<boolean>>;
      cancelDatabaseQuery?(sessionId: string, requestId: string): Promise<DatabaseBridgeResult<boolean>>;
      listPostgresProfiles?(): Promise<DatabaseBridgeResult<PostgresConnectionProfile[]>>;
      savePostgresProfile?(
        input: PostgresConnectionProfileInput,
      ): Promise<DatabaseBridgeResult<PostgresConnectionProfile>>;
      deletePostgresProfile?(profileId: string): Promise<DatabaseBridgeResult<boolean>>;
      runApiRequest?(input: ApiRequestInput): Promise<ApiBridgeResult<ApiResponse>>;
      cancelApiRequest?(requestId: string): Promise<ApiBridgeResult<boolean>>;
      selectGitRepository?(): Promise<GitBridgeResult<GitRepositoryInfo | null>>;
      getGitStatus?(repositoryId: string, requestId: string): Promise<GitBridgeResult<GitStatus>>;
      getGitLog?(repositoryId: string, requestId: string): Promise<GitBridgeResult<GitLog>>;
      getGitDiff?(repositoryId: string, requestId: string): Promise<GitBridgeResult<GitDiff>>;
      cancelGitRequest?(requestId: string): Promise<GitBridgeResult<boolean>>;
      closeGitRepository?(repositoryId: string): Promise<GitBridgeResult<boolean>>;
      startSystemMonitor?(intervalMs?: number): Promise<SystemMonitorBridgeResult<SystemMonitorSessionInfo>>;
      setSystemMonitorPaused?(
        subscriptionId: string,
        paused: boolean,
      ): Promise<SystemMonitorBridgeResult<boolean>>;
      refreshSystemMonitor?(subscriptionId: string): Promise<SystemMonitorBridgeResult<boolean>>;
      stopSystemMonitor?(subscriptionId: string): Promise<SystemMonitorBridgeResult<boolean>>;
      onSystemMonitorSample?(callback: (sample: SystemMonitorSample) => void): () => void;
      listPlugins?(): Promise<DesktopPluginOperationResult<DesktopPluginSnapshot[]>>;
      listPluginV2Packages?(): Promise<DesktopPluginOperationResult<DesktopPluginV2Snapshot[]>>;
      onPluginStateChanged?(callback: (event: DesktopPluginStateChangeEvent) => void): () => void;
      installPluginPackage?(): Promise<DesktopPluginOperationResult<DesktopPluginSnapshot | null>>;
      installPluginV2Package?(): Promise<DesktopPluginOperationResult<DesktopPluginV2Snapshot | null>>;
      installPluginFromMarketplace?(
        input: DesktopPluginMarketplaceInstallInput,
      ): Promise<DesktopPluginOperationResult<DesktopPluginMarketplaceInstallResult>>;
      cancelPluginMarketplaceInstall?(
        requestId: string,
      ): Promise<DesktopPluginOperationResult<boolean>>;
      onPluginMarketplaceInstallProgress?(
        callback: (progress: DesktopPluginMarketplaceInstallProgress) => void,
      ): () => void;
      buildPluginSource?(
        input: DesktopPluginSourceBuildInput,
      ): Promise<DesktopPluginOperationResult<DesktopPluginSourceBuildResult>>;
      cancelPluginSourceBuild?(requestId: string): Promise<DesktopPluginOperationResult<boolean>>;
      onPluginSourceBuildProgress?(callback: (progress: DesktopPluginSourceBuildProgress) => void): () => void;
      activatePlugin?(
        pluginId: string,
        version: string,
        grantedCapabilities: readonly DesktopPluginCapability[],
        contributionId?: string,
      ): Promise<DesktopPluginOperationResult<DesktopPluginSnapshot | null>>;
      disablePlugin?(pluginId: string): Promise<DesktopPluginOperationResult<boolean>>;
      uninstallPlugin?(pluginId: string, version: string): Promise<DesktopPluginOperationResult<boolean>>;
      uninstallPluginV2Package?(pluginId: string, version: string): Promise<DesktopPluginOperationResult<boolean>>;
      executePluginV2Command?(input: {
        requestId: string;
        pluginId: string;
        version: string;
        commandId: string;
        input: PluginToolInputValueMap;
      }): Promise<DesktopPluginOperationResult<PluginToolCommandResult>>;
      cancelPluginV2Command?(requestId: string): Promise<DesktopPluginOperationResult<boolean>>;
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
