import { KeyObject } from 'node:crypto';

/** v2 包和源码打包器共用的安全限制。 */
export const pluginPackageLimits = Object.freeze({
  maximumArchiveBytes: 64 * 1024 * 1024,
  maximumExpandedBytes: 128 * 1024 * 1024,
  maximumAssetBytes: 16 * 1024 * 1024,
  maximumManifestBytes: 1024 * 1024,
  maximumFiles: 512,
  maximumEntries: 1024,
  maximumPathSegments: 32,
  maximumCompressionRatio: 100,
});

export const pluginPackageManifestPath = 'plugin.json';

export type PluginPackageErrorCode =
  | 'invalid-package'
  | 'invalid-archive'
  | 'unsafe-archive-entry'
  | 'resource-limit'
  | 'untrusted-signature'
  | 'file-hash-mismatch'
  | 'already-installed';

export class PluginPackageError extends Error {
  constructor(
    readonly code: PluginPackageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginPackageError';
  }
}

export interface PluginPackageSigningKey {
  publicKey: string | Buffer | KeyObject;
  allowedPluginIds: readonly string[];
}

export interface StagePluginPackageOptions {
  archivePath: string;
  installRoot: string;
  hostApiVersion: string;
  trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>;
}

/** v2 包暂存结果。 */
export interface StagedPluginPackage {
  readonly manifest: import('./plugin-package-v2').ExternalPluginV2PackageManifest;
  readonly packageRoot: string;
  readonly archiveBytes: number;
  readonly expandedBytes: number;
}

/** 统一校验归档路径，拒绝绝对路径、父目录和系统设备名。 */
export function normalizePluginPackagePath(fileName: string, isDirectory = false): string {
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.includes('\\') || fileName.startsWith('/') || /^[A-Za-z]:/.test(fileName)) {
    throw new PluginPackageError('unsafe-archive-entry', 'The plugin package contains an unsafe file path.');
  }
  const segments = fileName.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new PluginPackageError('unsafe-archive-entry', 'The plugin package contains an unsafe file path.');
  }
  if (segments.length > pluginPackageLimits.maximumPathSegments) {
    throw new PluginPackageError('resource-limit', 'The plugin package path is too deep.');
  }
  const deviceNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (segments.some(segment => deviceNamePattern.test(segment))) {
    throw new PluginPackageError('unsafe-archive-entry', 'The plugin package contains a reserved device name.');
  }
  if (isDirectory && !fileName.endsWith('/')) {
    return `${fileName}/`;
  }
  return fileName;
}
