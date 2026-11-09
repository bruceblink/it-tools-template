import { resolve } from 'node:path';
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  net,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import { PluginLifecycleError, PluginLifecycleManager, pluginLifecycleCapabilities } from './plugin-lifecycle';
import { PluginPackageError } from './plugin-package-manifest';
import type { PluginPackageManifest, PluginPackageSigningKey } from './plugin-package';
import type { PluginCapabilityCall } from './plugin-capability-broker';
import { pluginHostApiVersion } from './plugin-api-v1';
import { isTrustedDesktopSender } from './plugin-ipc-security';
import { createPluginSandboxWindow } from './plugin-sandbox';
import { PluginSettingsStore } from './plugin-settings-store';
import { PluginTrustStore, PluginTrustStoreError } from './plugin-trust-store';
import type { PluginSignerInput } from './plugin-trust-store';
import { PluginMarketplaceInstallError } from './plugin-marketplace-installer';
import { PluginMarketplaceInstallController } from './plugin-marketplace-controller';
import { createMarketplaceReleaseFetcher } from './plugin-marketplace-download';
import {
  PluginSourceBuildController,
  PluginSourceBuildControllerError,
} from './plugin-source-build-controller';
import type {
  DesktopPluginErrorCode,
  DesktopPluginMarketplaceInstallInput,
  DesktopPluginMarketplaceInstallProgress,
  DesktopPluginOperationResult,
  DesktopPluginSourceBuildInput,
  DesktopPluginSourceBuildProgress,
} from '../src/shared/desktop-services/plugins';

export interface PluginIpcDependencies {
  userDataRoot: string;
  getMainWindow: () => BrowserWindow | null;
  getTrustedRendererUrl: () => string;
  onPluginWebContentsCreated: (contents: WebContents, pluginId: string) => void;
}

