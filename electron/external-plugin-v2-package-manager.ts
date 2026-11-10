import { lstat, mkdir, opendir, readFile, readdir, realpath, rm, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { PluginPackageError } from './plugin-package-manifest';
import type { PluginPackageSigningKey, StagePluginPackageOptions } from './plugin-package-manifest';
import {
  stageExternalPluginV2PackageArchive,
} from './plugin-package';
import {
  parseExternalPluginV2PackageManifest,
  type ExternalPluginV2PackageManifest,
  type ExternalPluginV2Runtime,
} from './plugin-package-v2';
import type { ExternalPluginV2Contributions } from '../src/shared/external-plugin-v2';

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const manifestFileName = 'plugin.json';

export type ExternalPluginV2PackageStatus = 'installed' | 'invalid';

export interface ExternalPluginV2PackageSnapshot {
  readonly pluginId: string;
  readonly name: string;
  readonly version: string;
  readonly runtime: ExternalPluginV2Runtime;
  readonly manifest: import('../src/shared/external-plugin-v2').ExternalPluginV2Manifest;
  readonly requestedCapabilities: readonly string[];
  readonly contributions: ExternalPluginV2Contributions;
  readonly status: ExternalPluginV2PackageStatus;
  readonly errorCode?: string;
}

export interface ExternalPluginV2PackageStateChangeEvent {
  readonly pluginId: string;
  readonly version: string;
  readonly reason: 'installed' | 'uninstalled';
}

export interface ExternalPluginV2PackageManagerOptions {
  readonly installRoot: string;
  readonly hostApiVersion: string;
  readonly trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>;
  readonly onStateChange?: (event: ExternalPluginV2PackageStateChangeEvent) => void;
}

/** 管理 v2 静态包的扫描、安装和卸载；不启动入口，也不授予运行能力。 */
export class ExternalPluginV2PackageManager {
  private readonly installRoot: string;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: ExternalPluginV2PackageManagerOptions) {
    this.installRoot = resolve(options.installRoot);
  }

  async listInstalled(): Promise<ExternalPluginV2PackageSnapshot[]> {
    return this.runExclusive(async () => {
      const root = await this.ensureInstallRoot();
      const snapshots: ExternalPluginV2PackageSnapshot[] = [];
      for await (const pluginDirectory of await opendir(root)) {
        if (!pluginIdPattern.test(pluginDirectory.name) || !pluginDirectory.isDirectory() || pluginDirectory.isSymbolicLink()) {
          continue;
        }
        const pluginRoot = resolve(root, pluginDirectory.name);
        for await (const versionDirectory of await opendir(pluginRoot)) {
          if (!versionPattern.test(versionDirectory.name) || !versionDirectory.isDirectory() || versionDirectory.isSymbolicLink()) {
            continue;
          }
          try {
            const packageRoot = await this.getInstalledPackageRoot(pluginDirectory.name, versionDirectory.name);
            const manifest = await this.readInstalledManifest(packageRoot);
            snapshots.push(toSnapshot(manifest));
          }
          catch (error) {
            snapshots.push(invalidSnapshot(pluginDirectory.name, versionDirectory.name, getErrorCode(error)));
          }
        }
      }
      return snapshots.sort((left, right) => (
        left.pluginId.localeCompare(right.pluginId) || left.version.localeCompare(right.version)
      ));
    });
  }

  async installArchive(archivePath: string): Promise<ExternalPluginV2PackageSnapshot> {
    return this.runExclusive(async () => {
      const staged = await stageExternalPluginV2PackageArchive(this.stageOptions(archivePath));
      const snapshot = toSnapshot(staged.manifest);
      this.options.onStateChange?.({ pluginId: snapshot.pluginId, version: snapshot.version, reason: 'installed' });
      return snapshot;
    });
  }

  async uninstall(pluginId: string, version: string): Promise<boolean> {
    return this.runExclusive(async () => {
      const packageRoot = await this.getInstalledPackageRoot(pluginId, version);
      await rm(packageRoot, { recursive: true, force: false });
      const pluginRoot = dirname(packageRoot);
      if ((await readdir(pluginRoot)).length === 0) {
        await rmdir(pluginRoot);
      }
      this.options.onStateChange?.({ pluginId, version, reason: 'uninstalled' });
      return true;
    });
  }

  async getInstalledManifest(pluginId: string, version: string): Promise<ExternalPluginV2PackageManifest> {
    return this.runExclusive(async () => this.readInstalledManifest(await this.getInstalledPackageRoot(pluginId, version)));
  }

  private stageOptions(archivePath: string): StagePluginPackageOptions {
    return {
      archivePath,
      installRoot: this.installRoot,
      hostApiVersion: this.options.hostApiVersion,
      trustedSigningKeys: this.options.trustedSigningKeys,
    };
  }

  private async readInstalledManifest(packageRoot: string): Promise<ExternalPluginV2PackageManifest> {
    const bytes = await readFile(resolve(packageRoot, manifestFileName));
    return parseExternalPluginV2PackageManifest(bytes, this.options.hostApiVersion, this.options.trustedSigningKeys);
  }

  private async ensureInstallRoot(): Promise<string> {
    await mkdir(this.installRoot, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.installRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new PluginPackageError('unsafe-archive-entry', 'The external plugin v2 install root must be a real directory.');
    }
    return realpath(this.installRoot);
  }

  private async getInstalledPackageRoot(pluginId: string, version: string): Promise<string> {
    if (!pluginIdPattern.test(pluginId) || !versionPattern.test(version)) {
      throw new PluginPackageError('invalid-package', 'The external plugin v2 package identity is invalid.');
    }
    const root = await this.ensureInstallRoot();
    const packageRoot = resolve(root, pluginId, version);
    if (!isContainedPath(root, packageRoot)) {
      throw new PluginPackageError('unsafe-archive-entry', 'The external plugin v2 package path escaped its install root.');
    }
    const metadata = await lstat(packageRoot).catch((error: unknown) => {
      throw new PluginPackageError('invalid-package', 'The external plugin v2 package is not installed.', { cause: error });
    });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new PluginPackageError('unsafe-archive-entry', 'The external plugin v2 package path must be a real directory.');
    }
    const canonicalRoot = await realpath(root);
    const canonicalPackageRoot = await realpath(packageRoot);
    if (!isContainedPath(canonicalRoot, canonicalPackageRoot)) {
      throw new PluginPackageError('unsafe-archive-entry', 'The external plugin v2 package escaped its install root.');
    }
    return canonicalPackageRoot;
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    }
    finally {
      release();
    }
  }
}

function toSnapshot(manifest: ExternalPluginV2PackageManifest): ExternalPluginV2PackageSnapshot {
  return {
    pluginId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    runtime: manifest.runtime,
    manifest: {
      formatVersion: manifest.formatVersion,
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      apiVersion: manifest.apiVersion,
      requestedCapabilities: [...manifest.requestedCapabilities],
      activationEvents: [...manifest.activationEvents],
      contributions: manifest.contributions,
    },
    requestedCapabilities: [...manifest.requestedCapabilities],
    contributions: manifest.contributions,
    status: 'installed',
  };
}

function invalidSnapshot(pluginId: string, version: string, errorCode: string): ExternalPluginV2PackageSnapshot {
  return {
    pluginId,
    name: pluginId,
    version,
    runtime: 'process',
    manifest: {
      formatVersion: 2,
      id: pluginId,
      name: pluginId,
      version,
      apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
      requestedCapabilities: [],
      activationEvents: [],
      contributions: { tools: [], commands: [] },
    },
    requestedCapabilities: [],
    contributions: { tools: [], commands: [] },
    status: 'invalid',
    errorCode,
  };
}

function getErrorCode(error: unknown): string {
  return error instanceof PluginPackageError ? error.code : 'invalid-package';
}

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}
