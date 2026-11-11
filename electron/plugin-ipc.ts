import { resolve } from 'node:path';
import {
  app,
  dialog,
  ipcMain,
  net,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import { PluginPackageError } from './plugin-package-manifest';
import type { PluginPackageSigningKey } from './plugin-package';
import { isTrustedDesktopSender } from './plugin-ipc-security';
import { PluginSettingsStore } from './plugin-settings-store';
import { PluginTrustStore, PluginTrustStoreError } from './plugin-trust-store';
import type { PluginSignerInput } from './plugin-trust-store';
import { PluginMarketplaceInstallError } from './plugin-marketplace-installer';
import { PluginMarketplaceInstallController } from './plugin-marketplace-controller';
import { createMarketplaceReleaseFetcher } from './plugin-marketplace-download';
import { ExternalPluginV2PackageManager } from './external-plugin-v2-package-manager';
import type { ExternalPluginV2PackageSnapshot } from './external-plugin-v2-package-manager';
import { ExternalPluginV2CommandRequests } from './external-plugin-v2-command-requests';
import { createExternalPluginV2CapabilityPolicy, ExternalPluginV2CapabilityPolicyError } from './external-plugin-v2-capability-policy';
import { ExternalExtensionRpcError, ExternalExtensionRpcHost } from './external-extension-rpc';
import { createExternalExtensionProcessTransport } from './external-extension-process';
import {
  ExternalPluginV2DataError,
  readExternalPluginV2ToolData,
} from './external-plugin-v2-data';
import { createExternalPluginV2OuiReader } from './external-plugin-v2-oui';
import {
  readExternalPluginV2Settings,
  readExternalPluginV2ToolSettings,
  writeExternalPluginV2Setting,
} from './external-plugin-v2-settings';
import type {
  DesktopPluginErrorCode,
  DesktopPluginV2RuntimeFailureCode,
  DesktopPluginMarketplaceInstallProgress,
  DesktopPluginOperationResult,
  DesktopPluginV2SettingUpdateRequest,
  DesktopPluginV2SettingsRequest,
} from '../src/shared/desktop-services/plugins';
import {
  isPluginToolCommandResult,
  type PluginToolCommandResult,
  type PluginToolInputValueMap,
} from '../src/shared/plugin-tool-workbench';
import type {
  ExternalExtensionCapabilityContext,
  ExternalExtensionRpcJsonValue,
} from '../src/shared/desktop-services/external-extension-rpc';
import type {
  ExternalPluginV2SettingDeclaration,
  ExternalPluginV2SettingValue,
  ExternalPluginV2DataProviderDeclaration,
} from '../src/shared/external-plugin-v2';

export interface PluginIpcDependencies {
  userDataRoot: string;
  getMainWindow: () => BrowserWindow | null;
  getTrustedRendererUrl: () => string;
}

export interface PluginLifecycleIpc {
  /** Stop active plugin windows while keeping IPC handlers available for host window reopen. */
  stopActivePlugins: () => Promise<void>;
  /** Stop active plugin renderers before the Electron app exits. */
  shutdown: () => Promise<void>;
}

type MarketplacePluginSnapshot = ExternalPluginV2PackageSnapshot;

class PluginIpcInputError extends Error {
  constructor(readonly code: DesktopPluginErrorCode = 'invalid-request', message = 'The plugin management request is invalid.') {
    super(message);
    this.name = 'PluginIpcInputError';
  }
}

const marketplaceRequestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

/** Load signer trust and expose a narrow IPC surface to the trusted desktop renderer. */
export async function registerPluginLifecycleIpc(dependencies: PluginIpcDependencies): Promise<PluginLifecycleIpc> {
  const signingKeys = new Map<string, PluginPackageSigningKey>();
  const trustStore = new PluginTrustStore(resolve(dependencies.userDataRoot, 'plugins', 'trusted-keys.json'), signingKeys);
  const pluginSettingsStore = new PluginSettingsStore(resolve(dependencies.userDataRoot, 'plugins', 'settings.json'));
  const externalPluginV2OuiReader = createExternalPluginV2OuiReader({
    baseDirectory: resolve(app.getAppPath(), 'out/renderer/assets/oui-data'),
  });
  try {
    await trustStore.load();
  }
  catch {
    console.error('The plugin trust store could not be loaded. External plugin installation is disabled.');
  }
  try {
    await pluginSettingsStore.load();
  }
  catch {
    console.error('The plugin settings store could not be loaded. Plugin settings are disabled.');
  }

  const v2PackageManager = new ExternalPluginV2PackageManager({
    installRoot: resolve(dependencies.userDataRoot, 'plugins', 'v2-packages'),
    hostApiVersion: '2.0.0',
    trustedSigningKeys: signingKeys,
    onStateChange: event => {
      const mainWindow = dependencies.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send('desktop:plugins:changed', {
        schemaVersion: 1,
        ...event,
      });
    },
  });
  const v2Hosts = new Map<string, ExternalExtensionRpcHost>();
  const activeV2Commands = new ExternalPluginV2CommandRequests();
  // 卸载期间阻止同一包启动新进程，直到已确认退出并完成文件删除。
  const v2Uninstalling = new Set<string>();
  // 首版只允许一个 WASM 进程；进程确认退出后才释放名额。
  let v2WorkerBusy = false;
  const fetchReleaseAsset = createMarketplaceReleaseFetcher(net);
  const marketplaceController = new PluginMarketplaceInstallController<MarketplacePluginSnapshot>({
    tempRoot: resolve(dependencies.userDataRoot, 'plugins', '.marketplace-downloads'),
    fetch: (url, init) => net.fetch(url, init),
    fetchReleaseAsset,
    installArchive: archivePath => v2PackageManager.installArchive(archivePath),
  });
  ipcMain.handle('desktop:plugins:v2:list', event => runPluginManagementIpc(
    event,
    dependencies,
    () => v2PackageManager.listInstalled(),
  ));
  ipcMain.handle('desktop:plugins:v2:settings:list', (event, value: unknown) => runPluginManagementIpc(
    event,
    dependencies,
    async () => {
      const request = parseExternalPluginV2SettingsRequest(value);
      assertV2PackageNotUninstalling(v2Uninstalling, request);
      const execution = await v2PackageManager.getInstalledExecutionContext(request.pluginId, request.version);
      return readExternalPluginV2Settings(execution.manifest, pluginSettingsStore);
    },
  ));
  ipcMain.handle('desktop:plugins:v2:settings:update', (event, value: unknown) => runPluginManagementIpc(
    event,
    dependencies,
    async () => {
      const request = parseExternalPluginV2SettingUpdateRequest(value);
      assertV2PackageNotUninstalling(v2Uninstalling, request);
      const execution = await v2PackageManager.getInstalledExecutionContext(request.pluginId, request.version);
      const setting = execution.manifest.contributions.settings?.find(candidate => candidate.id === request.settingId);
      if (!setting || !isValidExternalPluginV2SettingValue(setting, request.value)) {
        throw new PluginIpcInputError('invalid-request', 'The v2 plugin setting is not declared or has an invalid value.');
      }
      return writeExternalPluginV2Setting(execution.manifest, request.settingId, request.value, pluginSettingsStore);
    },
  ));
  ipcMain.handle('desktop:plugins:v2:install', event => runPluginManagementIpc(event, dependencies, async () => {
    const selection = await dialog.showOpenDialog(getPluginManagementWindow(dependencies), {
      title: 'Install a signed v2 plugin package / 安装 v2 已签名插件包',
      properties: ['openFile'],
      filters: [{ name: 'IT Tools v2 plugin package', extensions: ['itxs'] }],
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      return null;
    }
    return v2PackageManager.installArchive(selection.filePaths[0]!);
  }));
  ipcMain.handle('desktop:plugins:v2:execute', (event, value: unknown) => runPluginManagementIpc(event, dependencies, async () => {
    const request = parseExternalPluginV2CommandRequest(value);
    if (v2Uninstalling.has(`${request.pluginId}@${request.version}`)) {
      throw new PluginIpcInputError('active-limit', 'The requested v2 plugin package is being uninstalled.');
    }
    const activeRequest = activeV2Commands.register(request.requestId, request);
    if (!activeRequest) {
      throw new PluginIpcInputError('invalid-request', 'The v2 command request ID is already active.');
    }
    let host: ExternalExtensionRpcHost | undefined;
    let ownsWorkerSlot = false;
    let phase = 'verify';
    try {
      if (v2WorkerBusy) {
        throw new PluginIpcInputError('active-limit', 'Another v2 extension command is still running or stopping.');
      }
      v2WorkerBusy = true;
      ownsWorkerSlot = true;
      const execution = await v2PackageManager.getInstalledExecutionContext(request.pluginId, request.version);
      throwIfV2CommandAborted(activeRequest.controller.signal);
      const { manifest } = execution;
      if (manifest.runtime !== 'wasm') {
        throw new PluginIpcInputError('unsupported-runtime', 'The v2 process runtime is not available.');
      }
      const command = manifest.contributions.commands.find(candidate => candidate.id === request.commandId);
      if (!command) {
        throw new PluginIpcInputError('invalid-request', 'The v2 plugin command is not declared.');
      }
      const tool = command.toolId === undefined
        ? undefined
        : manifest.contributions.tools.find(candidate => candidate.id === command.toolId);
      const requestedPolicy = createExternalPluginV2CapabilityPolicy(manifest, []);
      const requestedCapabilities = tool ? requestedPolicy.getToolCapabilities(tool.id) : [];
      throwIfV2CommandAborted(activeRequest.controller.signal);
      if (requestedCapabilities.length > 0) {
        if (requestedCapabilities.some(capability => (
          capability !== 'runtime.info'
          && capability !== 'settings.read'
          && capability !== 'data.oui'
        ))) {
          throw new ExternalPluginV2CapabilityPolicyError('unsupported-capability');
        }
        const approved = await confirmExternalPluginV2Capabilities(
          dependencies,
          manifest.id,
          manifest.name,
          tool!.title,
          requestedCapabilities,
          tool?.settings ?? [],
          manifest.contributions.settings ?? [],
          tool?.dataProviders ?? [],
          manifest.contributions.dataProviders ?? [],
        );
        if (!approved) {
          throw new ExternalPluginV2CapabilityPolicyError('permission-denied');
        }
      }
      throwIfV2CommandAborted(activeRequest.controller.signal);
      const policy = createExternalPluginV2CapabilityPolicy(manifest, requestedCapabilities);
      const grantedCapabilities = tool ? policy.authorizeTool(tool.id) : [];
      const settings = grantedCapabilities.includes('settings.read') && tool
        ? await readExternalPluginV2ToolSettings(manifest, tool, pluginSettingsStore)
        : undefined;
      const data = grantedCapabilities.includes('data.oui') && tool
        ? await readExternalPluginV2ToolData(
            manifest,
            tool,
            request.input,
            externalPluginV2OuiReader,
            activeRequest.controller.signal,
          )
        : undefined;
      const capabilityContext: ExternalExtensionCapabilityContext | undefined = grantedCapabilities.includes('runtime.info') || settings !== undefined || data !== undefined
        ? {
            ...(grantedCapabilities.includes('runtime.info') ? { runtimeInfo: { platform: process.platform, appVersion: app.getVersion() } } : {}),
            ...(settings === undefined ? {} : { settings }),
            ...(data === undefined ? {} : { data }),
          }
        : undefined;
      const key = `${request.pluginId}@${request.version}`;
      host = new ExternalExtensionRpcHost({
        pluginId: request.pluginId,
        version: request.version,
        grantedCapabilities: policy.grantedCapabilities,
        maximumConcurrentRequests: 1,
        transport: createExternalExtensionProcessTransport({
          pluginId: request.pluginId,
          workerPath: resolve(app.getAppPath(), 'out/main/external-extension-worker.cjs'),
          terminateOnCancel: true,
          launchConfig: {
            pluginId: request.pluginId,
            version: request.version,
            packageRoot: execution.packageRoot,
            entrypoint: execution.entrypoint,
            entrypointSha256: execution.entrypointSha256,
          },
          onStopped: () => {
            v2Hosts.delete(key);
            v2WorkerBusy = false;
          },
        }),
      });
      v2Hosts.set(key, host);
      phase = 'activate';
      await host.activate(activeRequest.controller.signal);
      phase = 'execute';
      const result = await host.executeCommand(
        request.commandId,
        request.input as ExternalExtensionRpcJsonValue,
        grantedCapabilities,
        activeRequest.controller.signal,
        capabilityContext,
      );
      const parsedResult = parsePluginToolCommandResult(result);
      v2PackageManager.clearRuntimeFailure(request.pluginId, request.version);
      return parsedResult;
    }
    catch (error) {
      const runtimeFailureCode = getExternalPluginV2RuntimeFailureCode(error, phase);
      if (runtimeFailureCode !== undefined) {
        v2PackageManager.markRuntimeFailure(request.pluginId, request.version, runtimeFailureCode);
      }
      console.warn('V2 plugin command failed.', {
        pluginId: request.pluginId,
        version: request.version,
        phase,
        code: error instanceof ExternalExtensionRpcError ? error.code : getPluginOperationErrorCode(error),
      });
      throw error;
    }
    finally {
      try {
        if (host) {
          await host.dispose();
        }
        else if (ownsWorkerSlot) {
          v2WorkerBusy = false;
        }
      }
      catch (error) {
        // 清理超时不应覆盖命令结果；进程退出回调仍负责释放运行名额。
        console.warn('V2 plugin host cleanup failed.', {
          pluginId: request.pluginId,
          version: request.version,
          code: error instanceof ExternalExtensionRpcError ? error.code : getPluginOperationErrorCode(error),
        });
      }
      finally {
        // 即使进程停止超时，也释放请求 ID，避免活动请求表残留。
        activeV2Commands.release(request.requestId, activeRequest);
      }
    }
  }));
  ipcMain.handle('desktop:plugins:v2:cancel', (event, value: unknown) => runPluginManagementIpc(
    event,
    dependencies,
    () => {
      const requestId = parseExternalPluginV2CancelRequest(value);
      return activeV2Commands.cancel(requestId);
    },
  ));
  ipcMain.handle('desktop:plugins:install-from-marketplace', (event, value: unknown) => runPluginManagementIpc(
    event,
    dependencies,
    () => {
      const input = parseMarketplaceInstallRequest(value);
      return marketplaceController.start(input, progress => sendMarketplaceProgress(event.sender, progress));
    },
  ));
  ipcMain.handle('desktop:plugins:install-from-marketplace:cancel', (event, value: unknown) => runPluginManagementIpc(
    event,
    dependencies,
    () => marketplaceController.cancel(parseMarketplaceCancelRequest(value)),
  ));
  ipcMain.handle('desktop:plugins:v2:uninstall', (event, value: unknown) => runPluginManagementIpc(event, dependencies, async () => {
    const request = parsePluginVersionRequest(value);
    const key = `${request.pluginId}@${request.version}`;
    if (v2Uninstalling.has(key)) {
      throw new PluginIpcInputError('active-limit', 'The requested v2 plugin package is already being uninstalled.');
    }
    v2Uninstalling.add(key);
    try {
      activeV2Commands.abortPackage(request.pluginId, request.version);
      await disposeV2Host(v2Hosts, request.pluginId, request.version);
      return await v2PackageManager.uninstall(request.pluginId, request.version);
    }
    finally {
      v2Uninstalling.delete(key);
    }
  }));
  ipcMain.handle('desktop:plugins:trusted-signers:list', event => runPluginManagementIpc(
    event,
    dependencies,
    () => trustStore.list(),
  ));
  ipcMain.handle('desktop:plugins:trusted-signers:preview', (event, value: unknown) => runPluginManagementIpc(
    event,
    dependencies,
    () => trustStore.preview(parsePluginSignerInput(value)),
  ));
  ipcMain.handle('desktop:plugins:trusted-signers:add', (event, value: unknown) => runPluginManagementIpc(event, dependencies, async () => {
    const request = parseTrustSignerRequest(value);
    const preview = trustStore.preview(request.input);
    if (request.confirmedFingerprint !== preview.fingerprint) {
      throw new PluginTrustStoreError('trust-confirmation-required', 'The signer fingerprint changed after preview.');
    }
    const confirmation = await dialog.showMessageBox(getPluginManagementWindow(dependencies), {
      type: 'warning',
      title: 'Trust plugin signer / 信任插件签名者',
      message: `Trust key ${preview.keyId} for ${preview.allowedPluginIds.join(', ')}?`,
      detail: `Fingerprint: ${preview.fingerprint}\n\nA valid signature confirms package origin and integrity. It does not prove that plugin code is safe. Plugin capabilities still require separate approval.\n\n有效签名只能确认包的来源和完整性，不能证明代码安全。插件仍需单独取得系统能力授权。`,
      buttons: ['Trust signer / 信任签名者', 'Cancel / 取消'],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirmation.response !== 0) {
      return null;
    }
    return trustStore.add(request.input, request.confirmedFingerprint);
  }));
  ipcMain.handle('desktop:plugins:trusted-signers:remove', (event, value: unknown) => runPluginManagementIpc(event, dependencies, async () => {
    const keyId = parseKeyIdRequest(value);
    const signer = trustStore.list().find(entry => entry.keyId === keyId);
    if (!signer) {
      return false;
    }
    const confirmation = await dialog.showMessageBox(getPluginManagementWindow(dependencies), {
      type: 'warning',
      title: 'Revoke plugin signer / 撤销插件签名者',
      message: `Revoke key ${signer.keyId}?`,
      detail: `Fingerprint: ${signer.fingerprint}\n\nActive plugins signed by this key will stop. / 使用此密钥签名的运行中插件会停止。`,
      buttons: ['Revoke and stop plugins / 撤销并停止插件', 'Cancel / 取消'],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirmation.response !== 0) {
      return false;
    }
    return trustStore.remove(keyId);
  }));

  return {
    stopActivePlugins: async () => {
      activeV2Commands.abortAll();
      const hostsToStop = snapshotV2Hosts(v2Hosts);
      await disposeAllV2Hosts(hostsToStop);
    },
    shutdown: async () => {
      await marketplaceController.dispose();
      activeV2Commands.abortAll();
      ipcMain.removeHandler('desktop:plugins:install-from-marketplace');
      ipcMain.removeHandler('desktop:plugins:install-from-marketplace:cancel');
      ipcMain.removeHandler('desktop:plugins:v2:list');
      ipcMain.removeHandler('desktop:plugins:v2:settings:list');
      ipcMain.removeHandler('desktop:plugins:v2:settings:update');
      ipcMain.removeHandler('desktop:plugins:v2:install');
      ipcMain.removeHandler('desktop:plugins:v2:execute');
      ipcMain.removeHandler('desktop:plugins:v2:cancel');
      ipcMain.removeHandler('desktop:plugins:v2:uninstall');
      await disposeAllV2Hosts(v2Hosts);
    },
  };
}

/** 每次执行只向用户申请该工具声明的只读能力，不保存授权结果。 */
async function confirmExternalPluginV2Capabilities(
  dependencies: PluginIpcDependencies,
  pluginId: string,
  pluginName: string,
  toolTitle: string,
  capabilities: readonly string[],
  settingIds: readonly string[],
  settingDeclarations: readonly ExternalPluginV2SettingDeclaration[],
  dataProviderIds: readonly { readonly id: string; readonly queryInputId?: string }[],
  dataProviderDeclarations: readonly ExternalPluginV2DataProviderDeclaration[],
): Promise<boolean> {
  const settingLabels = new Map(settingDeclarations.map(setting => [setting.id, setting.label]));
  const dataProviderLabels = new Map(dataProviderDeclarations.map(provider => [provider.id, provider.label]));
  const capabilityDetails = capabilities.map(capability => {
    if (capability === 'runtime.info') {
      return '- Read platform and app version / 读取运行平台和应用版本';
    }
    if (capability === 'settings.read') {
      const labels = settingIds.map(settingId => settingLabels.get(settingId) ?? settingId);
      const suffix = labels.length > 0 ? ` (${labels.join(', ')})` : '';
      return `- Read this plugin's settings${suffix} / 读取此插件的设置${suffix}`;
    }
    if (capability === 'data.oui') {
      const labels = dataProviderIds.map(provider => dataProviderLabels.get(provider.id) ?? provider.id);
      const suffix = labels.length > 0 ? ` (${labels.join(', ')})` : '';
      return `- Read host OUI data${suffix} / 读取宿主 OUI 数据${suffix}`;
    }
    return `- ${capability}`;
  }).join('\n');
  const confirmation = await dialog.showMessageBox(getPluginManagementWindow(dependencies), {
    type: 'warning',
    title: 'Plugin capability request / 插件能力请求',
    message: `${pluginName} (${pluginId}) requests read-only capabilities for ${toolTitle}.`,
    detail: `${capabilityDetails}\n\nApproval applies only to this command. / 本次授权仅对当前命令有效。`,
    buttons: ['Allow once / 本次允许', 'Cancel / 取消'],
    defaultId: 1,
    cancelId: 1,
  });
  return confirmation.response === 0;
}

async function runPluginManagementIpc<T>(
  event: IpcMainInvokeEvent,
  dependencies: PluginIpcDependencies,
  operation: () => Promise<T> | T,
): Promise<DesktopPluginOperationResult<T>> {
  if (!isTrustedDesktopSender(event, dependencies.getTrustedRendererUrl())) {
    return { ok: false, error: 'untrusted-renderer' };
  }
  try {
    return { ok: true, value: await operation() };
  }
  catch (error) {
    return { ok: false, error: getPluginOperationErrorCode(error) };
  }
}

function getPluginManagementWindow(dependencies: PluginIpcDependencies): BrowserWindow {
  const window = dependencies.getMainWindow();
  if (!window || window.isDestroyed()) {
    throw new PluginIpcInputError('window-unavailable', 'The desktop window is not available.');
  }
  return window;
}

function getPluginOperationErrorCode(error: unknown): DesktopPluginErrorCode {
  if (error instanceof PluginIpcInputError) {
    return error.code;
  }
  if (error instanceof ExternalExtensionRpcError) {
    // 只公开 RPC 的超时与取消分类；其他运行时细节统一折叠为普通失败。
    return error.code === 'timeout' || error.code === 'cancelled' ? error.code : 'operation-failed';
  }
  if (error instanceof ExternalPluginV2CapabilityPolicyError) {
    return error.code === 'unsupported-capability' ? 'unsupported-capability' : 'permission-denied';
  }
  if (error instanceof ExternalPluginV2DataError) {
    if (error.code === 'query-invalid') {
      return 'data-query-invalid';
    }
    if (error.code === 'provider-invalid') {
      return 'data-provider-invalid';
    }
    if (error.code === 'resource-limit') {
      return 'data-resource-limit';
    }
    if (error.code === 'integrity-mismatch') {
      return 'data-integrity-mismatch';
    }
    if (error.code === 'timeout') {
      return 'data-timeout';
    }
    if (error.code === 'cancelled') {
      return 'data-cancelled';
    }
    return 'data-provider-unavailable';
  }
  if (error instanceof PluginPackageError || error instanceof PluginTrustStoreError || error instanceof PluginMarketplaceInstallError) {
    return error.code;
  }
  return 'operation-failed';
}

/** 只把扩展宿主或返回协议故障记录为可重试的 v2 不可用状态。 */
function getExternalPluginV2RuntimeFailureCode(
  error: unknown,
  phase: string,
): DesktopPluginV2RuntimeFailureCode | undefined {
  if (error instanceof ExternalExtensionRpcError) {
    if (error.code === 'transport-error'
      || error.code === 'extension-failed'
      || error.code === 'timeout') {
      return error.code;
    }
    return undefined;
  }
  // invalid-request、权限拒绝和其他入口校验失败不能让工具进入不可用状态。
  if (phase === 'execute' && error instanceof PluginIpcInputError && error.code === 'operation-failed') {
    return 'protocol-error';
  }
  return undefined;
}

function parseMarketplaceInstallRequest(value: unknown): DesktopPluginMarketplaceInstallInput {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['requestId', 'owner', 'name'])
    || typeof value.requestId !== 'string'
    || typeof value.owner !== 'string'
    || typeof value.name !== 'string'
    || !marketplaceRequestIdPattern.test(value.requestId)
  ) {
    throw new PluginIpcInputError();
  }
  return { requestId: value.requestId, owner: value.owner, name: value.name };
}

function parseMarketplaceCancelRequest(value: unknown): string {
  if (!isRecord(value)
    || !hasExactKeys(value, ['requestId'])
    || typeof value.requestId !== 'string'
    || !marketplaceRequestIdPattern.test(value.requestId)) {
    throw new PluginIpcInputError();
  }
  return value.requestId;
}

function sendMarketplaceProgress(
  sender: WebContents,
  progress: DesktopPluginMarketplaceInstallProgress,
): void {
  if (sender.isDestroyed()) {
    return;
  }
  try {
    sender.send('desktop:plugins:marketplace-progress', progress);
  }
  catch {
    // The installation owns cleanup; a closed renderer only loses progress updates.
  }
}

function parsePluginVersionRequest(value: unknown): { pluginId: string; version: string } {
  if (!isRecord(value)
    || !hasExactKeys(value, ['pluginId', 'version'])
    || typeof value.pluginId !== 'string'
    || typeof value.version !== 'string') {
    throw new PluginIpcInputError();
  }
  return { pluginId: value.pluginId, version: value.version };
}

function parseExternalPluginV2SettingsRequest(value: unknown): DesktopPluginV2SettingsRequest {
  if (!isRecord(value)
    || !hasExactKeys(value, ['pluginId', 'version'])
    || typeof value.pluginId !== 'string'
    || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value.pluginId)
    || typeof value.version !== 'string'
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version)) {
    throw new PluginIpcInputError();
  }
  return { pluginId: value.pluginId, version: value.version };
}

