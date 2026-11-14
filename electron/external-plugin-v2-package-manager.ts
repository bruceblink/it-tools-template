import { createHash } from 'node:crypto';
import { lstat, mkdir, opendir, readFile, readdir, realpath, rm, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pluginPackageLimits, PluginPackageError } from './plugin-package-manifest';
import type { PluginPackageSigningKey, StagePluginPackageOptions } from './plugin-package-manifest';
import {
  stageExternalPluginV2PackageArchive,
} from './plugin-package';
import {
  parseExternalPluginV2PackageManifest,
  type ExternalPluginV2PackageManifest,
  type ExternalPluginV2Runtime,
} from './plugin-package-v2';
import {
  ExternalPluginV2LifecycleStore,
  type ExternalPluginV2LifecycleState,
} from './external-plugin-v2-lifecycle-store';
import type { ExternalPluginV2Contributions } from '../src/shared/external-plugin-v2';
import type {
  DesktopPluginV2RuntimeFailureCode,
  DesktopPluginV2RuntimeStatus,
} from '../src/shared/desktop-services/plugins';

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
  readonly active: boolean;
  readonly enabled: boolean;
  readonly runtimeStatus: DesktopPluginV2RuntimeStatus;
  readonly runtimeFailureCode?: DesktopPluginV2RuntimeFailureCode;
  readonly errorCode?: string;
}

export interface ExternalPluginV2ExecutionContext {
  readonly manifest: ExternalPluginV2PackageManifest;
  readonly packageRoot: string;
  readonly entrypoint: string;
  readonly entrypointSha256: string;
}

export interface ExternalPluginV2PackageStateChangeEvent {
  readonly pluginId: string;
  readonly version: string;
  readonly reason: 'installed' | 'uninstalled' | 'activated' | 'deactivated' | 'enabled' | 'disabled' | 'runtime-failure' | 'runtime-recovered';
  readonly runtimeFailureCode?: DesktopPluginV2RuntimeFailureCode;
}

export interface ExternalPluginV2PackageManagerOptions {
  readonly installRoot: string;
  readonly hostApiVersion: string;
  readonly trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>;
  readonly onStateChange?: (event: ExternalPluginV2PackageStateChangeEvent) => void;
}

/** 管理 v2 静态包、活动版本和启用状态；不启动入口，也不授予运行能力。 */
export class ExternalPluginV2PackageManager {
  private readonly installRoot: string;
  private readonly lifecycleStore: ExternalPluginV2LifecycleStore;
  private operationQueue: Promise<void> = Promise.resolve();
  /** 运行失败只在当前主进程保留，重启应用后由下一次执行重新探测。 */
  private readonly runtimeFailures = new Map<string, DesktopPluginV2RuntimeFailureCode>();

  constructor(private readonly options: ExternalPluginV2PackageManagerOptions) {
    this.installRoot = resolve(options.installRoot);
    this.lifecycleStore = new ExternalPluginV2LifecycleStore(resolve(this.installRoot, 'active.json'));
  }

