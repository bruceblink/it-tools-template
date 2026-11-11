import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { StorageConnectInput, StorageConnection, StorageListInput, StoragePage, StoragePreviewInput, StoragePreview, StorageResult, StorageUploadInput, StorageTransferResult, StorageProgress } from '../src/shared/desktop-services/object-storage';
import type {
  ContainerListRequest,
  ContainerWorkbenchResult,
  DockerContainer,
} from '../src/shared/desktop-services/container-workbench';
import type {
  ApiBridgeResult,
  ApiRequestInput,
  ApiResponse,
} from '../src/shared/desktop-services/api';
import type {
  GitBridgeResult,
  GitDiff,
  GitLog,
  GitRepositoryInfo,
  GitStatus,
} from '../src/shared/desktop-services/git';
import {
  isDesktopPluginMarketplaceInstallProgress,
  isDesktopPluginSourceBuildProgress,
  isDesktopPluginStateChangeEvent,
} from '../src/shared/desktop-services/plugins';
import type {
  DesktopPluginMarketplaceInstallInput,
  DesktopPluginMarketplaceInstallProgress,
  DesktopPluginSourceBuildInput,
  DesktopPluginSourceBuildProgress,
  DesktopPluginV2SettingsRequest,
  DesktopPluginV2SettingsSnapshot,
  DesktopPluginV2SettingUpdateRequest,
  DesktopPluginV2Snapshot,
} from '../src/shared/desktop-services/plugins';
import type { DesktopUpdateState } from '../src/shared/desktop-services/updates';
import type { PluginToolCommandResult, PluginToolInputValueMap } from '../src/shared/plugin-tool-workbench';

