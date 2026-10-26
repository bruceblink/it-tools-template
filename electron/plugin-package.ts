import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import {
  normalizePluginPackagePath,
  parsePluginPackageManifest,
  pluginPackageLimits,
  pluginPackageManifestPath as packageManifestPath,
  PluginPackageError,
} from './plugin-package-manifest';
import type {
  PluginPackageManifest,
  StagePluginPackageOptions,
  StagedPluginPackage,
} from './plugin-package-manifest';

export {
  getPluginPackageSigningPayload,
  PluginPackageError,
  pluginPackageLimits,
  validatePluginPackageManifest,
} from './plugin-package-manifest';
export type {
  PluginPackageErrorCode,
  PluginPackageCapability,
  PluginPackageContributions,
  PluginPackageFile,
  PluginPackageManifest,
  PluginPackageSigningKey,
  PluginPackageToolContribution,
  PluginPackageUnsignedManifest,
  StagePluginPackageOptions,
  StagedPluginPackage,
} from './plugin-package-manifest';

const unixRegularFile = 0o100000;
const unixDirectory = 0o040000;
const unixFileTypeMask = 0o170000;
const unixCreatorSystems = new Set([3, 19]);
const windowsReparsePoint = 0x0400;
const stagingDirectoryPrefix = '.plugin-staging-';

interface ArchiveEntry {
  entry: Entry;
  path: string;
  isDirectory: boolean;
}

interface ParsedArchive {
  entries: ArchiveEntry[];
  manifestEntry: ArchiveEntry;
  expandedBytes: number;
}

const installQueues = new Map<string, Promise<void>>();

/** Stage a signed, prebuilt package without executing scripts or modifying an installed version. */
export async function stagePluginPackageArchive(options: StagePluginPackageOptions): Promise<StagedPluginPackage> {
  const archiveMetadata = await stat(options.archivePath).catch((error: unknown) => {
    throw new PluginPackageError('invalid-archive', 'The plugin package archive cannot be read.', { cause: error });
  });
  if (!archiveMetadata.isFile() || archiveMetadata.size <= 0) {
    throw new PluginPackageError('invalid-archive', 'The plugin package archive must be a non-empty file.');
  }
  if (archiveMetadata.size > pluginPackageLimits.maximumArchiveBytes) {
    throw new PluginPackageError('resource-limit', 'The plugin package archive exceeds the compressed size limit.');
  }

  await mkdir(options.installRoot, { recursive: true, mode: 0o700 });
  const canonicalInstallRoot = await realpath(options.installRoot);
  return withInstallQueue(canonicalInstallRoot, async () => {
    await cleanupInterruptedStaging(canonicalInstallRoot);
    return stageArchiveInInstallRoot(options, canonicalInstallRoot, archiveMetadata.size);
  });
}