export interface PluginLifecycleIpc {
  /** Stop active plugin renderers before the Electron app exits. */
  shutdown: () => Promise<void>;
}

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

  const lifecycleManager = new PluginLifecycleManager({
    installRoot: resolve(dependencies.userDataRoot, 'plugins', 'packages'),
    hostApiVersion: pluginHostApiVersion,
    trustedSigningKeys: signingKeys,
    createWindow: registration => createPluginSandboxWindow(registration, dependencies.onPluginWebContentsCreated),
    executeCapability: (manifest, call, signal) => executePluginCapability(manifest, call, pluginSettingsStore, signal),
    onStateChange: event => {
      const mainWindow = dependencies.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send('desktop:plugins:changed', event);
    },
  });
  const fetchReleaseAsset = createMarketplaceReleaseFetcher(net);
  const marketplaceController = new PluginMarketplaceInstallController({
    tempRoot: resolve(dependencies.userDataRoot, 'plugins', '.marketplace-downloads'),
    fetch: (url, init) => net.fetch(url, init),
    fetchReleaseAsset,
    installArchive: (archivePath, source) => lifecycleManager.installArchive(archivePath, source),
  });
  const sourceBuildController = new PluginSourceBuildController({
    tempRoot: resolve(dependencies.userDataRoot, 'plugins', '.source-builds'),
    fetch: (url, init) => net.fetch(url, init),
    selectPrivateKey: async signal => {
      if (signal.aborted) {
        return null;
      }
      const window = getPluginManagementWindow(dependencies);
      return selectPrivateKeyPath(window, signal);
    },
    installPackage: (archivePath, source) => lifecycleManager.installArchive(archivePath, source),
  });

  ipcMain.handle('desktop:plugins:list', event => runPluginManagementIpc(
    event,
    dependencies,
    () => lifecycleManager.listInstalled(),
  ));
  ipcMain.handle('desktop:plugins:install', event => runPluginManagementIpc(event, dependencies, async () => {
    const selection = await dialog.showOpenDialog(getPluginManagementWindow(dependencies), {
      title: 'Install a signed plugin package / 安装已签名的插件包',
      properties: ['openFile'],
      filters: [{ name: 'IT Tools plugin package', extensions: ['itplugin'] }],
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      return null;
    }
    return lifecycleManager.installArchive(selection.filePaths[0]!);
  }));
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
  ipcMain.handle('desktop:plugins:build-source', (event, value: unknown) => runPluginManagementIpc(
    event,
    dependencies,
    async () => {
      const input = parseSourceBuildRequest(value);
      const result = await sourceBuildController.start(
        input,
        progress => sendSourceBuildProgress(event.sender, progress),
      );
      return { snapshot: result.snapshot, source: result.source };
    },
  ));
  ipcMain.handle('desktop:plugins:build-source:cancel', (event, value: unknown) => runPluginManagementIpc(
    event,
    dependencies,
    () => sourceBuildController.cancel(parseMarketplaceCancelRequest(value)),
  ));
  ipcMain.handle('desktop:plugins:activate', (event, value: unknown) => runPluginManagementIpc(event, dependencies, async () => {
    const request = parseActivationRequest(value);
    const installed = await lifecycleManager.listInstalled();
    const target = installed.find(plugin => plugin.pluginId === request.pluginId && plugin.version === request.version);
    if (!target || target.status === 'invalid') {
      throw new PluginLifecycleError('not-installed', 'The requested signed plugin version is not available.');
    }
    if (request.grantedCapabilities.some(capability => (
      !target.requestedCapabilities.includes(capability)
      || !pluginLifecycleCapabilities.includes(capability as typeof pluginLifecycleCapabilities[number])
    ))) {
      throw new PluginLifecycleError('unsupported-capability', 'The selected capability is not requested and supported.');
    }
    if (request.contributionId !== undefined && !target.contributions.tools.some(tool => tool.id === request.contributionId)) {
      throw new PluginLifecycleError('contribution-not-found', 'The requested tool contribution is not available.');
    }

    const grants = await confirmPluginCapabilities(dependencies, request.pluginId, request.grantedCapabilities);
    if (grants === null) {
      return null;
    }
    return lifecycleManager.activate(request.pluginId, request.version, grants, request.contributionId);
  }));
  ipcMain.handle('desktop:plugins:disable', (event, value: unknown) => runPluginManagementIpc(event, dependencies, async () => {
    return lifecycleManager.disable(parsePluginIdRequest(value));
  }));
  ipcMain.handle('desktop:plugins:uninstall', (event, value: unknown) => runPluginManagementIpc(event, dependencies, async () => {
    const request = parsePluginVersionRequest(value);
    const installed = await lifecycleManager.listInstalled();
    const target = installed.find(plugin => plugin.pluginId === request.pluginId && plugin.version === request.version);
    if (!target) {
      return false;
    }
    const confirmation = await dialog.showMessageBox(getPluginManagementWindow(dependencies), {
      type: 'warning',
      title: 'Remove plugin version / 移除插件版本',
      message: `Remove ${target.name} (${target.pluginId}) version ${target.version}?`,
      detail: 'This removes only the selected installed version. / 此操作只删除所选的已安装版本。',
      buttons: ['Remove / 移除', 'Cancel / 取消'],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirmation.response !== 0) {
      return false;
    }
    return lifecycleManager.uninstall(request.pluginId, request.version);
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
    await lifecycleManager.disableSignedByKey(keyId);
    return trustStore.remove(keyId);
  }));

  return {
    shutdown: async () => {
      await marketplaceController.dispose();
      await sourceBuildController.dispose();
      ipcMain.removeHandler('desktop:plugins:install-from-marketplace');
      ipcMain.removeHandler('desktop:plugins:install-from-marketplace:cancel');
      ipcMain.removeHandler('desktop:plugins:build-source');
      ipcMain.removeHandler('desktop:plugins:build-source:cancel');
      await lifecycleManager.shutdown();
    },
  };
}

async function confirmPluginCapabilities(
  dependencies: PluginIpcDependencies,
  pluginId: string,
  requestedGrants: readonly string[],
): Promise<readonly string[] | null> {
  if (requestedGrants.length === 0) {
    return [];
  }
  const details = requestedGrants.map((capability) => {
    if (capability === 'runtime.info') {
      return '- Runtime information (platform and app version) / 运行时信息（平台和应用版本）';
    }
    if (capability === 'clipboard.write') {
      return '- Write text to the system clipboard / 写入系统剪贴板';
    }
    if (capability === 'settings.read') {
      return '- Read this plugin\'s saved settings / 读取此插件的已保存设置';
    }
    if (capability === 'settings.write') {
      return '- Save this plugin\'s settings / 保存此插件的设置';
    }
    return `- ${capability}`;
  }).join('\n');
  const confirmation = await dialog.showMessageBox(getPluginManagementWindow(dependencies), {
    type: 'warning',
    title: 'Plugin capability request / 插件能力请求',
    message: `${pluginId} requests the following capabilities:`,
    detail: `${details}\n\nGranting a capability lets this plugin use it until its window closes. / 授权后，此插件可在窗口关闭前使用这些能力。`,
    buttons: ['Grant selected / 授权所选能力', 'Run without capabilities / 不授权运行', 'Cancel / 取消'],
    defaultId: 2,
    cancelId: 2,
  });
  if (confirmation.response === 0) {
    return requestedGrants;
  }
  return confirmation.response === 1 ? [] : null;
}

async function executePluginCapability(
  manifest: PluginPackageManifest,
  call: PluginCapabilityCall,
  settingsStore: PluginSettingsStore,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) {
    throw new Error('The plugin capability request was aborted.');
  }
  if (call.capability === 'runtime.info') {
    return { platform: process.platform, version: app.getVersion() };
  }
  if (call.capability === 'clipboard.write') {
    // The broker validates the requested grant and text length before this OS clipboard write.
    clipboard.writeText(call.input.text);
    return { written: true };
  }
  if (call.capability === 'settings.read') {
    const value = await settingsStore.read(manifest.id, call.input.key);
    if (signal.aborted) {
      throw new Error('The plugin capability request was aborted.');
    }
    return value === undefined ? { found: false } : { found: true, value };
  }
  if (call.capability === 'settings.write' && call.operation === 'set') {
    const result = await settingsStore.write(manifest.id, call.input.key, call.input.value);
    if (signal.aborted) {
      throw new Error('The plugin capability request was aborted.');
    }
    return result;
  }
  if (call.capability === 'settings.write' && call.operation === 'delete') {
    const result = await settingsStore.delete(manifest.id, call.input.key);
    if (signal.aborted) {
      throw new Error('The plugin capability request was aborted.');
    }
    return result;
  }
  throw new Error('The host does not implement this plugin capability.');
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
  if (
    error instanceof PluginLifecycleError
    || error instanceof PluginPackageError
    || error instanceof PluginTrustStoreError
    || error instanceof PluginMarketplaceInstallError
    || error instanceof PluginSourceBuildControllerError
  ) {
    return error.code;
  }
  return 'operation-failed';
}