contextBridge.exposeInMainWorld('itToolsDesktop', Object.freeze({
  updates: Object.freeze({
    getState: () => ipcRenderer.invoke('desktop:updates:state'),
    setAutoCheck: (enabled: boolean) => ipcRenderer.invoke('desktop:updates:auto-check', enabled),
    check: () => ipcRenderer.invoke('desktop:updates:check'),
    download: () => ipcRenderer.invoke('desktop:updates:download'),
    cancel: () => ipcRenderer.invoke('desktop:updates:cancel'),
    install: () => ipcRenderer.invoke('desktop:updates:install'),
    onState: (callback: (state: DesktopUpdateState) => void) => {
      const listener = (_event: IpcRendererEvent, state: DesktopUpdateState) => callback(state);
      ipcRenderer.on('desktop:updates:changed', listener);
      return () => ipcRenderer.removeListener('desktop:updates:changed', listener);
    },
  }),
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:get-runtime-info'),
  connectStorage: (input: StorageConnectInput): Promise<StorageResult<StorageConnection>> =>
    ipcRenderer.invoke('desktop:object-storage:connect', input),
  listStorageObjects: (input: StorageListInput): Promise<StorageResult<StoragePage>> =>
    ipcRenderer.invoke('desktop:object-storage:list', input),
  previewStorageObject: (input: StoragePreviewInput): Promise<StorageResult<StoragePreview>> =>
    ipcRenderer.invoke('desktop:object-storage:preview', input),
  uploadStorageObject: (input: StorageUploadInput): Promise<StorageResult<StorageTransferResult | null>> =>
    ipcRenderer.invoke('desktop:object-storage:upload', input),
  downloadStorageObject: (input: StoragePreviewInput): Promise<StorageResult<StorageTransferResult | null>> =>
    ipcRenderer.invoke('desktop:object-storage:download', input),
  deleteStorageObject: (input: StoragePreviewInput): Promise<StorageResult<boolean>> =>
    ipcRenderer.invoke('desktop:object-storage:delete', input),
  onStorageProgress: (callback: (progress: StorageProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: StorageProgress) => callback(progress);
    ipcRenderer.on('desktop:object-storage:progress', listener);
    return () => ipcRenderer.removeListener('desktop:object-storage:progress', listener);
  },
  cancelStorageRequest: (requestId: string): Promise<StorageResult<boolean>> =>
    ipcRenderer.invoke('desktop:object-storage:cancel', { requestId }),
  disconnectStorage: (): Promise<StorageResult<boolean>> =>
    ipcRenderer.invoke('desktop:object-storage:disconnect'),
  listDockerContainers: (input: ContainerListRequest): Promise<ContainerWorkbenchResult<DockerContainer[]>> =>
    ipcRenderer.invoke('desktop:container-workbench:list', input),
  cancelDockerContainerRequest: (input: ContainerListRequest): Promise<ContainerWorkbenchResult<boolean>> =>
    ipcRenderer.invoke('desktop:container-workbench:cancel', input),
  runApiRequest: (input: ApiRequestInput): Promise<ApiBridgeResult<ApiResponse>> =>
    ipcRenderer.invoke('desktop:api:request', input),
  cancelApiRequest: (requestId: string): Promise<ApiBridgeResult<boolean>> =>
    ipcRenderer.invoke('desktop:api:cancel', { requestId }),
  selectGitRepository: (): Promise<GitBridgeResult<GitRepositoryInfo | null>> =>
    ipcRenderer.invoke('desktop:git:select-repository'),
  getGitStatus: (repositoryId: string, requestId: string): Promise<GitBridgeResult<GitStatus>> =>
    ipcRenderer.invoke('desktop:git:status', { repositoryId, requestId }),
  getGitLog: (repositoryId: string, requestId: string): Promise<GitBridgeResult<GitLog>> =>
    ipcRenderer.invoke('desktop:git:log', { repositoryId, requestId }),
  getGitDiff: (repositoryId: string, requestId: string): Promise<GitBridgeResult<GitDiff>> =>
    ipcRenderer.invoke('desktop:git:diff', { repositoryId, requestId }),
  cancelGitRequest: (requestId: string): Promise<GitBridgeResult<boolean>> =>
    ipcRenderer.invoke('desktop:git:cancel', { requestId }),
  closeGitRepository: (repositoryId: string): Promise<GitBridgeResult<boolean>> =>
    ipcRenderer.invoke('desktop:git:close', { repositoryId }),
  listPlugins: () => ipcRenderer.invoke('desktop:plugins:list'),
  listPluginV2Packages: (): Promise<DesktopPluginOperationResult<DesktopPluginV2Snapshot[]>> =>
    ipcRenderer.invoke('desktop:plugins:v2:list'),
  listPluginV2Settings: (input: DesktopPluginV2SettingsRequest): Promise<DesktopPluginOperationResult<DesktopPluginV2SettingsSnapshot>> =>
    ipcRenderer.invoke('desktop:plugins:v2:settings:list', input),
  updatePluginV2Setting: (input: DesktopPluginV2SettingUpdateRequest): Promise<DesktopPluginOperationResult<DesktopPluginV2SettingsSnapshot>> =>
    ipcRenderer.invoke('desktop:plugins:v2:settings:update', input),
  onPluginStateChanged: (callback: (event: DesktopPluginStateChangeEvent) => void) => {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      if (isDesktopPluginStateChangeEvent(value)) {
        callback(value);
      }
    };
    ipcRenderer.on('desktop:plugins:changed', listener);
    return () => ipcRenderer.removeListener('desktop:plugins:changed', listener);
  },
  installPluginPackage: () => ipcRenderer.invoke('desktop:plugins:install'),
  installPluginV2Package: (): Promise<DesktopPluginOperationResult<DesktopPluginV2Snapshot | null>> =>
    ipcRenderer.invoke('desktop:plugins:v2:install'),
  installPluginFromMarketplace: (input: DesktopPluginMarketplaceInstallInput) =>
    ipcRenderer.invoke('desktop:plugins:install-from-marketplace', input),
  cancelPluginMarketplaceInstall: (requestId: string) =>
    ipcRenderer.invoke('desktop:plugins:install-from-marketplace:cancel', { requestId }),
  onPluginMarketplaceInstallProgress: (callback: (progress: DesktopPluginMarketplaceInstallProgress) => void) => {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      if (isDesktopPluginMarketplaceInstallProgress(value)) {
        callback(value);
      }
    };
    ipcRenderer.on('desktop:plugins:marketplace-progress', listener);
    return () => ipcRenderer.removeListener('desktop:plugins:marketplace-progress', listener);
  },
  buildPluginSource: (input: DesktopPluginSourceBuildInput) =>
    ipcRenderer.invoke('desktop:plugins:build-source', input),
  cancelPluginSourceBuild: (requestId: string) =>
    ipcRenderer.invoke('desktop:plugins:build-source:cancel', { requestId }),
  onPluginSourceBuildProgress: (callback: (progress: DesktopPluginSourceBuildProgress) => void) => {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      if (isDesktopPluginSourceBuildProgress(value)) {
        callback(value);
      }
    };
    ipcRenderer.on('desktop:plugins:source-build-progress', listener);
    return () => ipcRenderer.removeListener('desktop:plugins:source-build-progress', listener);
  },
  activatePlugin: (
    pluginId: string,
    version: string,
    grantedCapabilities: readonly string[],
    contributionId?: string,
  ) => ipcRenderer.invoke('desktop:plugins:activate', {
    pluginId,
    version,
    grantedCapabilities,
    ...(contributionId === undefined ? {} : { contributionId }),
  }),
  disablePlugin: (pluginId: string) => ipcRenderer.invoke('desktop:plugins:disable', { pluginId }),
  uninstallPlugin: (pluginId: string, version: string) =>
    ipcRenderer.invoke('desktop:plugins:uninstall', { pluginId, version }),
  uninstallPluginV2Package: (pluginId: string, version: string): Promise<DesktopPluginOperationResult<boolean>> =>
    ipcRenderer.invoke('desktop:plugins:v2:uninstall', { pluginId, version }),
  executePluginV2Command: (input: {
    requestId: string;
    pluginId: string;
    version: string;
    commandId: string;
    input: PluginToolInputValueMap;
  }): Promise<DesktopPluginOperationResult<PluginToolCommandResult>> =>
    ipcRenderer.invoke('desktop:plugins:v2:execute', input),
  cancelPluginV2Command: (requestId: string): Promise<DesktopPluginOperationResult<boolean>> =>
    ipcRenderer.invoke('desktop:plugins:v2:cancel', { requestId }),
  listTrustedPluginSigners: () => ipcRenderer.invoke('desktop:plugins:trusted-signers:list'),
  previewPluginSigner: (input: unknown) => ipcRenderer.invoke('desktop:plugins:trusted-signers:preview', input),
  trustPluginSigner: (input: unknown, confirmedFingerprint: string) =>
    ipcRenderer.invoke('desktop:plugins:trusted-signers:add', { input, confirmedFingerprint }),
  revokePluginSigner: (keyId: string) => ipcRenderer.invoke('desktop:plugins:trusted-signers:remove', { keyId }),
}));