async function stageArchiveInInstallRoot(
  options: StagePluginPackageOptions,
  installRoot: string,
  archiveBytes: number,
): Promise<StagedPluginPackage> {
  let zipFile: ZipFile | undefined;
  let stagingRoot: string | undefined;
  try {
    zipFile = await yauzl.openPromise(options.archivePath, {
      autoClose: false,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (zipFile.fileSize > pluginPackageLimits.maximumArchiveBytes) {
      throw new PluginPackageError('resource-limit', 'The plugin package archive exceeds the compressed size limit.');
    }
    const archive = await inspectArchive(zipFile);
    const manifestBytes = await readEntryBytes(zipFile, archive.manifestEntry.entry, pluginPackageLimits.maximumManifestBytes);
    const manifest = parsePluginPackageManifest(manifestBytes, options.hostApiVersion, options.trustedSigningKeys);
    validateArchiveMatchesManifest(archive, manifest);

    stagingRoot = await mkdtemp(resolve(installRoot, stagingDirectoryPrefix));
    let totalWrittenBytes = 0;
    for (const file of manifest.files) {
      const archiveEntry = archive.entries.find(candidate => !candidate.isDirectory && candidate.path === file.path);
      if (!archiveEntry) {
        throw new PluginPackageError('invalid-package', `The plugin package is missing ${file.path}.`);
      }
      const targetPath = resolve(stagingRoot, ...file.path.split('/'));
      if (!isContainedPath(stagingRoot, targetPath)) {
        throw new PluginPackageError('unsafe-archive-entry', 'The plugin package contains an unsafe file path.');
      }
      await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
      totalWrittenBytes = await extractAndVerifyFile(
        zipFile,
        archiveEntry.entry,
        targetPath,
        file.sha256,
        totalWrittenBytes,
      );
    }
    const installedManifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
    await writeFileExclusive(resolve(stagingRoot, packageManifestPath), installedManifestBytes);

    const pluginRoot = resolve(installRoot, manifest.id);
    try {
      await mkdir(pluginRoot, { mode: 0o700 });
    }
    catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') {
        throw error;
      }
    }
    const pluginRootMetadata = await lstat(pluginRoot);
    if (!pluginRootMetadata.isDirectory() || pluginRootMetadata.isSymbolicLink()) {
      throw new PluginPackageError('unsafe-archive-entry', 'The plugin install directory must be a real directory.');
    }
    const canonicalPluginRoot = await realpath(pluginRoot);
    if (!isContainedPath(installRoot, canonicalPluginRoot)) {
      throw new PluginPackageError('unsafe-archive-entry', 'The plugin install directory escaped its trusted root.');
    }
    const destination = resolve(canonicalPluginRoot, manifest.version);
    if (!isContainedPath(installRoot, destination)) {
      throw new PluginPackageError('unsafe-archive-entry', 'The plugin install path escaped its trusted root.');
    }
    if (await pathExists(destination)) {
      throw new PluginPackageError('already-installed', 'This plugin version is already installed.');
    }

    try {
      await rename(stagingRoot, destination);
    }
    catch (error) {
      if (isNodeError(error) && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')) {
        throw new PluginPackageError('already-installed', 'This plugin version is already installed.', { cause: error });
      }
      throw error;
    }
    stagingRoot = undefined;
    return {
      manifest,
      packageRoot: destination,
      archiveBytes,
      expandedBytes: totalWrittenBytes + installedManifestBytes.length,
    };
  }
  catch (error) {
    if (error instanceof PluginPackageError) {
      throw error;
    }
    throw new PluginPackageError('invalid-archive', 'The plugin package archive could not be safely staged.', { cause: error });
  }
  finally {
    if (zipFile?.isOpen) {
      zipFile.close();
    }
    if (stagingRoot) {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}

async function inspectArchive(zipFile: ZipFile): Promise<ParsedArchive> {
  const entries: ArchiveEntry[] = [];
  const entriesByPath = new Map<string, ArchiveEntry>();
  let manifestEntry: ArchiveEntry | undefined;
  let expandedBytes = 0;
  let fileCount = 0;

  try {
    for await (const entry of zipFile.eachEntry()) {
      if (entries.length >= pluginPackageLimits.maximumEntries) {
        throw new PluginPackageError('resource-limit', 'The plugin package has too many archive entries.');
      }
      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw new PluginPackageError('unsafe-archive-entry', 'The plugin package uses an unsupported or encrypted archive entry.');
      }
      if (
        !Number.isSafeInteger(entry.compressedSize)
        || !Number.isSafeInteger(entry.uncompressedSize)
        || entry.compressedSize < 0
        || entry.uncompressedSize < 0
      ) {
        throw new PluginPackageError('invalid-archive', 'The plugin package contains invalid archive sizes.');
      }

      const isDirectory = entry.fileName.endsWith('/');
      const path = normalizePluginPackagePath(entry.fileName, isDirectory);
      validateArchiveEntryType(entry, isDirectory);
      const normalizedKey = path.toLowerCase();
      if (entriesByPath.has(normalizedKey)) {
        throw new PluginPackageError('unsafe-archive-entry', 'The plugin package contains duplicate or case-colliding paths.');
      }
      for (const ancestor of getParentPaths(normalizedKey)) {
        if (entriesByPath.get(ancestor)?.isDirectory === false) {
          throw new PluginPackageError('unsafe-archive-entry', 'A plugin file path is nested under another file.');
        }
      }
      if (!isDirectory && [...entriesByPath.keys()].some(existingPath => existingPath.startsWith(`${normalizedKey}/`))) {
        throw new PluginPackageError('unsafe-archive-entry', 'A plugin file conflicts with an existing directory path.');
      }

      const archiveEntry = { entry, path, isDirectory };
      entries.push(archiveEntry);
      entriesByPath.set(normalizedKey, archiveEntry);
      if (isDirectory) {
        if (entry.uncompressedSize !== 0 || entry.compressedSize !== 0 || path === packageManifestPath) {
          throw new PluginPackageError('unsafe-archive-entry', 'The plugin package contains an invalid directory entry.');
        }
        continue;
      }

      fileCount += 1;
      if (fileCount > pluginPackageLimits.maximumFiles + 1) {
        throw new PluginPackageError('resource-limit', 'The plugin package has too many files.');
      }
      const maximumBytes = path === packageManifestPath
        ? pluginPackageLimits.maximumManifestBytes
        : pluginPackageLimits.maximumAssetBytes;
      if (entry.uncompressedSize > maximumBytes) {
        throw new PluginPackageError('resource-limit', 'A plugin package file exceeds its size limit.');
      }
      if (entry.uncompressedSize > 0 && entry.uncompressedSize / Math.max(entry.compressedSize, 1) > pluginPackageLimits.maximumCompressionRatio) {
        throw new PluginPackageError('resource-limit', 'A plugin package file exceeds the compression ratio limit.');
      }
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > pluginPackageLimits.maximumExpandedBytes) {
        throw new PluginPackageError('resource-limit', 'The plugin package exceeds the expanded size limit.');
      }
      if (path === packageManifestPath) {
        manifestEntry = archiveEntry;
      }
    }
  }
  catch (error) {
    if (error instanceof PluginPackageError) {
      throw error;
    }
    throw new PluginPackageError('invalid-archive', 'The plugin package archive is malformed.', { cause: error });
  }

  if (!manifestEntry) {
    throw new PluginPackageError('invalid-package', 'The plugin package has no root plugin.json manifest.');
  }
  return { entries, manifestEntry, expandedBytes };
}