function parseActivationRequest(value: unknown): {
  pluginId: string;
  version: string;
  grantedCapabilities: string[];
  contributionId?: string;
} {
  if (!isRecord(value)
    || (!hasExactKeys(value, ['pluginId', 'version', 'grantedCapabilities'])
      && !hasExactKeys(value, ['pluginId', 'version', 'grantedCapabilities', 'contributionId']))
    || typeof value.pluginId !== 'string'
    || typeof value.version !== 'string'
    || !Array.isArray(value.grantedCapabilities)
    || value.grantedCapabilities.length > pluginLifecycleCapabilities.length
    || value.grantedCapabilities.some(capability => typeof capability !== 'string')
    || (value.contributionId !== undefined && typeof value.contributionId !== 'string')) {
    throw new PluginIpcInputError();
  }
  return {
    pluginId: value.pluginId,
    version: value.version,
    grantedCapabilities: value.grantedCapabilities as string[],
    ...(value.contributionId === undefined ? {} : { contributionId: value.contributionId }),
  };
}

function parsePluginIdRequest(value: unknown): string {
  if (!isRecord(value) || !hasExactKeys(value, ['pluginId']) || typeof value.pluginId !== 'string') {
    throw new PluginIpcInputError();
  }
  return value.pluginId;
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

function parseSourceBuildRequest(value: unknown): DesktopPluginSourceBuildInput {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['requestId', 'owner', 'name', 'commitSha', 'keyId'])
    || typeof value.requestId !== 'string'
    || typeof value.owner !== 'string'
    || typeof value.name !== 'string'
    || typeof value.commitSha !== 'string'
    || typeof value.keyId !== 'string'
    || !marketplaceRequestIdPattern.test(value.requestId)
  ) {
    throw new PluginIpcInputError();
  }
  return {
    requestId: value.requestId,
    owner: value.owner,
    name: value.name,
    commitSha: value.commitSha,
    keyId: value.keyId,
  };
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

function sendSourceBuildProgress(
  sender: WebContents,
  progress: DesktopPluginSourceBuildProgress,
): void {
  if (sender.isDestroyed()) {
    return;
  }
  try {
    sender.send('desktop:plugins:source-build-progress', progress);
  }
  catch {
    // The build owns cleanup; a closed renderer only loses progress updates.
  }
}

/** Let cancellation release the build while a native key dialog is still open. */
function selectPrivateKeyPath(window: BrowserWindow, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) {
    return Promise.resolve(null);
  }
  const dialogOperation = dialog.showOpenDialog(window, {
    title: 'Select external plugin signing key / 选择外部插件签名私钥',
    properties: ['openFile'],
    filters: [{ name: 'PEM private key', extensions: ['pem', 'key'] }],
  });
  return new Promise<string | null>((resolvePromise, rejectPromise) => {
    let settled = false;
    const onAbort = () => resolveOnce(null);
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    function resolveOnce(value: string | null): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolvePromise(value);
    }
    function rejectOnce(error: unknown): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    }
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
    void dialogOperation.then(
      selection => {
        if (selection.canceled || selection.filePaths.length === 0) {
          resolveOnce(null);
        }
        else {
          resolveOnce(selection.filePaths[0]!);
        }
      },
      error => rejectOnce(error),
    );
  });
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
