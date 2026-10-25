import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import {
  BrowserWindow,
  session as electronSession,
  type Session,
  type WebContents,
} from 'electron';
import {
  createPluginCapabilityBroker,
  PLUGIN_CAPABILITY_API_PATH,
} from './plugin-capability-broker';
import type {
  PluginCapabilityBroker,
  PluginCapabilityExecutor,
} from './plugin-capability-broker';
import { getPluginApiV1Script } from './plugin-api-v1';
import { getPluginWorkerGuardScript, injectPluginWorkerGuard } from './plugin-worker-guard';
import { resolveRendererFile } from './security';

export const PLUGIN_SCHEME = 'it-plugin';

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const maximumPluginAssetBytes = 16 * 1024 * 1024;
const pluginEntrypointLoadTimeoutMs = 15_000;
const blockedNetworkProtocols = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:']);

interface PluginSessionPolicy {
  packageRoot: string;
  capabilityBroker: PluginCapabilityBroker | null;
  activeContentsId: number | null;
}

const configuredSessions = new WeakMap<Session, PluginSessionPolicy>();

export interface PluginSandboxRegistration {
  pluginId: string;
  packageRoot: string;
  entrypoint: string;
  requestedCapabilities?: readonly string[];
  grantedCapabilities?: readonly string[];
  executeCapability?: PluginCapabilityExecutor;
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

export function getPluginSessionPartition(pluginId: string, packageRoot: string): string {
  assertPluginId(pluginId);
  const identity = createHash('sha256')
    .update(pluginId)
    .update('\0')
    .update(resolve(packageRoot))
    .digest('hex')
    .slice(0, 32);
  return `it-plugin-${identity}`;
}

/** Keep each installed package version bound to its own in-memory session. */
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
  return buildPluginContentSecurityPolicy("'self'");
}

/** A Worker response may import same-origin scripts but cannot create descendants. */
export function getPluginWorkerContentSecurityPolicy(): string {
  return buildPluginContentSecurityPolicy("'none'");
}

function buildPluginContentSecurityPolicy(workerSource: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    `worker-src ${workerSource}`,
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

  const partition = getPluginSessionPartition(registration.pluginId, packageRoot);
  const pluginSession = electronSession.fromPartition(partition, { cache: false });
  const requestedCapabilities = registration.requestedCapabilities ?? [];
  const grantedCapabilities = registration.grantedCapabilities ?? [];
  if (!registration.executeCapability && (requestedCapabilities.length > 0 || grantedCapabilities.length > 0)) {
    throw new Error('Plugin capabilities require a host executor.');
  }
  const capabilityBroker = registration.executeCapability
    ? createPluginCapabilityBroker({
        pluginId: registration.pluginId,
        requestedCapabilities,
        grantedCapabilities,
        execute: registration.executeCapability,
      })
    : null;
  const sessionPolicy = await installPluginSessionPolicy(
    pluginSession,
    { ...registration, packageRoot },
    capabilityBroker,
  );
  if (sessionPolicy.activeContentsId !== null) {
    capabilityBroker?.revoke();
    throw new Error(`Plugin ${registration.pluginId} already has an active window.`);
  }

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

  const webContentsId = window.webContents.id;
  sessionPolicy.activeContentsId = webContentsId;
  window.once('closed', () => {
    if (sessionPolicy.activeContentsId === webContentsId) {
      sessionPolicy.activeContentsId = null;
      if (sessionPolicy.capabilityBroker === capabilityBroker) {
        capabilityBroker?.revoke();
        sessionPolicy.capabilityBroker = null;
      }
    }
  });
  onWebContentsCreated(window.webContents, registration.pluginId);
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });
  try {
    let timeout: ReturnType<typeof setTimeout>;
    await Promise.race([
      window.loadURL(entryUrl),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('The plugin entrypoint did not load in time.')), pluginEntrypointLoadTimeoutMs);
      }),
    ]).finally(() => clearTimeout(timeout));
    return window;
  }
  catch (error) {
    if (!window.isDestroyed()) {
      window.destroy();
    }
    throw error;
  }
}

