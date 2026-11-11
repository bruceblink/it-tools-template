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
import type { PluginToolCommandResult, PluginToolInputValueMap } from '../shared/plugin-tool-workbench';
import type {
  DesktopPluginErrorCode as SharedDesktopPluginErrorCode,
  DesktopPluginMarketplaceInstallInput as SharedDesktopPluginMarketplaceInstallInput,
  DesktopPluginMarketplaceInstallProgress as SharedDesktopPluginMarketplaceInstallProgress,
  DesktopPluginMarketplaceInstallResult as SharedDesktopPluginMarketplaceInstallResult,
  DesktopPluginMarketplaceInstallSource as SharedDesktopPluginMarketplaceInstallSource,
  DesktopPluginOperationResult as SharedDesktopPluginOperationResult,
  DesktopPluginV2Snapshot as SharedDesktopPluginV2Snapshot,
  DesktopPluginV2SettingsRequest as SharedDesktopPluginV2SettingsRequest,
  DesktopPluginV2SettingsSnapshot as SharedDesktopPluginV2SettingsSnapshot,
  DesktopPluginV2SettingUpdateRequest as SharedDesktopPluginV2SettingUpdateRequest,
  DesktopPluginV2SettingSnapshot as SharedDesktopPluginV2SettingSnapshot,
  DesktopPluginStateChangeEvent as SharedDesktopPluginStateChangeEvent,
} from '../shared/desktop-services/plugins';

export {};

declare global {
  type DesktopPluginErrorCode = SharedDesktopPluginErrorCode;
  type DesktopPluginMarketplaceInstallInput = SharedDesktopPluginMarketplaceInstallInput;
  type DesktopPluginMarketplaceInstallProgress = SharedDesktopPluginMarketplaceInstallProgress;
  type DesktopPluginMarketplaceInstallResult = SharedDesktopPluginMarketplaceInstallResult<DesktopPluginV2Snapshot>;
  type DesktopPluginMarketplaceInstallSource = SharedDesktopPluginMarketplaceInstallSource;
  type DesktopPluginOperationResult<T> = SharedDesktopPluginOperationResult<T>;
  type DesktopPluginV2Snapshot = SharedDesktopPluginV2Snapshot;
  type DesktopPluginV2SettingsRequest = SharedDesktopPluginV2SettingsRequest;
  type DesktopPluginV2SettingsSnapshot = SharedDesktopPluginV2SettingsSnapshot;
  type DesktopPluginV2SettingUpdateRequest = SharedDesktopPluginV2SettingUpdateRequest;
  type DesktopPluginV2SettingSnapshot = SharedDesktopPluginV2SettingSnapshot;
  type DesktopPluginStateChangeEvent = SharedDesktopPluginStateChangeEvent;

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
      runApiRequest?(input: ApiRequestInput): Promise<ApiBridgeResult<ApiResponse>>;
      cancelApiRequest?(requestId: string): Promise<ApiBridgeResult<boolean>>;
      selectGitRepository?(): Promise<GitBridgeResult<GitRepositoryInfo | null>>;
      getGitStatus?(repositoryId: string, requestId: string): Promise<GitBridgeResult<GitStatus>>;
      getGitLog?(repositoryId: string, requestId: string): Promise<GitBridgeResult<GitLog>>;
      getGitDiff?(repositoryId: string, requestId: string): Promise<GitBridgeResult<GitDiff>>;
      cancelGitRequest?(requestId: string): Promise<GitBridgeResult<boolean>>;
      closeGitRepository?(repositoryId: string): Promise<GitBridgeResult<boolean>>;
      listPluginV2Packages?(): Promise<DesktopPluginOperationResult<DesktopPluginV2Snapshot[]>>;
      listPluginV2Settings?(
        input: DesktopPluginV2SettingsRequest,
      ): Promise<DesktopPluginOperationResult<DesktopPluginV2SettingsSnapshot>>;
      updatePluginV2Setting?(
        input: DesktopPluginV2SettingUpdateRequest,
      ): Promise<DesktopPluginOperationResult<DesktopPluginV2SettingsSnapshot>>;
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