/** 设置更新入口只接受有限标量；声明类型和数值范围由已验签清单再次校验。 */
function parseExternalPluginV2SettingUpdateRequest(value: unknown): DesktopPluginV2SettingUpdateRequest {
  if (!isRecord(value)
    || !hasExactKeys(value, ['pluginId', 'version', 'settingId', 'value'])
    || typeof value.pluginId !== 'string'
    || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value.pluginId)
    || typeof value.version !== 'string'
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version)
    || typeof value.settingId !== 'string'
    || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.settingId)
    || !value.settingId.startsWith(`${value.pluginId}/`)
    || !isExternalPluginV2SettingValue(value.value)) {
    throw new PluginIpcInputError();
  }
  return {
    pluginId: value.pluginId,
    version: value.version,
    settingId: value.settingId,
    value: value.value,
  };
}

/** 设置读写与卸载共用同一包级互斥边界，避免返回即将删除的数据。 */
function assertV2PackageNotUninstalling(
  uninstalling: ReadonlySet<string>,
  request: DesktopPluginV2SettingsRequest,
): void {
  if (uninstalling.has(`${request.pluginId}@${request.version}`)) {
    throw new PluginIpcInputError('active-limit', 'The requested v2 plugin package is being uninstalled.');
  }
}

function isExternalPluginV2SettingValue(value: unknown): value is ExternalPluginV2SettingValue {
  return typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function isValidExternalPluginV2SettingValue(
  declaration: ExternalPluginV2SettingDeclaration,
  value: ExternalPluginV2SettingValue,
): boolean {
  if (declaration.type === 'string') {
    return typeof value === 'string' && value.length <= (declaration.maxLength ?? 4_096);
  }
  if (declaration.type === 'boolean') {
    return typeof value === 'boolean';
  }
  return typeof value === 'number'
    && Number.isFinite(value)
    && (declaration.integer !== true || Number.isSafeInteger(value))
    && (declaration.minimum === undefined || value >= declaration.minimum)
    && (declaration.maximum === undefined || value <= declaration.maximum);
}

function parseExternalPluginV2CommandRequest(value: unknown): {
  requestId: string;
  pluginId: string;
  version: string;
  commandId: string;
  input: PluginToolInputValueMap;
} {
  if (!isRecord(value)
    || !hasExactKeys(value, ['requestId', 'pluginId', 'version', 'commandId', 'input'])
    || typeof value.requestId !== 'string'
    || !/^[A-Za-z0-9_-]{1,64}$/.test(value.requestId)
    || typeof value.pluginId !== 'string'
    || typeof value.version !== 'string'
    || typeof value.commandId !== 'string'
    || !isPluginToolInputMap(value.input)) {
    throw new PluginIpcInputError();
  }
  return {
    requestId: value.requestId,
    pluginId: value.pluginId,
    version: value.version,
    commandId: value.commandId,
    input: value.input,
  };
}

function parseExternalPluginV2CancelRequest(value: unknown): string {
  if (!isRecord(value)
    || !hasExactKeys(value, ['requestId'])
    || typeof value.requestId !== 'string'
    || !/^[A-Za-z0-9_-]{1,64}$/.test(value.requestId)) {
    throw new PluginIpcInputError();
  }
  return value.requestId;
}

function throwIfV2CommandAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ExternalExtensionRpcError('cancelled');
  }
}

