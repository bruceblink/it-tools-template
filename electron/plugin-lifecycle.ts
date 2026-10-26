import { lstat, mkdir, opendir, readdir, realpath, rmdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { BrowserWindow } from 'electron';
import { PluginPackageError } from './plugin-package-manifest';
import {
  stagePluginPackageArchive,
} from './plugin-package';
import type {
  PluginPackageManifest,
  PluginPackageSigningKey,
  PluginPackageToolContribution,
} from './plugin-package';
import type {
  PluginCapability,
  PluginCapabilityCall,
} from './plugin-capability-broker';
import {
  isValidPluginId,
} from './plugin-sandbox';
import type {
  PluginSandboxRegistration,
} from './plugin-sandbox';
import {
  readInstalledPluginManifest,
  verifyInstalledPluginPackage,
} from './plugin-package-integrity';
import { getExternalPluginToolRoute } from '../src/shared/plugin-tool-route';

export { verifyInstalledPluginPackage } from './plugin-package-integrity';

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const supportedCapabilities = new Set<PluginCapability>([
  'runtime.info',
  'clipboard.write',
  'settings.read',
  'settings.write',
]);
const maximumInstalledPackages = 128;
const maximumActivePlugins = 4;
const windowCloseTimeoutMs = 5_000;
const unresponsiveWindowTimeoutMs = 10_000;
const rendererResponsivenessProbeIntervalMs = 2_000;
const rendererResponsivenessProbeTimeoutMs = 10_000;

export type PluginRuntimeFailureCode = 'renderer-crashed' | 'renderer-unresponsive' | 'window-closed';

export const pluginLifecycleLimits = Object.freeze({
  maximumInstalledPackages,
  maximumActivePlugins,
  unresponsiveWindowTimeoutMs,
  rendererResponsivenessProbeIntervalMs,
  rendererResponsivenessProbeTimeoutMs,
});

export const pluginLifecycleCapabilities: readonly PluginCapability[] = [...supportedCapabilities];

export type PluginLifecycleErrorCode =
  | 'not-installed'
  | 'active-limit'
  | 'contribution-not-found'
  | 'unsupported-capability'
  | 'activation-failed'
  | 'activation-rollback-failed'
  | 'window-close-timeout';

export class PluginLifecycleError extends Error {
  constructor(
    readonly code: PluginLifecycleErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginLifecycleError';
  }
}

export interface PluginLifecycleSnapshot {
  pluginId: string;
  name: string;
  version: string;
  requestedCapabilities: readonly string[];
  contributions: {
    tools: readonly PluginLifecycleToolContribution[];
  };
  grantedCapabilities: readonly PluginCapability[];
  status: 'installed' | 'active' | 'invalid';
  /** The contribution currently selected for the active isolated window. */
  activeContributionId?: string;
  errorCode?: string;
}

export interface PluginLifecycleToolContribution extends PluginPackageToolContribution {
  /** Host-owned metadata route; it never executes package code in the host renderer. */
  route: string;
  dataProcessing: NonNullable<PluginPackageToolContribution['dataProcessing']>;
  offline: NonNullable<PluginPackageToolContribution['offline']>;
  capabilities: readonly PluginCapability[];
}

export interface PluginLifecycleOptions {
  installRoot: string;
  hostApiVersion: string;
  trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>;
  createWindow: (registration: PluginSandboxRegistration) => Promise<BrowserWindow>;
  executeCapability: (manifest: PluginPackageManifest, call: PluginCapabilityCall) => Promise<unknown> | unknown;
  /** Notify trusted renderers after an unexpected plugin window exit. */
  onStateChange?: (pluginId: string) => void;
}

interface ActivePlugin {
  pluginId: string;
  version: string;
  contributionId?: string;
  signingKeyId: string;
  packageRoot: string;
  grantedCapabilities: readonly PluginCapability[];
  window: BrowserWindow;
  unresponsiveTimer?: ReturnType<typeof setTimeout>;
  responsivenessProbeInterval?: ReturnType<typeof setInterval>;
  responsivenessProbeTimeout?: ReturnType<typeof setTimeout>;
  responsivenessProbePending: boolean;
  terminationRequested: boolean;
  terminationFailureCode?: PluginRuntimeFailureCode;
}

interface PluginRuntimeFailure {
  code: PluginRuntimeFailureCode;
}

/** Own the installed package lifecycle while keeping all windows inside Electron's sandbox. */
export class PluginLifecycleManager {
  private readonly installRoot: string;
  private readonly activePlugins = new Map<string, ActivePlugin>();
  private readonly runtimeFailures = new Map<string, PluginRuntimeFailure>();
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: PluginLifecycleOptions) {
    this.installRoot = resolve(options.installRoot);
  }

  async listInstalled(): Promise<PluginLifecycleSnapshot[]> {
    return this.runExclusive(async () => {
      const root = await this.ensureInstallRoot();
      const snapshots: PluginLifecycleSnapshot[] = [];
      for await (const pluginDirectory of await opendir(root)) {
        if (!isValidPluginId(pluginDirectory.name)) {
          continue;
        }
        if (pluginDirectory.isSymbolicLink()) {
          pushSnapshot(snapshots, this.invalidSnapshot(pluginDirectory.name, 'unknown', 'unsafe-archive-entry'));
          continue;
        }
        if (!pluginDirectory.isDirectory()) {
          continue;
        }

        const pluginRoot = resolve(root, pluginDirectory.name);
        const pluginRootMetadata = await lstat(pluginRoot);
        const canonicalPluginRoot = await realpath(pluginRoot);
        if (!pluginRootMetadata.isDirectory() || pluginRootMetadata.isSymbolicLink() || !isContainedPath(root, canonicalPluginRoot)) {
          pushSnapshot(snapshots, this.invalidSnapshot(pluginDirectory.name, 'unknown', 'unsafe-archive-entry'));
          continue;
        }
        for await (const versionDirectory of await opendir(canonicalPluginRoot)) {
          if (!stableVersionPattern.test(versionDirectory.name)) {
            continue;
          }
          if (versionDirectory.isSymbolicLink() || !versionDirectory.isDirectory()) {
            pushSnapshot(snapshots, this.invalidSnapshot(pluginDirectory.name, versionDirectory.name, 'unsafe-archive-entry'));
            continue;
          }
          try {
            const packageRoot = await this.getInstalledPackageRoot(pluginDirectory.name, versionDirectory.name);
            const manifest = await readInstalledPluginManifest({
              packageRoot,
              pluginId: pluginDirectory.name,
              version: versionDirectory.name,
              hostApiVersion: this.options.hostApiVersion,
              trustedSigningKeys: this.options.trustedSigningKeys,
            });
            pushSnapshot(snapshots, this.snapshotFromManifest(manifest));
          }
          catch (error) {
            pushSnapshot(snapshots, this.invalidSnapshot(
              pluginDirectory.name,
              versionDirectory.name,
              getErrorCode(error),
            ));
          }
        }
      }
      return snapshots.sort((left, right) => (
        left.pluginId.localeCompare(right.pluginId) || left.version.localeCompare(right.version)
      ));
    });
  }

  async installArchive(archivePath: string): Promise<PluginLifecycleSnapshot> {
    return this.runExclusive(async () => {
      const root = await this.ensureInstallRoot();
      const installedCount = await this.countInstalledPackages(root);
      if (installedCount >= maximumInstalledPackages) {
        throw new PluginPackageError('resource-limit', 'The host has reached its installed plugin limit.');
      }
      const staged = await stagePluginPackageArchive({
        archivePath,
        installRoot: root,
        hostApiVersion: this.options.hostApiVersion,
        trustedSigningKeys: this.options.trustedSigningKeys,
      });
      const snapshot = this.snapshotFromManifest(staged.manifest);
      this.notifyStateChange(staged.manifest.id);
      return snapshot;
    });
  }

  /** Activate a verified version and restore the previous version if the new window cannot start. */
  async activate(
    pluginId: string,
    version: string,
    grantedCapabilities: readonly string[],
    contributionId?: string,
  ): Promise<PluginLifecycleSnapshot> {
    return this.runExclusive(async () => {
      const packageRoot = await this.getInstalledPackageRoot(pluginId, version);
      const manifest = await verifyInstalledPluginPackage({
        installRoot: this.installRoot,
        packageRoot,
        pluginId,
        version,
        hostApiVersion: this.options.hostApiVersion,
        trustedSigningKeys: this.options.trustedSigningKeys,
      });
      const grants = validateGrantedCapabilities(manifest, grantedCapabilities);
      const selectedContributionId = validateContribution(manifest, contributionId);
      const previous = this.activePlugins.get(pluginId);
      if (
        previous?.version === version
        && previous.contributionId === selectedContributionId
        && sameItems(previous.grantedCapabilities, grants)
        && !previous.window.isDestroyed()
      ) {
        return this.snapshotFromManifest(manifest);
      }
      if (!previous && this.activePlugins.size >= maximumActivePlugins) {
        throw new PluginLifecycleError('active-limit', 'The host has reached its active plugin limit.');
      }

      if (previous) {
        await this.destroyActivePlugin(previous);
      }
      try {
        await this.startVerifiedPlugin(pluginId, version, packageRoot, manifest, grants, selectedContributionId);
        this.runtimeFailures.delete(getPluginPackageKey(pluginId, version));
        this.notifyStateChange(pluginId);
      }
      catch (activationError) {
        if (previous) {
          try {
            const oldManifest = await verifyInstalledPluginPackage({
              installRoot: this.installRoot,
              packageRoot: previous.packageRoot,
              pluginId: previous.pluginId,
              version: previous.version,
              hostApiVersion: this.options.hostApiVersion,
              trustedSigningKeys: this.options.trustedSigningKeys,
            });
            await this.startVerifiedPlugin(
              previous.pluginId,
              previous.version,
              previous.packageRoot,
              oldManifest,
              previous.grantedCapabilities,
              previous.contributionId,
            );
          }
          catch (rollbackError) {
            throw new PluginLifecycleError(
              'activation-rollback-failed',
              'The new plugin version failed to start and the previous version could not be restored.',
              { cause: new AggregateError([activationError, rollbackError]) },
            );
          }
        }
        throw new PluginLifecycleError('activation-failed', 'The plugin version failed to start.', { cause: activationError });
      }
      return this.snapshotFromManifest(manifest);
    });
  }

  async disable(pluginId: string): Promise<boolean> {
    return this.runExclusive(async () => {
      const active = this.activePlugins.get(pluginId);
      if (!active) {
        return false;
      }
      await this.destroyActivePlugin(active);
      this.runtimeFailures.delete(getPluginPackageKey(active.pluginId, active.version));
      this.notifyStateChange(active.pluginId);
      return true;
    });
  }

  async disableSignedByKey(keyId: string): Promise<number> {
    return this.runExclusive(async () => {
      const active = [...this.activePlugins.values()].filter(plugin => plugin.signingKeyId === keyId);
      for (const plugin of active) {
        await this.destroyActivePlugin(plugin);
        this.runtimeFailures.delete(getPluginPackageKey(plugin.pluginId, plugin.version));
        this.notifyStateChange(plugin.pluginId);
      }
      return active.length;
    });
  }

  async uninstall(pluginId: string, version: string): Promise<boolean> {
    return this.runExclusive(async () => {
      const packageRoot = await this.getInstalledPackageRoot(pluginId, version);
      const active = this.activePlugins.get(pluginId);
      if (active?.version === version) {
        await this.destroyActivePlugin(active);
      }

      const canonicalRoot = await this.ensureInstallRoot();
      const currentPackageRoot = await this.getInstalledPackageRoot(pluginId, version);
      if (!isContainedPath(canonicalRoot, currentPackageRoot) || currentPackageRoot !== packageRoot) {
        throw new PluginPackageError('unsafe-archive-entry', 'The plugin uninstall path changed during the operation.');
      }
      await rm(currentPackageRoot, { recursive: true, force: false });
      this.runtimeFailures.delete(getPluginPackageKey(pluginId, version));
      this.notifyStateChange(pluginId);
      const pluginRoot = dirname(currentPackageRoot);
      try {
        if ((await readdir(pluginRoot)).length === 0) {
          await rmdir(pluginRoot);
        }
      }
      catch (error) {
        if (!isNodeError(error) || error.code !== 'ENOENT') {
          throw error;
        }
      }
      return true;
    });
  }

  private async startVerifiedPlugin(
    pluginId: string,
    version: string,
    packageRoot: string,
    manifest: PluginPackageManifest,
    grantedCapabilities: readonly PluginCapability[],
    contributionId?: string,
  ): Promise<void> {
    const registration: PluginSandboxRegistration = {
      pluginId,
      packageRoot,
      entrypoint: manifest.entrypoint,
      contributionId,
      requestedCapabilities: manifest.requestedCapabilities,
      grantedCapabilities,
      executeCapability: call => this.options.executeCapability(manifest, call),
    };
    const window = await this.options.createWindow(registration);
    if (window.isDestroyed()) {
      throw new PluginLifecycleError('activation-failed', 'The plugin window closed before activation completed.');
    }
    const active: ActivePlugin = {
      pluginId,
      version,
      contributionId,
      signingKeyId: manifest.signature.keyId,
      packageRoot,
      grantedCapabilities,
      window,
      responsivenessProbePending: false,
      terminationRequested: false,
    };
    this.activePlugins.set(pluginId, active);
    let terminationRequested = false;
    const terminatePluginWindow = (failureCode?: PluginRuntimeFailureCode) => {
      if (terminationRequested || this.activePlugins.get(pluginId) !== active || window.isDestroyed()) {
        return;
      }
      if (failureCode !== undefined) {
        active.terminationFailureCode = failureCode;
      }
      terminationRequested = true;
      active.terminationRequested = true;
      clearInterval(active.responsivenessProbeInterval);
      try {
        window.destroy();
      }
      catch {
        terminationRequested = false;
        active.terminationRequested = false;
        active.terminationFailureCode = undefined;
        console.error('Failed to terminate an unresponsive plugin window.');
      }
    };
    window.on('unresponsive', () => {
      clearTimeout(active.unresponsiveTimer);
      active.unresponsiveTimer = setTimeout(
        () => terminatePluginWindow('renderer-unresponsive'),
        unresponsiveWindowTimeoutMs,
      );
    });
    window.on('responsive', () => {
      clearTimeout(active.unresponsiveTimer);
      active.unresponsiveTimer = undefined;
    });
    window.webContents.on('render-process-gone', () => terminatePluginWindow('renderer-crashed'));
    // Keep the main process responsive when a plugin renderer stops processing queued work.
    active.responsivenessProbeInterval = setInterval(() => {
      if (
        this.activePlugins.get(pluginId) !== active
        || window.isDestroyed()
        || active.responsivenessProbePending
      ) {
        return;
      }

      active.responsivenessProbePending = true;
      const probeTimeout = setTimeout(
        () => terminatePluginWindow('renderer-unresponsive'),
        rendererResponsivenessProbeTimeoutMs,
      );
      active.responsivenessProbeTimeout = probeTimeout;
      void window.webContents.executeJavaScript('void 0').then(
        () => completeResponsivenessProbe(active, probeTimeout),
        () => {
          completeResponsivenessProbe(active, probeTimeout);
          terminatePluginWindow();
        },
      );
    }, rendererResponsivenessProbeIntervalMs);
    window.once('closed', () => {
      clearTimeout(active.unresponsiveTimer);
      clearInterval(active.responsivenessProbeInterval);
      clearTimeout(active.responsivenessProbeTimeout);
      active.responsivenessProbePending = false;
      const failureCode = active.terminationFailureCode
        ?? (active.terminationRequested ? undefined : 'window-closed');
      if (this.activePlugins.get(pluginId) === active) {
        this.activePlugins.delete(pluginId);
      }
      if (failureCode !== undefined) {
        this.runtimeFailures.set(getPluginPackageKey(active.pluginId, active.version), {
          code: failureCode,
        });
        this.notifyStateChange(active.pluginId);
      }
    });
  }

  private async destroyActivePlugin(active: ActivePlugin): Promise<void> {
    if (active.window.isDestroyed()) {
      if (this.activePlugins.get(active.pluginId) === active) {
        this.activePlugins.delete(active.pluginId);
      }
      return;
    }

    active.terminationRequested = true;
    active.terminationFailureCode = undefined;

    await new Promise<void>((resolvePromise, rejectPromise) => {
      let timeout: ReturnType<typeof setTimeout>;
      const onClosed = () => {
        clearTimeout(timeout);
        resolvePromise();
      };
      timeout = setTimeout(() => {
        active.window.removeListener('closed', onClosed);
        rejectPromise(new PluginLifecycleError(
          'window-close-timeout',
          'The plugin window did not close within the allowed time.',
        ));
      }, windowCloseTimeoutMs);
      active.window.once('closed', onClosed);
      try {
        active.window.destroy();
      }
      catch (error) {
        clearTimeout(timeout);
        active.window.removeListener('closed', onClosed);
        rejectPromise(error);
      }
    });
    if (this.activePlugins.get(active.pluginId) === active) {
      this.activePlugins.delete(active.pluginId);
    }
  }

  private notifyStateChange(pluginId: string): void {
    try {
      this.options.onStateChange?.(pluginId);
    }
    catch (error) {
      console.error('Failed to notify plugin lifecycle state change.', error);
    }
  }

  private async getInstalledPackageRoot(pluginId: string, version: string): Promise<string> {
    if (!isValidPluginId(pluginId) || !stableVersionPattern.test(version)) {
      throw new PluginLifecycleError('not-installed', 'The requested plugin package is not installed.');
    }
    const root = await this.ensureInstallRoot();
    const pluginRoot = resolve(root, pluginId);
    const packageRoot = resolve(pluginRoot, version);
    if (!isContainedPath(root, packageRoot)) {
      throw new PluginPackageError('unsafe-archive-entry', 'The plugin package path escaped the install root.');
    }
    const pluginMetadata = await lstat(pluginRoot).catch((error: unknown) => {
      throw new PluginLifecycleError('not-installed', 'The requested plugin package is not installed.', { cause: error });
    });
    const packageMetadata = await lstat(packageRoot).catch((error: unknown) => {
      throw new PluginLifecycleError('not-installed', 'The requested plugin package is not installed.', { cause: error });
    });
    if (
      !pluginMetadata.isDirectory()
      || pluginMetadata.isSymbolicLink()
      || !packageMetadata.isDirectory()
      || packageMetadata.isSymbolicLink()
    ) {
      throw new PluginPackageError('unsafe-archive-entry', 'The installed plugin path contains a link or non-directory.');
    }
    const canonicalPluginRoot = await realpath(pluginRoot);
    const canonicalPackageRoot = await realpath(packageRoot);
    if (!isContainedPath(root, canonicalPluginRoot) || !isContainedPath(canonicalPluginRoot, canonicalPackageRoot)) {
      throw new PluginPackageError('unsafe-archive-entry', 'The installed plugin path escaped its trusted root.');
    }
    return canonicalPackageRoot;
  }

  private async ensureInstallRoot(): Promise<string> {
    await mkdir(this.installRoot, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.installRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new PluginPackageError('unsafe-archive-entry', 'The plugin install root must be a real directory.');
    }
    return realpath(this.installRoot);
  }

  private snapshotFromManifest(manifest: PluginPackageManifest): PluginLifecycleSnapshot {
    const active = this.activePlugins.get(manifest.id);
    const isActive = active?.version === manifest.version && !active.window.isDestroyed();
    const runtimeFailure = this.runtimeFailures.get(getPluginPackageKey(manifest.id, manifest.version));
    return {
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      requestedCapabilities: [...manifest.requestedCapabilities],
      contributions: {
        tools: (manifest.contributions?.tools ?? []).map(tool => ({
          ...tool,
          dataProcessing: tool.dataProcessing ?? 'unspecified',
          offline: tool.offline ?? 'unknown',
          capabilities: [...(tool.capabilities ?? [])],
          route: getExternalPluginToolRoute(manifest.id, manifest.version, tool.id),
        })),
      },
      grantedCapabilities: isActive ? [...active.grantedCapabilities] : [],
      status: isActive ? 'active' : 'installed',
      ...(isActive && active.contributionId !== undefined ? { activeContributionId: active.contributionId } : {}),
      ...(runtimeFailure ? { errorCode: runtimeFailure.code } : {}),
    };
  }

  private invalidSnapshot(pluginId: string, version: string, errorCode: string): PluginLifecycleSnapshot {
    return {
      pluginId,
      name: pluginId,
      version,
      requestedCapabilities: [],
      contributions: { tools: [] },
      grantedCapabilities: [],
      status: 'invalid',
      errorCode,
    };
  }

  private async countInstalledPackages(root: string): Promise<number> {
    let count = 0;
    for await (const pluginDirectory of await opendir(root)) {
      if (!isValidPluginId(pluginDirectory.name) || !pluginDirectory.isDirectory() || pluginDirectory.isSymbolicLink()) {
        continue;
      }
      const pluginRoot = resolve(root, pluginDirectory.name);
      const pluginRootMetadata = await lstat(pluginRoot);
      const canonicalPluginRoot = await realpath(pluginRoot);
      if (!pluginRootMetadata.isDirectory() || pluginRootMetadata.isSymbolicLink() || !isContainedPath(root, canonicalPluginRoot)) {
        continue;
      }
      for await (const versionDirectory of await opendir(canonicalPluginRoot)) {
        if (stableVersionPattern.test(versionDirectory.name) && versionDirectory.isDirectory()) {
          count += 1;
          if (count >= maximumInstalledPackages) {
            return count;
          }
        }
      }
    }
    return count;
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function validateGrantedCapabilities(
  manifest: PluginPackageManifest,
  requestedGrants: readonly string[],
): PluginCapability[] {
  if (new Set(requestedGrants).size !== requestedGrants.length) {
    throw new PluginLifecycleError('unsupported-capability', 'A capability grant was repeated.');
  }
  for (const capability of requestedGrants) {
    if (!manifest.requestedCapabilities.includes(capability)) {
      throw new PluginLifecycleError('unsupported-capability', 'The plugin did not request a granted capability.');
    }
    if (!supportedCapabilities.has(capability as PluginCapability)) {
      throw new PluginLifecycleError('unsupported-capability', 'The host does not implement a requested capability.');
    }
  }
  return [...requestedGrants] as PluginCapability[];
}

function validateContribution(
  manifest: PluginPackageManifest,
  contributionId: string | undefined,
): string | undefined {
  if (contributionId === undefined) {
    return undefined;
  }
  if (!manifest.contributions?.tools.some(tool => tool.id === contributionId)) {
    throw new PluginLifecycleError(
      'contribution-not-found',
      'The requested tool contribution is not declared by this plugin package.',
    );
  }
  return contributionId;
}

function completeResponsivenessProbe(active: ActivePlugin, probeTimeout: ReturnType<typeof setTimeout>): void {
  if (active.responsivenessProbeTimeout !== probeTimeout) {
    return;
  }
  clearTimeout(probeTimeout);
  active.responsivenessProbeTimeout = undefined;
  active.responsivenessProbePending = false;
}

function sameItems(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(item => right.includes(item));
}

function getPluginPackageKey(pluginId: string, version: string): string {
  return `${pluginId}\u0000${version}`;
}

function pushSnapshot(snapshots: PluginLifecycleSnapshot[], snapshot: PluginLifecycleSnapshot): void {
  if (snapshots.length >= maximumInstalledPackages) {
    throw new PluginPackageError('resource-limit', 'The plugin installation contains too many packages.');
  }
  snapshots.push(snapshot);
}

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
}

function getErrorCode(error: unknown): string {
  return error instanceof PluginPackageError || error instanceof PluginLifecycleError
    ? error.code
    : 'invalid-package';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