  async listInstalled(): Promise<ExternalPluginV2PackageSnapshot[]> {
    return this.runExclusive(async () => {
      const root = await this.ensureInstallRoot();
      await this.lifecycleStore.load();
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
            await verifyInstalledFiles(packageRoot, manifest);
            snapshots.push(toSnapshot(manifest, this.runtimeFailures.get(getPackageKey(manifest.id, manifest.version))));
          }
          catch (error) {
            snapshots.push(invalidSnapshot(pluginDirectory.name, versionDirectory.name, getErrorCode(error)));
          }
        }
      }
      const snapshotsByPlugin = new Map<string, ExternalPluginV2PackageSnapshot[]>();
      for (const snapshot of snapshots) {
        const pluginSnapshots = snapshotsByPlugin.get(snapshot.pluginId) ?? [];
        pluginSnapshots.push(snapshot);
        snapshotsByPlugin.set(snapshot.pluginId, pluginSnapshots);
      }
      for (const [pluginId, pluginSnapshots] of snapshotsByPlugin) {
        const lifecycle = await this.normalizeLifecycle(pluginId, pluginSnapshots);
        snapshotsByPlugin.set(pluginId, pluginSnapshots.map(snapshot => ({
          ...snapshot,
          active: snapshot.status === 'installed' && lifecycle?.activeVersion === snapshot.version,
          enabled: snapshot.status === 'installed' && (lifecycle?.enabled ?? true),
        })));
      }
      return snapshots.flatMap(snapshot => {
        const lifecycle = snapshotsByPlugin.get(snapshot.pluginId)?.find(candidate => candidate.version === snapshot.version);
        return lifecycle ? [lifecycle] : [snapshot];
      }).sort((left, right) => (
        left.pluginId.localeCompare(right.pluginId) || left.version.localeCompare(right.version)
      ));
    });
  }

  async installArchive(archivePath: string): Promise<ExternalPluginV2PackageSnapshot> {
    return this.runExclusive(async () => {
      await this.ensureInstallRoot();
      await this.lifecycleStore.load();
      const staged = await stageExternalPluginV2PackageArchive(this.stageOptions(archivePath));
      const previousLifecycle = await this.lifecycleStore.get(staged.manifest.id);
      try {
        await this.lifecycleStore.set(staged.manifest.id, {
          activeVersion: staged.manifest.version,
          enabled: previousLifecycle?.enabled ?? true,
        });
      }
      catch (error) {
        // 未有旧状态时清理新目录；已有旧状态时保留旧活动版本和新包供后续重试。
        if (!previousLifecycle) {
          await this.removePackageRoot(staged.packageRoot);
        }
        throw error;
      }
      this.runtimeFailures.delete(getPackageKey(staged.manifest.id, staged.manifest.version));
      const snapshot = toSnapshot(staged.manifest, undefined, {
        activeVersion: staged.manifest.version,
        enabled: previousLifecycle?.enabled ?? true,
      });
      if (previousLifecycle && previousLifecycle.activeVersion !== staged.manifest.version) {
        this.options.onStateChange?.({ pluginId: staged.manifest.id, version: previousLifecycle.activeVersion, reason: 'deactivated' });
      }
      this.options.onStateChange?.({ pluginId: snapshot.pluginId, version: snapshot.version, reason: 'installed' });
      this.options.onStateChange?.({ pluginId: snapshot.pluginId, version: snapshot.version, reason: 'activated' });
      return snapshot;
    });
  }

  /** 验证已安装包后切换活动版本；验证失败时保留旧版本。 */
  async activate(pluginId: string, version: string): Promise<ExternalPluginV2PackageSnapshot> {
    return this.runExclusive(async () => {
      await this.ensureInstallRoot();
      await this.lifecycleStore.load();
      const execution = await this.getInstalledExecutionContextUnlocked(pluginId, version);
      const previous = await this.lifecycleStore.get(pluginId);
      const enabled = previous?.enabled ?? true;
      if (previous?.activeVersion === version) {
        return toSnapshot(execution.manifest, this.runtimeFailures.get(getPackageKey(pluginId, version)), {
          activeVersion: version,
          enabled,
        });
      }
      const nextLifecycle = { activeVersion: execution.manifest.version, enabled } satisfies ExternalPluginV2LifecycleState;
      await this.lifecycleStore.set(pluginId, nextLifecycle);
      if (previous) {
        this.options.onStateChange?.({ pluginId, version: previous.activeVersion, reason: 'deactivated' });
      }
      this.options.onStateChange?.({ pluginId, version, reason: 'activated' });
      return toSnapshot(execution.manifest, this.runtimeFailures.get(getPackageKey(pluginId, version)), nextLifecycle);
    });
  }

  /** 修改当前活动版本的启用状态；禁用不会删除静态索引或安装数据。 */
  async setEnabled(pluginId: string, version: string, enabled: boolean): Promise<ExternalPluginV2PackageSnapshot> {
    return this.runExclusive(async () => {
      await this.ensureInstallRoot();
      await this.lifecycleStore.load();
      const execution = await this.getInstalledExecutionContextUnlocked(pluginId, version);
      const previous = await this.lifecycleStore.get(pluginId);
      if (previous && previous.activeVersion !== version) {
        throw new PluginPackageError('invalid-package', 'Only the active v2 plugin version can change its enabled state.');
      }
      const nextLifecycle = { activeVersion: previous?.activeVersion ?? version, enabled } satisfies ExternalPluginV2LifecycleState;
      await this.lifecycleStore.set(pluginId, nextLifecycle);
      if (previous?.enabled !== enabled) {
        this.options.onStateChange?.({ pluginId, version, reason: enabled ? 'enabled' : 'disabled' });
      }
      return toSnapshot(execution.manifest, this.runtimeFailures.get(getPackageKey(pluginId, version)), nextLifecycle);
    });
  }

  async uninstall(pluginId: string, version: string): Promise<boolean> {
    return this.runExclusive(async () => {
      await this.ensureInstallRoot();
      await this.lifecycleStore.load();
      const packageRoot = await this.getInstalledPackageRoot(pluginId, version);
      const lifecycle = await this.lifecycleStore.get(pluginId);
      const isActive = lifecycle?.activeVersion === version;
      const replacement = isActive ? await this.findHighestValidVersion(pluginId, version) : undefined;
      if (isActive) {
        if (replacement) {
          await this.lifecycleStore.set(pluginId, { activeVersion: replacement, enabled: lifecycle?.enabled ?? true });
        }
        else {
          await this.lifecycleStore.delete(pluginId);
        }
      }
      try {
        await this.removePackageRoot(packageRoot);
      }
      catch (error) {
        // 删除失败时尽力恢复旧活动状态；即使恢复失败，当前目录仍保留可发现的包。
        if (isActive) {
          try {
            await this.lifecycleStore.set(pluginId, { activeVersion: version, enabled: lifecycle?.enabled ?? true });
          }
          catch {
            // 保留原始删除错误，避免掩盖失败原因。
          }
        }
        throw error;
      }
      this.runtimeFailures.delete(getPackageKey(pluginId, version));
      this.options.onStateChange?.({ pluginId, version, reason: 'uninstalled' });
      if (replacement) {
        this.options.onStateChange?.({ pluginId, version: replacement, reason: 'activated' });
      }
      return true;
    });
  }

  /** 标记可重试的扩展宿主故障，但保留工具静态索引。 */
  markRuntimeFailure(pluginId: string, version: string, code: DesktopPluginV2RuntimeFailureCode): void {
    const key = getPackageKey(pluginId, version);
    if (this.runtimeFailures.get(key) === code) {
      return;
    }
    this.runtimeFailures.set(key, code);
    this.options.onStateChange?.({
      pluginId,
      version,
      reason: 'runtime-failure',
      runtimeFailureCode: code,
    });
  }

  /** 成功完成一次命令后清除同一包的故障状态。 */
  clearRuntimeFailure(pluginId: string, version: string): void {
    const key = getPackageKey(pluginId, version);
    if (!this.runtimeFailures.delete(key)) {
      return;
    }
    this.options.onStateChange?.({ pluginId, version, reason: 'runtime-recovered' });
  }

  async getInstalledManifest(pluginId: string, version: string): Promise<ExternalPluginV2PackageManifest> {
    return this.runExclusive(async () => this.readInstalledManifest(await this.getInstalledPackageRoot(pluginId, version)));
  }

  /** 读取并复核已安装包的所有文件，避免安装后篡改入口或依赖文件。 */
  async getInstalledExecutionContext(pluginId: string, version: string): Promise<ExternalPluginV2ExecutionContext> {
    return this.runExclusive(async () => this.getInstalledExecutionContextUnlocked(pluginId, version));
  }

  async getLifecycle(pluginId: string, version: string): Promise<{ active: boolean; enabled: boolean }> {
    return this.runExclusive(async () => {
      await this.ensureInstallRoot();
      await this.lifecycleStore.load();
      await this.getInstalledPackageRoot(pluginId, version);
      const lifecycle = await this.lifecycleStore.get(pluginId);
      return { active: lifecycle?.activeVersion === version, enabled: lifecycle?.enabled ?? true };
    });
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

  private async getInstalledExecutionContextUnlocked(pluginId: string, version: string): Promise<ExternalPluginV2ExecutionContext> {
    const packageRoot = await this.getInstalledPackageRoot(pluginId, version);
    const manifest = await this.readInstalledManifest(packageRoot);
    await verifyInstalledFiles(packageRoot, manifest);
    const entrypointFile = manifest.files.find(file => file.path === manifest.entrypoint);
    if (!entrypointFile) {
      throw new PluginPackageError('invalid-package', 'The installed v2 entrypoint is missing from its signed file list.');
    }
    return {
      manifest,
      packageRoot,
      entrypoint: manifest.entrypoint,
      entrypointSha256: entrypointFile.sha256,
    };
  }

  private async normalizeLifecycle(
    pluginId: string,
    snapshots: readonly ExternalPluginV2PackageSnapshot[],
  ): Promise<ExternalPluginV2LifecycleState | undefined> {
    const installed = snapshots.filter(snapshot => snapshot.status === 'installed');
    if (installed.length === 0) {
      return undefined;
    }
    const current = await this.lifecycleStore.get(pluginId);
    const active = installed.some(snapshot => snapshot.version === current?.activeVersion)
      ? current!.activeVersion
      : installed.map(snapshot => snapshot.version).sort(compareVersions).at(-1)!;
    const next = { activeVersion: active, enabled: current?.enabled ?? true } satisfies ExternalPluginV2LifecycleState;
    if (current?.activeVersion !== next.activeVersion || current.enabled !== next.enabled) {
      await this.lifecycleStore.set(pluginId, next);
    }
    return next;
  }

  private async findHighestValidVersion(pluginId: string, excludedVersion: string): Promise<string | undefined> {
    const pluginRoot = resolve(await this.ensureInstallRoot(), pluginId);
    const candidates: string[] = [];
    for await (const entry of await opendir(pluginRoot)) {
      if (entry.name === excludedVersion || !versionPattern.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      try {
        const packageRoot = await this.getInstalledPackageRoot(pluginId, entry.name);
        const manifest = await this.readInstalledManifest(packageRoot);
        await verifyInstalledFiles(packageRoot, manifest);
        candidates.push(manifest.version);
      }
      catch {
        // 版本回退只选择完整校验通过的包；损坏包保留在磁盘供诊断。
      }
    }
    return candidates.sort(compareVersions).at(-1);
  }

  private async removePackageRoot(packageRoot: string): Promise<void> {
    await rm(packageRoot, { recursive: true, force: false });
    const pluginRoot = dirname(packageRoot);
    if ((await readdir(pluginRoot)).length === 0) {
      await rmdir(pluginRoot);
    }
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

function toSnapshot(
  manifest: ExternalPluginV2PackageManifest,
  runtimeFailureCode?: DesktopPluginV2RuntimeFailureCode,
  lifecycle?: ExternalPluginV2LifecycleState,
): ExternalPluginV2PackageSnapshot {
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
    active: lifecycle?.activeVersion === manifest.version,
    enabled: lifecycle?.enabled ?? true,
    runtimeStatus: runtimeFailureCode === undefined ? 'ready' : 'unavailable',
    ...(runtimeFailureCode === undefined ? {} : { runtimeFailureCode }),
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
    active: false,
    enabled: false,
    runtimeStatus: 'ready',
    errorCode,
  };
}

function getPackageKey(pluginId: string, version: string): string {
  return `${pluginId}@${version}`;
}

function getErrorCode(error: unknown): string {
  return error instanceof PluginPackageError ? error.code : 'invalid-package';
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

async function verifyInstalledFiles(
  packageRoot: string,
  manifest: ExternalPluginV2PackageManifest,
): Promise<void> {
  let totalBytes = 0;
  for (const file of manifest.files) {
    const filePath = resolve(packageRoot, ...file.path.split('/'));
    if (!isContainedPath(packageRoot, filePath)) {
      throw new PluginPackageError('unsafe-archive-entry', 'The installed v2 file escaped its package root.');
    }
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new PluginPackageError('unsafe-archive-entry', `The installed v2 file is not a regular file: ${file.path}.`);
    }
    totalBytes += metadata.size;
    if (metadata.size > pluginPackageLimits.maximumAssetBytes || totalBytes > pluginPackageLimits.maximumExpandedBytes) {
      throw new PluginPackageError('resource-limit', 'The installed v2 files exceed their size limit.');
    }
    const canonicalPath = await realpath(filePath);
    if (!isContainedPath(packageRoot, canonicalPath)) {
      throw new PluginPackageError('unsafe-archive-entry', 'The installed v2 file escaped its package root.');
    }
    const actualHash = createHash('sha256').update(await readFile(canonicalPath)).digest('hex');
    if (actualHash !== file.sha256) {
      throw new PluginPackageError('file-hash-mismatch', `The installed v2 file hash does not match ${file.path}.`);
    }
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}
