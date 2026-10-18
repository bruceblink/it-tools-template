import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import {
  BrowserWindow,
  session as electronSession,
  type Session,
  type WebContents,
} from 'electron';
import { resolveRendererFile } from './security';

export const PLUGIN_SCHEME = 'it-plugin';

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const maximumPluginAssetBytes = 16 * 1024 * 1024;
const blockedNetworkPatterns = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'];
const configuredSessionRoots = new WeakMap<Session, string>();

export interface PluginSandboxRegistration {
  pluginId: string;
  packageRoot: string;
  entrypoint: string;
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** Accept package IDs that can be represented as a stable, unambiguous custom-protocol host. */
export function isValidPluginId(pluginId: string): boolean {
  return pluginId.length <= 128 && pluginIdPattern.test(pluginId);
}

export function getPluginSessionPartition(pluginId: string): string {
  assertPluginId(pluginId);
  return `it-plugin-${pluginId}`;
}

/** Keep one package directory bound to each in-memory session until a restartable upgrade flow exists. */
export function assertPluginSessionRoot(currentRoot: string | undefined, requestedRoot: string): void {
  if (currentRoot !== undefined && currentRoot !== requestedRoot) {
    throw new Error('A plugin session cannot be rebound to a different package directory.');
  }
}

export function isPluginRendererUrl(candidate: string, pluginId: string): boolean {
  if (!isValidPluginId(pluginId)) {
    return false;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === `${PLUGIN_SCHEME}:`
      && url.hostname === pluginId
      && url.username === ''
      && url.password === ''
      && url.port === '';
  }
  catch {
    return false;
  }
}

/** Build a URL only from a normalized relative entrypoint supplied by a validated package record. */
export function getPluginEntryUrl(pluginId: string, entrypoint: string): string {
  assertPluginId(pluginId);
  const segments = normalizePluginPath(entrypoint);
  if (segments.length === 0 || !segments.at(-1)?.endsWith('.html')) {
    throw new Error('A plugin entrypoint must name an HTML file.');
  }
  return `${PLUGIN_SCHEME}://${pluginId}/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
}

export function getPluginContentSecurityPolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Create a sandboxed renderer with no preload and a non-persistent, per-package session. */
export async function createPluginSandboxWindow(
  registration: PluginSandboxRegistration,
  onWebContentsCreated: (contents: WebContents, pluginId: string) => void,
): Promise<BrowserWindow> {
  assertPluginId(registration.pluginId);
  const entryUrl = getPluginEntryUrl(registration.pluginId, registration.entrypoint);
  const packageRoot = resolve(registration.packageRoot);
  const entryFile = await resolveRendererFile(packageRoot, new URL(entryUrl).pathname);
  if (!entryFile || !(await stat(entryFile)).isFile()) {
    throw new Error(`Plugin ${registration.pluginId} has no readable HTML entrypoint.`);
  }

  const partition = getPluginSessionPartition(registration.pluginId);
  const pluginSession = electronSession.fromPartition(partition, { cache: false });
  await installPluginSessionPolicy(pluginSession, { ...registration, packageRoot });

  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 700,
    minHeight: 500,
    show: false,
    webPreferences: {
      session: pluginSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });

  onWebContentsCreated(window.webContents, registration.pluginId);
  window.once('ready-to-show', () => window.show());
  try {
    await window.loadURL(entryUrl);
    return window;
  }
  catch (error) {
    if (!window.isDestroyed()) {
      window.destroy();
    }
    throw error;
  }
}

async function installPluginSessionPolicy(pluginSession: Session, registration: PluginSandboxRegistration): Promise<void> {
  const configuredRoot = configuredSessionRoots.get(pluginSession);
  assertPluginSessionRoot(configuredRoot, registration.packageRoot);
  if (configuredRoot !== undefined) {
    return;
  }

  await pluginSession.protocol.handle(PLUGIN_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return pluginResponse('Method not allowed', 405, { Allow: 'GET, HEAD' });
    }

    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url);
    }
    catch {
      return pluginResponse('Not found', 404);
    }
    if (!isPluginRendererUrl(requestUrl.href, registration.pluginId)) {
      return pluginResponse('Not found', 404);
    }

    const filePath = await resolveRendererFile(registration.packageRoot, requestUrl.pathname);
    if (!filePath) {
      return pluginResponse('Not found', 404);
    }

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        return pluginResponse('Not found', 404);
      }
      if (fileStat.size > maximumPluginAssetBytes) {
        return pluginResponse('Asset too large', 413);
      }
      const body = request.method === 'HEAD' ? null : await readFile(filePath);
      return pluginResponse(body, 200, {
        'Content-Type': contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      });
    }
    catch {
      return pluginResponse('Not found', 404);
    }
  });

  pluginSession.setPermissionCheckHandler(() => false);
  pluginSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  pluginSession.webRequest.onBeforeRequest({ urls: blockedNetworkPatterns }, (_details, callback) => {
    callback({ cancel: true });
  });
  pluginSession.on('will-download', event => event.preventDefault());
  configuredSessionRoots.set(pluginSession, registration.packageRoot);
}

function pluginResponse(body: BodyInit | null, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      ...extraHeaders,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': getPluginContentSecurityPolicy(),
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function normalizePluginPath(path: string): string[] {
  if (path.length === 0 || path.includes('\0') || path.includes('\\') || path.startsWith('/')) {
    throw new Error('Plugin paths must be non-empty relative paths.');
  }
  const segments = path.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || segment.includes('%'))) {
    throw new Error('Plugin paths cannot contain traversal or encoded segments.');
  }
  return segments;
}

function assertPluginId(pluginId: string): void {
  if (!isValidPluginId(pluginId)) {
    throw new Error('Plugin ID is not a valid protocol host.');
  }
}
