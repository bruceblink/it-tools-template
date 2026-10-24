import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
  type WebContents,
} from 'electron';
import securityHeaderConfig from '../security-headers.json';
import {
  buildElectronSecurityHeaders,
  getSafeExternalUrl,
  isTrustedRendererUrl,
  resolveRendererFile,
  type SecurityHeaderConfig,
} from './security';
import {
  getCheckedMediaType,
  getRequestedMediaTypes,
  type MediaDeviceType,
} from './media-permissions';
import {
  createPluginSandboxWindow,
  isPluginRendererUrl,
  PLUGIN_SCHEME,
} from './plugin-sandbox';
import { registerPluginLifecycleIpc } from './plugin-ipc';
import { registerDatabaseIpc } from './database/database-ipc';
import { registerSystemMonitorIpc } from './system-monitor/system-monitor-ipc';

const APP_BASE_URL = 'app://bundle/';
const APP_SCHEME = 'app';
const APP_HOST = 'bundle';
const typedSecurityHeaderConfig: SecurityHeaderConfig = {
  ...securityHeaderConfig,
  responseHeaders: securityHeaderConfig.responseHeaders.map(([name, value]) => [name, value] as [string, string]),
};
const securityHeaders = buildElectronSecurityHeaders(typedSecurityHeaderConfig);

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}, {
  scheme: PLUGIN_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
  },
}]);

let mainWindow: BrowserWindow | null = null;
let databaseIpc: ReturnType<typeof registerDatabaseIpc> | null = null;
let systemMonitorIpc: ReturnType<typeof registerSystemMonitorIpc> | null = null;
let trustedRendererUrl = APP_BASE_URL;
// These window-scoped grants stay in memory and are discarded when their WebContents closes.
const grantedMediaTypes = new WeakMap<WebContents, Set<MediaDeviceType>>();
const pendingMediaPrompts = new WeakMap<WebContents, Map<string, Promise<boolean>>>();
const pluginRendererIds = new WeakMap<WebContents, string>();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Do not let Electron generate the default File/Edit/View/Window menu.
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('org.it-tools.desktop');
    trustedRendererUrl = getDevelopmentRendererUrl(process.env.ELECTRON_RENDERER_URL) ?? APP_BASE_URL;
    app.on('web-contents-created', (_event, contents) => attachWebContentsSecurity(contents));
    await installAppProtocol();
    installPermissionPolicy();
    installRuntimeInfoIpc();
    databaseIpc = registerDatabaseIpc({
      trustedRendererUrl: () => trustedRendererUrl,
      workerPath: resolve(app.getAppPath(), 'out/main/database-worker.cjs'),
      userDataRoot: app.getPath('userData'),
    });
    systemMonitorIpc = registerSystemMonitorIpc({
      trustedRendererUrl: () => trustedRendererUrl,
      workerPath: resolve(app.getAppPath(), 'out/main/system-monitor-worker.cjs'),
    });
    await registerPluginLifecycleIpc({
      userDataRoot: app.getPath('userData'),
      getMainWindow: () => mainWindow,
      getTrustedRendererUrl: () => trustedRendererUrl,
      onPluginWebContentsCreated: (contents, pluginId) => pluginRendererIds.set(contents, pluginId),
    });
    await createMainWindow();
    if (!app.isPackaged && process.env.IT_TOOLS_PLUGIN_SANDBOX_TEST === '1') {
      await openPluginSandboxProof();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
      }
    });
  }).catch((error: unknown) => {
    console.error('Failed to start IT Tools Desktop.', error);
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    databaseIpc?.shutdown();
    databaseIpc = null;
    systemMonitorIpc?.shutdown();
    systemMonitorIpc = null;
  });
}

function getDevelopmentRendererUrl(candidate?: string) {
  if (app.isPackaged || !candidate) {
    return null;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:'
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username !== ''
      || url.password !== '') {
      return null;
    }
    return `${url.origin}/`;
  }
  catch {
    return null;
  }
}