function validateArchiveEntryType(entry: Entry, isDirectory: boolean): void {
  const creatorSystem = entry.versionMadeBy >>> 8;
  const unixMode = entry.externalFileAttributes >>> 16;
  const unixType = unixMode & unixFileTypeMask;
  if ((entry.externalFileAttributes & windowsReparsePoint) !== 0) {
    throw new PluginPackageError('unsafe-archive-entry', 'The plugin package contains a reparse-point entry.');
  }
  if (unixCreatorSystems.has(creatorSystem)) {
    const allowedTypes = isDirectory ? [0, unixDirectory] : [0, unixRegularFile];
    if (!allowedTypes.includes(unixType)) {
      throw new PluginPackageError('unsafe-archive-entry', 'The plugin package contains a link or special file.');
    }
  }
}

function validateArchiveMatchesManifest(archive: ParsedArchive, manifest: PluginPackageManifest): void {
  const archiveFiles = archive.entries.filter(entry => !entry.isDirectory && entry.path !== packageManifestPath);
  if (archiveFiles.length !== manifest.files.length) {
    throw new PluginPackageError('invalid-package', 'The plugin package file list does not match its archive.');
  }
  const manifestPaths = new Set(manifest.files.map(file => file.path));
  if (archiveFiles.some(file => !manifestPaths.has(file.path))) {
    throw new PluginPackageError('invalid-package', 'The plugin package contains an unlisted file.');
  }
}

async function readEntryBytes(zipFile: ZipFile, entry: Entry, maximumBytes: number): Promise<Buffer> {
  if (entry.uncompressedSize > maximumBytes) {
    throw new PluginPackageError('resource-limit', 'The plugin package manifest exceeds its size limit.');
  }
  const stream = await zipFile.openReadStreamPromise(entry, { decodeFileData: true });
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > maximumBytes) {
      stream.destroy();
      throw new PluginPackageError('resource-limit', 'The plugin package manifest exceeds its size limit.');
    }
    chunks.push(bytes);
  }
  if (totalBytes !== entry.uncompressedSize) {
    throw new PluginPackageError('invalid-archive', 'The plugin package manifest size does not match its archive.');
  }
  return Buffer.concat(chunks, totalBytes);
}

async function extractAndVerifyFile(
  zipFile: ZipFile,
  entry: Entry,
  destination: string,
  expectedHash: string,
  totalWrittenBytes: number,
): Promise<number> {
  const input = await zipFile.openReadStreamPromise(entry, { decodeFileData: true });
  const hash = createHash('sha256');
  let fileBytes = 0;
  let packageBytes = totalWrittenBytes;
  const verifySizeAndHash = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      fileBytes += chunk.length;
      packageBytes += chunk.length;
      if (
        fileBytes > pluginPackageLimits.maximumAssetBytes
        || packageBytes > pluginPackageLimits.maximumExpandedBytes
        || fileBytes > entry.uncompressedSize
      ) {
        callback(new PluginPackageError('resource-limit', 'The plugin package expanded beyond its declared size.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(input, verifySizeAndHash, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  }
  catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
  if (fileBytes !== entry.uncompressedSize) {
    throw new PluginPackageError('invalid-archive', 'The plugin package file size does not match its archive.');
  }
  if (hash.digest('hex') !== expectedHash) {
    throw new PluginPackageError('file-hash-mismatch', 'A plugin package file does not match its signed hash.');
  }
  return packageBytes;
}

async function writeFileExclusive(path: string, contents: Buffer): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(contents);
    await handle.sync();
  }
  catch (error) {
    await rm(path, { force: true });
    throw error;
  }
  finally {
    await handle?.close();
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  }
  catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function cleanupInterruptedStaging(installRoot: string): Promise<void> {
  const entries = await readdir(installRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(stagingDirectoryPrefix) && entry.isDirectory() && !entry.isSymbolicLink()) {
      await rm(resolve(installRoot, entry.name), { recursive: true, force: true });
    }
  }
}

async function withInstallQueue<T>(installRoot: string, operation: () => Promise<T>): Promise<T> {
  const previous = installQueues.get(installRoot) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  const queued = previous.then(() => current);
  installQueues.set(installRoot, queued);
  await previous;
  try {
    return await operation();
  }
  finally {
    release();
    if (installQueues.get(installRoot) === queued) {
      installQueues.delete(installRoot);
    }
  }
}

function getParentPaths(path: string): string[] {
  const segments = path.split('/');
  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join('/'));
  }
  return parents;
}

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