function isPluginToolInputMap(value: unknown): value is PluginToolInputValueMap {
  return isRecord(value) && Object.values(value).every(item => (
    item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
  ));
}

function parsePluginToolCommandResult(value: ExternalExtensionRpcJsonValue | undefined): PluginToolCommandResult {
  if (!isPluginToolCommandResult(value)) {
    throw new PluginIpcInputError('operation-failed', 'The v2 extension returned an invalid command result.');
  }
  return value;
}

async function disposeV2Host(hosts: Map<string, ExternalExtensionRpcHost>, pluginId: string, version: string): Promise<void> {
  const key = `${pluginId}@${version}`;
  const host = hosts.get(key);
  if (!host) {
    return;
  }
  // 保留宿主映射直到真实进程退出；等待超时后，后续卸载仍可继续等待。
  await host.dispose();
}

/** 固定停止开始时的宿主集合，避免等待其他生命周期任务时处理后来启动的宿主。 */
export function snapshotV2Hosts(
  hosts: ReadonlyMap<string, ExternalExtensionRpcHost>,
): Map<string, ExternalExtensionRpcHost> {
  return new Map(hosts);
}

export async function disposeAllV2Hosts(hosts: ReadonlyMap<string, ExternalExtensionRpcHost>): Promise<void> {
  const activeHosts = [...hosts.values()];
  // 退出回调负责移除已停止的宿主；超时的宿主留在表中，便于诊断和重试。
  await Promise.all(activeHosts.map(host => host.dispose()));
}

