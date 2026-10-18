import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, opendir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  normalizePluginPackagePath,
  parsePluginPackageManifest,
  pluginPackageLimits,
  PluginPackageError,
} from './plugin-package-manifest';
import type {
  PluginPackageManifest,
  PluginPackageSigningKey,
} from './plugin-package';

interface PackageTree {
  files: Map<string, { path: string; size: number }>;
  directories: Set<string>;
}

const maximumInstalledTreeEntries = pluginPackageLimits.maximumFiles * pluginPackageLimits.maximumPathSegments + 1;

/** Recheck the signed manifest and every installed file before executing package code. */
export async function verifyInstalledPluginPackage(options: {
  installRoot: string;
  packageRoot: string;
  pluginId: string;
  version: string;
  hostApiVersion: string;
  trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>;
}): Promise<PluginPackageManifest> {
  const canonicalInstallRoot = await realpath(options.installRoot);
  const packageMetadata = await lstat(options.packageRoot).catch((error: unknown) => {
    throw new PluginPackageError('invalid-package', 'The installed plugin package cannot be read.', { cause: error });
  });
  if (!packageMetadata.isDirectory() || packageMetadata.isSymbolicLink()) {
    throw new PluginPackageError('unsafe-archive-entry', 'The installed plugin package root must be a real directory.');
  }
  const canonicalPackageRoot = await realpath(options.packageRoot);
  if (!isPathContained(canonicalInstallRoot, canonicalPackageRoot)) {
    throw new PluginPackageError('unsafe-archive-entry', 'The installed plugin package escaped its trusted root.');
  }

  const manifest = await readInstalledPluginManifest({
    packageRoot: canonicalPackageRoot,
    pluginId: options.pluginId,
    version: options.version,
    hostApiVersion: options.hostApiVersion,
    trustedSigningKeys: options.trustedSigningKeys,
  });
  const tree = await inspectInstalledPackageTree(canonicalPackageRoot);
  const expectedFiles = new Set(['plugin.json', ...manifest.files.map(file => file.path)]);
  const expectedDirectories = new Set<string>();
  for (const file of manifest.files) {
    const segments = file.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join('/'));
    }
  }
  if (
    tree.files.size !== expectedFiles.size
    || [...tree.files.keys()].some(path => !expectedFiles.has(path))
    || tree.directories.size !== expectedDirectories.size
    || [...tree.directories].some(path => !expectedDirectories.has(path))
  ) {
    throw new PluginPackageError('invalid-package', 'The installed plugin files do not match the signed manifest.');
  }

  for (const file of manifest.files) {
    const installedFile = tree.files.get(file.path);
    if (!installedFile || await hashInstalledFile(canonicalPackageRoot, installedFile.path, installedFile.size) !== file.sha256) {
      throw new PluginPackageError('file-hash-mismatch', 'An installed plugin file does not match its signed hash.');
    }
  }
  return manifest;
}

/** Read signed metadata for listings without hashing assets until activation. */
export async function readInstalledPluginManifest(options: {
  packageRoot: string;
  pluginId: string;
  version: string;
  hostApiVersion: string;
  trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>;
}): Promise<PluginPackageManifest> {
  const manifestPath = resolve(options.packageRoot, 'plugin.json');
  const metadata = await lstat(manifestPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > pluginPackageLimits.maximumManifestBytes) {
    throw new PluginPackageError('invalid-package', 'The installed plugin manifest is not a bounded regular file.');
  }
  const manifest = parsePluginPackageManifest(
    await readFile(manifestPath),
    options.hostApiVersion,
    options.trustedSigningKeys,
  );
  if (manifest.id !== options.pluginId || manifest.version !== options.version) {
    throw new PluginPackageError('invalid-package', 'The installed plugin identity does not match its directory.');
  }
  return manifest;
}

async function inspectInstalledPackageTree(packageRoot: string): Promise<PackageTree> {
  const files = new Map<string, { path: string; size: number }>();
  const directories = new Set<string>();
  const pending = [{ absolutePath: packageRoot, relativePath: '' }];
  let entryCount = 0;
  let expandedBytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const directoryMetadata = await lstat(directory.absolutePath);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new PluginPackageError('unsafe-archive-entry', 'The installed plugin package contains a directory link.');
    }
    const canonicalDirectory = await realpath(directory.absolutePath);
    if (!isPathContained(packageRoot, canonicalDirectory)) {
      throw new PluginPackageError('unsafe-archive-entry', 'An installed plugin directory escaped its package root.');
    }

    for await (const entry of await opendir(canonicalDirectory)) {
      entryCount += 1;
      if (entryCount > maximumInstalledTreeEntries) {
        throw new PluginPackageError('resource-limit', 'The installed plugin package has too many files and directories.');
      }
      const relativePath = normalizePluginPackagePath(
        directory.relativePath === '' ? entry.name : `${directory.relativePath}/${entry.name}`,
      );
      const absolutePath = resolve(canonicalDirectory, entry.name);
      if (!isPathContained(packageRoot, absolutePath)) {
        throw new PluginPackageError('unsafe-archive-entry', 'An installed plugin path escaped its package root.');
      }
      const metadata = await lstat(absolutePath);
      if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
        throw new PluginPackageError('unsafe-archive-entry', 'The installed plugin package contains a symbolic link.');
      }
      if (entry.isDirectory() && metadata.isDirectory()) {
        directories.add(relativePath);
        pending.push({ absolutePath, relativePath });
        continue;
      }
      if (!entry.isFile() || !metadata.isFile() || metadata.nlink !== 1) {
        throw new PluginPackageError('unsafe-archive-entry', 'The installed plugin package contains a link or special file.');
      }
      const maximumBytes = relativePath === 'plugin.json'
        ? pluginPackageLimits.maximumManifestBytes
        : pluginPackageLimits.maximumAssetBytes;
      if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > maximumBytes) {
        throw new PluginPackageError('resource-limit', 'An installed plugin file exceeds its size limit.');
      }
      expandedBytes += metadata.size;
      if (expandedBytes > pluginPackageLimits.maximumExpandedBytes) {
        throw new PluginPackageError('resource-limit', 'The installed plugin package exceeds its expanded size limit.');
      }
      files.set(relativePath, { path: absolutePath, size: metadata.size });
    }
  }
  return { files, directories };
}

async function hashInstalledFile(packageRoot: string, path: string, expectedBytes: number): Promise<string> {
  const metadata = await lstat(path);
  const canonicalPath = await realpath(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || !isPathContained(packageRoot, canonicalPath)) {
    throw new PluginPackageError('unsafe-archive-entry', 'An installed plugin file changed to an unsafe path.');
  }

  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(canonicalPath)) {
      bytes += chunk.length;
      if (bytes > expectedBytes || bytes > pluginPackageLimits.maximumAssetBytes) {
        throw new PluginPackageError('resource-limit', 'An installed plugin file exceeded its declared size.');
      }
      hash.update(chunk);
    }
  }
  catch (error) {
    if (error instanceof PluginPackageError) {
      throw error;
    }
    throw new PluginPackageError('invalid-package', 'An installed plugin file could not be read.', { cause: error });
  }
  if (bytes !== expectedBytes) {
    throw new PluginPackageError('file-hash-mismatch', 'An installed plugin file changed during verification.');
  }
  return hash.digest('hex');
}

function isPathContained(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
}