function makeResponse(body: BodyInit | null, status: number, headers = new Headers()) {
  for (const [name, value] of securityHeaders) {
    headers.set(name, value);
  }
  return new Response(body, { status, headers });
}

async function installAppProtocol() {
  const rendererRoot = resolve(app.getAppPath(), 'out/renderer');
  await protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return makeResponse('Method not allowed', 405, new Headers({ Allow: 'GET, HEAD' }));
    }

    const requestUrl = new URL(request.url);
    if (requestUrl.hostname !== APP_HOST || requestUrl.username !== '' || requestUrl.password !== '') {
      return makeResponse('Not found', 404);
    }

    const filePath = await resolveRendererFile(rendererRoot, requestUrl.pathname);
    if (!filePath) {
      return makeResponse('Not found', 404);
    }

    try {
      const response = await net.fetch(pathToFileURL(filePath).toString());
      const headers = new Headers(response.headers);
      if (request.method === 'HEAD') {
        return makeResponse(null, response.status, headers);
      }
      for (const [name, value] of securityHeaders) {
        headers.set(name, value);
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    catch {
      return makeResponse('Not found', 404);
    }
  });
}

// Keep the default-deny policy and grant only media access explicitly approved for Camera Recorder.
function installPermissionPolicy() {
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (!contents || contents !== mainWindow?.webContents) {
      return false;
    }

    const mediaType = getCheckedMediaType(permission, requestingOrigin, details, trustedRendererUrl, contents.getURL());
    return mediaType !== null && (grantedMediaTypes.get(contents)?.has(mediaType) ?? false);
  });

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (contents !== mainWindow?.webContents) {
      callback(false);
      return;
    }

    const mediaRequest = details as {
      isMainFrame: boolean;
      mediaTypes?: unknown;
      requestingUrl?: string;
      securityOrigin?: string;
    };
    const requestedTypes = getRequestedMediaTypes(permission, mediaRequest, trustedRendererUrl, contents.getURL());
    if (requestedTypes.length === 0) {
      callback(false);
      return;
    }

    void confirmMediaAccess(contents, requestedTypes).then((allowed) => {
      if (allowed && getRequestedMediaTypes(permission, mediaRequest, trustedRendererUrl, contents.getURL()).length > 0) {
        const grants = grantedMediaTypes.get(contents) ?? new Set<MediaDeviceType>();
        for (const mediaType of requestedTypes) {
          grants.add(mediaType);
        }
        grantedMediaTypes.set(contents, grants);
        callback(true);
        return;
      }

      callback(false);
    }).catch(() => callback(false));
  });
}

// Ask once for each unapproved device set; missing windows and dialog failures deny access.
async function confirmMediaAccess(contents: WebContents, requestedTypes: MediaDeviceType[]) {
  const grants = grantedMediaTypes.get(contents) ?? new Set<MediaDeviceType>();
  const typesNeedingConsent = requestedTypes.filter(mediaType => !grants.has(mediaType));
  if (typesNeedingConsent.length === 0) {
    return true;
  }

  const window = BrowserWindow.fromWebContents(contents);
  if (!window || window.isDestroyed()) {
    return false;
  }

  const key = [...typesNeedingConsent].sort().join(',');
  const prompts = pendingMediaPrompts.get(contents) ?? new Map<string, Promise<boolean>>();
  const existingPrompt = prompts.get(key);
  if (existingPrompt) {
    return existingPrompt;
  }

  const mediaLabel = typesNeedingConsent.map(type => type === 'video' ? 'the camera' : 'the microphone').join(' and ');
  const prompt = dialog.showMessageBox(window, {
    type: 'question',
    title: 'Media access request',
    message: `Allow Camera Recorder to access ${mediaLabel}?`,
    detail: 'IT Tools can use these devices only in Camera Recorder in this window. This permission ends when the window closes.',
    buttons: ['Allow', 'Deny'],
    defaultId: 1,
    cancelId: 1,
  }).then(({ response }) => response === 0).catch(() => false);

  prompts.set(key, prompt);
  pendingMediaPrompts.set(contents, prompts);
  try {
    return await prompt;
  }
  finally {
    if (prompts.get(key) === prompt) {
      prompts.delete(key);
    }
    if (prompts.size === 0) {
      pendingMediaPrompts.delete(contents);
    }
  }
}

