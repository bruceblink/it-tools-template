import { resolve } from 'node:path';
import {
  app,
  clipboard,
  dialog,
  ipcMain,
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
import type {
  DesktopPluginErrorCode,
  DesktopPluginOperationResult,
} from '../src/shared/desktop-services/plugins';

export interface PluginIpcDependencies {
  userDataRoot: string;
  getMainWindow: () => BrowserWindow | null;
  getTrustedRendererUrl: () => string;
  onPluginWebContentsCreated: (contents: WebContents, pluginId: string) => void;
}

class PluginIpcInputError extends Error {
  constructor(readonly code: DesktopPluginErrorCode = 'invalid-request', message = 'The plugin management request is invalid.') {
    super(message);
    this.name = 'PluginIpcInputError';
  }
}

/** Load signer trust and expose a narrow IPC surface to the trusted desktop renderer. */
export async function registerPluginLifecycleIpc(dependencies: PluginIpcDependencies): Promise<void> {
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
    executeCapability: (manifest, call) => executePluginCapability(manifest, call, pluginSettingsStore),
    onStateChange: event => {
      const mainWindow = dependencies.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send('desktop:plugins:changed', event);
    },
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
): Promise<unknown> {
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
    return value === undefined ? { found: false } : { found: true, value };
  }
  if (call.capability === 'settings.write' && call.operation === 'set') {
    return settingsStore.write(manifest.id, call.input.key, call.input.value);
  }
  if (call.capability === 'settings.write' && call.operation === 'delete') {
    return settingsStore.delete(manifest.id, call.input.key);
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
