import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
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
}]);

let mainWindow: BrowserWindow | null = null;
let trustedRendererUrl = APP_BASE_URL;

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
    app.setAppUserModelId('org.it-tools.desktop');
    trustedRendererUrl = getDevelopmentRendererUrl(process.env.ELECTRON_RENDERER_URL) ?? APP_BASE_URL;
    app.on('web-contents-created', (_event, contents) => attachWebContentsSecurity(contents));
    await installAppProtocol();
    installPermissionPolicy();
    installRuntimeInfoIpc();
    await createMainWindow();

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

function installPermissionPolicy() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
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
    if (!isTrustedRendererUrl(url, trustedRendererUrl)) {
      event.preventDefault();
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url, trustedRendererUrl)) {
      event.preventDefault();
    }
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
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
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
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