function installRuntimeInfoIpc() {
  ipcMain.handle('desktop:get-runtime-info', (event) => {
    if (event.senderFrame !== event.sender.mainFrame
      || !isTrustedRendererUrl(event.senderFrame.url, trustedRendererUrl)) {
      throw new Error('The runtime information request came from an untrusted frame.');
    }
    return { platform: process.platform, version: app.getVersion() };
  });
}

function attachWebContentsSecurity(contents: WebContents) {
  contents.setWindowOpenHandler(({ url, referrer }) => {
    if (pluginRendererIds.has(contents)) {
      return { action: 'deny' };
    }
    const sourceUrl = referrer.url || contents.getURL();
    if (!isTrustedRendererUrl(sourceUrl, trustedRendererUrl)) {
      return { action: 'deny' };
    }
    if (url === '' || url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            preload: resolve(app.getAppPath(), 'out/preload/preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
          },
        },
      };
    }
    void openExternalLink(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererNavigation(contents, url)) {
      event.preventDefault();
      return;
    }
    closeRendererOwnedServices(contents);
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedRendererNavigation(contents, url)) {
      event.preventDefault();
      return;
    }
    closeRendererOwnedServices(contents);
  });
  contents.on('did-start-navigation', (_event, url, isInPlace) => {
    if (!isInPlace && isAllowedRendererNavigation(contents, url)) {
      closeRendererOwnedServices(contents);
    }
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

/** Releases renderer-owned desktop services before a full document navigation replaces the page. */
function closeRendererOwnedServices(contents: WebContents): void {
  if (pluginRendererIds.has(contents)) {
    return;
  }
  databaseIpc?.closeRenderer(contents.id);
  systemMonitorIpc?.closeRenderer(contents.id);
}

function isAllowedRendererNavigation(contents: WebContents, url: string): boolean {
  const pluginId = pluginRendererIds.get(contents);
  return pluginId
    ? isPluginRendererUrl(url, pluginId)
    : isTrustedRendererUrl(url, trustedRendererUrl);
}

async function openPluginSandboxProof(): Promise<void> {
  const packageRoot = resolve(app.getAppPath(), 'electron/plugin-fixtures/sample');
  for (const pluginId of ['org.it-tools.sandbox-proof', 'org.it-tools.sandbox-proof-peer']) {
    await createPluginSandboxWindow({
      pluginId,
      packageRoot,
      entrypoint: 'index.html',
      requestedCapabilities: ['runtime.info', 'clipboard.write'],
      grantedCapabilities: ['runtime.info'],
      executeCapability: (call) => {
        if (call.capability === 'runtime.info') {
          return { platform: process.platform, version: app.getVersion() };
        }
        throw new Error('The sandbox proof does not execute this capability.');
      },
    }, (contents, id) => pluginRendererIds.set(contents, id));
  }
}

async function openExternalLink(candidate: string) {
  const safeUrl = getSafeExternalUrl(candidate);
  if (safeUrl) {
    try {
      await shell.openExternal(safeUrl);
    }
    catch (error) {
      console.warn('Could not open the external link.', error);
    }
  }
}

async function createMainWindow() {
  const preloadPath = resolve(app.getAppPath(), 'out/preload/preload.cjs');
  const window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 820,
    minHeight: 600,
    show: false,
    backgroundColor: '#f1f5f9',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });

  mainWindow = window;
  const rendererId = window.webContents.id;
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });
  window.on('closed', () => {
    databaseIpc?.closeRenderer(rendererId);
    systemMonitorIpc?.closeRenderer(rendererId);
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  const rendererUrl = getDevelopmentRendererUrl(process.env.ELECTRON_RENDERER_URL);
  if (!app.isPackaged && rendererUrl) {
    await window.loadURL(rendererUrl);
  }
  else {
    await window.loadURL(APP_BASE_URL);
  }
}