function parsePluginSignerInput(value: unknown): PluginSignerInput {
  if (!isRecord(value)
    || !hasExactKeys(value, ['keyId', 'publicKey', 'allowedPluginIds'])
    || typeof value.keyId !== 'string'
    || typeof value.publicKey !== 'string'
    || !Array.isArray(value.allowedPluginIds)
    || value.allowedPluginIds.some(pluginId => typeof pluginId !== 'string')) {
    throw new PluginIpcInputError();
  }
  return {
    keyId: value.keyId,
    publicKey: value.publicKey,
    allowedPluginIds: value.allowedPluginIds as string[],
  };
}

function parseTrustSignerRequest(value: unknown): { input: PluginSignerInput; confirmedFingerprint: string } {
  if (!isRecord(value)
    || !hasExactKeys(value, ['input', 'confirmedFingerprint'])
    || typeof value.confirmedFingerprint !== 'string') {
    throw new PluginIpcInputError();
  }
  return { input: parsePluginSignerInput(value.input), confirmedFingerprint: value.confirmedFingerprint };
}

function parseKeyIdRequest(value: unknown): string {
  if (!isRecord(value) || !hasExactKeys(value, ['keyId']) || typeof value.keyId !== 'string') {
    throw new PluginIpcInputError();
  }
  return value.keyId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