async function installPluginSessionPolicy(
  pluginSession: Session,
  registration: PluginSandboxRegistration,
  capabilityBroker: PluginCapabilityBroker | null,
): Promise<PluginSessionPolicy> {
  const configuredPolicy = configuredSessions.get(pluginSession);
  assertPluginSessionRoot(configuredPolicy?.packageRoot, registration.packageRoot);
  if (configuredPolicy) {
    if (configuredPolicy.activeContentsId !== null) {
      capabilityBroker?.revoke();
      throw new Error(`Plugin ${registration.pluginId} already has an active window.`);
    }
    configuredPolicy.capabilityBroker?.revoke();
    configuredPolicy.capabilityBroker = capabilityBroker;
    return configuredPolicy;
  }

  const policy: PluginSessionPolicy = {
    packageRoot: registration.packageRoot,
    capabilityBroker,
    activeContentsId: null,
  };
  await pluginSession.protocol.handle(PLUGIN_SCHEME, async (request) => {
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
    if (requestUrl.pathname === PLUGIN_CAPABILITY_API_PATH
      && requestUrl.searchParams.get('__it_tools_internal') === 'plugin-bootstrap') {
      if (request.method !== 'GET') {
        return pluginResponse('Method not allowed', 405, { Allow: 'GET' });
      }
      if (policy.activeContentsId === null) {
        return pluginResponse('Plugin inactive', 410);
      }
      return pluginResponse(`${getPluginWorkerGuardScript()}\n${getPluginApiV1Script()}`, 200, {
        'Content-Type': 'text/javascript; charset=utf-8',
      });
    }
    if (requestUrl.pathname === PLUGIN_CAPABILITY_API_PATH) {
      if (policy.activeContentsId === null || !policy.capabilityBroker) {
        return pluginJsonResponse(410, { ok: false, error: 'plugin-inactive' });
      }
      return policy.capabilityBroker.handle(request);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return pluginResponse('Method not allowed', 405, { Allow: 'GET, HEAD' });
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
      let body = request.method === 'HEAD' ? null : await readFile(filePath);
      const extension = extname(filePath).toLowerCase();
      if (body && extension === '.html') {
        const bootstrapUrl = `${PLUGIN_CAPABILITY_API_PATH}?__it_tools_internal=plugin-bootstrap`;
        body = Buffer.from(injectPluginWorkerGuard(body.toString('utf8'), bootstrapUrl), 'utf8');
      }
      return pluginResponse(body, 200, {
        'Content-Type': contentTypes[extension] ?? 'application/octet-stream',
      }, extension === '.js' || extension === '.mjs'
        ? getPluginWorkerContentSecurityPolicy()
        : getPluginContentSecurityPolicy());
    }
    catch {
      return pluginResponse('Not found', 404);
    }
  });

  pluginSession.setPermissionCheckHandler(() => false);
  pluginSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  pluginSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    let requestUrl: URL;
    try {
      requestUrl = new URL(details.url);
    }
    catch {
      callback({ cancel: true });
      return;
    }

    if (blockedNetworkProtocols.has(requestUrl.protocol)) {
      callback({ cancel: true });
      return;
    }

    if (requestUrl.protocol === `${PLUGIN_SCHEME}:`
      && requestUrl.pathname === PLUGIN_CAPABILITY_API_PATH
      && requestUrl.searchParams.get('__it_tools_internal') === 'plugin-bootstrap') {
      const sourceFrame = details.frame;
      const trustedMainFrame = sourceFrame !== undefined
        && sourceFrame !== null
        && sourceFrame.parent === null
        && isPluginRendererUrl(sourceFrame.url, registration.pluginId);
      const trustedContents = details.webContentsId === policy.activeContentsId;
      const trustedInitiator = details.initiatorOrigin === `it-plugin://${registration.pluginId}`;
      callback({
        cancel: details.method !== 'GET'
          || details.resourceType !== 'script'
          || !trustedMainFrame
          || !trustedContents
          || !trustedInitiator,
      });
      return;
    }

    if (requestUrl.protocol === `${PLUGIN_SCHEME}:` && requestUrl.pathname === PLUGIN_CAPABILITY_API_PATH) {
      const sourceFrame = details.frame;
      const trustedMainFrame = sourceFrame !== undefined
        && sourceFrame !== null
        && sourceFrame.parent === null
        && isPluginRendererUrl(sourceFrame.url, registration.pluginId);
      const trustedContents = details.webContentsId === policy.activeContentsId;
      const trustedInitiator = details.initiatorOrigin === `it-plugin://${registration.pluginId}`;
      callback({
        cancel: !policy.capabilityBroker
          || !trustedMainFrame
          || !trustedContents
          || !trustedInitiator
          || details.resourceType !== 'xhr',
      });
      return;
    }

    callback({});
  });
  pluginSession.on('will-download', event => event.preventDefault());
  configuredSessions.set(pluginSession, policy);
  return policy;
}

function pluginResponse(
  body: BodyInit | null,
  status: number,
  extraHeaders: Record<string, string> = {},
  contentSecurityPolicy = getPluginContentSecurityPolicy(),
): Response {
  return new Response(body, {
    status,
    headers: {
      ...extraHeaders,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': contentSecurityPolicy,
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function pluginJsonResponse(status: number, value: unknown): Response {
  return pluginResponse(JSON.stringify(value), status, {
    'Content-Type': 'application/json; charset=utf-8',
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
