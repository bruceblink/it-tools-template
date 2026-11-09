import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { DesktopPluginInstallSource } from '../src/shared/desktop-services/plugins';

const maximumProvenanceStoreBytes = 512 * 1024;
const maximumProvenanceEntries = 128;
const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const pluginVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const repositoryPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const commitPattern = /^[a-f0-9]{40}$/i;
const hashPattern = /^[a-f0-9]{64}$/i;
const sourceTagPattern = /^[^\u0000-\u001f\u007f]{1,256}$/;
const assetNamePattern = /^[^\\/\u0000-\u001f\u007f]{1,255}\.itplugin$/i;
const allowedAssetHosts = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const allowedSourceArchiveHosts = new Set(['codeload.github.com']);

export const pluginProvenanceStoreLimits = Object.freeze({
  maximumProvenanceStoreBytes,
  maximumProvenanceEntries,
});

export class PluginProvenanceStoreError extends Error {
  constructor(
    readonly code: 'invalid-store' | 'invalid-source' | 'store-unavailable',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginProvenanceStoreError';
  }
}

interface StoredProvenanceEntry {
  pluginId: string;
  version: string;
  source: DesktopPluginInstallSource;
}

interface StoredProvenanceState {
  schemaVersion: 1;
  entries: StoredProvenanceEntry[];
}

/**
 * Persist Release or fixed source snapshot provenance outside the signed package tree.
 *
 * Provenance is informational metadata. It never participates in package
 * verification or capability decisions, so an absent/corrupt store must not
 * make an otherwise valid package unusable.
 */
export class PluginProvenanceStore {
  private readonly statePath: string;
  private readonly entries = new Map<string, DesktopPluginInstallSource>();
  private loaded = false;

  constructor(statePath: string) {
    this.statePath = resolve(statePath);
  }

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.entries.clear();
    try {
      await this.ensureParentDirectory();
      const metadata = await lstat(this.statePath).catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return undefined;
        }
        throw new PluginProvenanceStoreError('store-unavailable', 'The plugin provenance store could not be inspected.', { cause: error });
      });
      if (!metadata) {
        this.loaded = true;
        return;
      }
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > maximumProvenanceStoreBytes) {
        this.loaded = true;
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(this.statePath))) as unknown;
      }
      catch {
        this.loaded = true;
        return;
      }
      const entries = validateStoredState(parsed);
      for (const entry of entries) {
        this.entries.set(getEntryKey(entry.pluginId, entry.version), entry.source);
      }
    }
    catch (error) {
      // Provenance is optional; retain an empty in-memory view if the file is
      // unavailable. A later write will surface a durable-store failure.
      if (!(error instanceof PluginProvenanceStoreError)) {
        this.loaded = true;
        return;
      }
    }
    this.loaded = true;
  }

  get(pluginId: string, version: string): DesktopPluginInstallSource | undefined {
    const source = this.entries.get(getEntryKey(pluginId, version));
    return source ? cloneSource(source) : undefined;
  }

  async set(pluginId: string, version: string, source: DesktopPluginInstallSource): Promise<void> {
    await this.load();
    if (!isValidPluginIdentity(pluginId, version)) {
      throw new PluginProvenanceStoreError('invalid-source', 'The plugin provenance identity is invalid.');
    }
    const normalized = normalizeSource(source);
    const key = getEntryKey(pluginId, version);
    const previous = this.entries.get(key);
    this.entries.set(key, normalized);
    try {
      await this.writeState();
    }
    catch (error) {
      if (previous) {
        this.entries.set(key, previous);
      }
      else {
        this.entries.delete(key);
      }
      throw error;
    }
  }

  async remove(pluginId: string, version: string): Promise<void> {
    await this.load();
    const key = getEntryKey(pluginId, version);
    if (!this.entries.has(key)) {
      return;
    }
    const previous = this.entries.get(key)!;
    this.entries.delete(key);
    try {
      await this.writeState();
    }
    catch (error) {
      this.entries.set(key, previous);
      throw error;
    }
  }

  private async ensureParentDirectory(): Promise<void> {
    const parentDirectory = dirname(this.statePath);
    await mkdir(parentDirectory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(parentDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new PluginProvenanceStoreError('store-unavailable', 'The plugin provenance store directory must be a real directory.');
    }
  }

  private async writeState(): Promise<void> {
    const existing = await lstat(this.statePath).catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return undefined;
      }
      throw new PluginProvenanceStoreError('store-unavailable', 'The plugin provenance store could not be inspected.', { cause: error });
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || existing.size > maximumProvenanceStoreBytes)) {
      throw new PluginProvenanceStoreError('invalid-store', 'The plugin provenance store is not a bounded regular file.');
    }
    if (this.entries.size > maximumProvenanceEntries) {
      throw new PluginProvenanceStoreError('invalid-store', 'The plugin provenance store has too many entries.');
    }
    const state: StoredProvenanceState = {
      schemaVersion: 1,
      entries: [...this.entries.entries()].map(([key, source]) => {
        const separator = key.indexOf('\u0000');
        return {
          pluginId: key.slice(0, separator),
          version: key.slice(separator + 1),
          source: cloneSource(source),
        };
      }),
    };
    const bytes = Buffer.from(`${JSON.stringify(state)}\n`, 'utf8');
    if (bytes.length > maximumProvenanceStoreBytes) {
      throw new PluginProvenanceStoreError('invalid-store', 'The plugin provenance store exceeds its size limit.');
    }

    const temporaryPath = resolve(dirname(this.statePath), `.plugin-provenance-${randomUUID()}.tmp`);
    let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      fileHandle = await open(temporaryPath, 'wx', 0o600);
      await fileHandle.writeFile(bytes);
      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = undefined;
      await rename(temporaryPath, this.statePath);
    }
    catch (error) {
      throw new PluginProvenanceStoreError('store-unavailable', 'The plugin provenance store could not be saved.', { cause: error });
    }
    finally {
      await fileHandle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
    }
  }
}

function validateStoredState(value: unknown): StoredProvenanceEntry[] {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.length > maximumProvenanceEntries) {
    return [];
  }
  const normalized: StoredProvenanceEntry[] = [];
  const keys = new Set<string>();
  for (const entry of value.entries) {
    if (!isRecord(entry) || typeof entry.pluginId !== 'string' || typeof entry.version !== 'string' || !isValidPluginIdentity(entry.pluginId, entry.version)) {
      continue;
    }
    try {
      const source = normalizeSource(entry.source);
      const key = getEntryKey(entry.pluginId, entry.version);
      if (keys.has(key)) {
        continue;
      }
      keys.add(key);
      normalized.push({ pluginId: entry.pluginId, version: entry.version, source });
    }
    catch {
      // Ignore individual stale entries while preserving the rest of the store.
    }
  }
  return normalized;
}

function normalizeSource(value: unknown): DesktopPluginInstallSource {
  if (!isRecord(value)) {
    throw new PluginProvenanceStoreError('invalid-source', 'The plugin provenance source is invalid.');
  }
  if (value.kind === 'source-snapshot') {
    return normalizeSourceSnapshot(value);
  }
  const keys = Object.keys(value);
  const expectedKeys = ['repository', 'tagName', 'commitSha', 'assetName', 'assetUrl', 'archiveBytes', 'sha256'];
  const hasReleaseKind = value.kind === 'release';
  if (
    (hasReleaseKind && keys.length !== expectedKeys.length + 1)
    || (!hasReleaseKind && value.kind !== undefined && value.kind !== 'release')
    || (!hasReleaseKind && keys.length !== expectedKeys.length)
    || keys.some(key => key !== 'kind' && !expectedKeys.includes(key))
  ) {
    throw new PluginProvenanceStoreError('invalid-source', 'The plugin provenance source has unexpected fields.');
  }
  if (
    typeof value.repository !== 'string' || !repositoryPattern.test(value.repository)
    || typeof value.tagName !== 'string' || !sourceTagPattern.test(value.tagName)
    || typeof value.commitSha !== 'string' || !commitPattern.test(value.commitSha)
    || typeof value.assetName !== 'string' || !assetNamePattern.test(value.assetName)
    || typeof value.assetUrl !== 'string'
    || typeof value.archiveBytes !== 'number' || !Number.isSafeInteger(value.archiveBytes) || value.archiveBytes <= 0 || value.archiveBytes > 64 * 1024 * 1024
    || typeof value.sha256 !== 'string' || !hashPattern.test(value.sha256)
  ) {
    throw new PluginProvenanceStoreError('invalid-source', 'The plugin provenance source contains invalid fields.');
  }
  let assetUrl: URL;
  try {
    assetUrl = new URL(value.assetUrl);
  }
  catch (error) {
    throw new PluginProvenanceStoreError('invalid-source', 'The plugin provenance asset URL is invalid.', { cause: error });
  }
  if (assetUrl.protocol !== 'https:' || !allowedAssetHosts.has(assetUrl.hostname.toLowerCase()) || assetUrl.port || assetUrl.username || assetUrl.password || assetUrl.search || assetUrl.hash) {
    throw new PluginProvenanceStoreError('invalid-source', 'The plugin provenance asset URL is not an approved HTTPS URL.');
  }
  return {
    repository: value.repository,
    tagName: value.tagName,
    commitSha: value.commitSha.toLowerCase(),
    assetName: value.assetName,
    assetUrl: assetUrl.href,
    archiveBytes: value.archiveBytes,
    sha256: value.sha256.toLowerCase(),
  };
}

function normalizeSourceSnapshot(value: Record<string, unknown>): DesktopPluginInstallSource {
  const expectedKeys = ['kind', 'repository', 'commitSha', 'archiveUrl', 'archiveBytes', 'sha256'];
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || keys.some(key => !expectedKeys.includes(key))) {
    throw new PluginProvenanceStoreError('invalid-source', 'The source snapshot provenance has unexpected fields.');
  }
  if (
    value.kind !== 'source-snapshot'
    || typeof value.repository !== 'string' || !repositoryPattern.test(value.repository)
    || typeof value.commitSha !== 'string' || !commitPattern.test(value.commitSha)
    || typeof value.archiveUrl !== 'string'
    || typeof value.archiveBytes !== 'number' || !Number.isSafeInteger(value.archiveBytes) || value.archiveBytes <= 0 || value.archiveBytes > 128 * 1024 * 1024
    || typeof value.sha256 !== 'string' || !hashPattern.test(value.sha256)
  ) {
    throw new PluginProvenanceStoreError('invalid-source', 'The source snapshot provenance contains invalid fields.');
  }
  let archiveUrl: URL;
  try {
    archiveUrl = new URL(value.archiveUrl);
  }
  catch (error) {
    throw new PluginProvenanceStoreError('invalid-source', 'The source snapshot archive URL is invalid.', { cause: error });
  }
  const [owner, name] = value.repository.split('/');
  const expectedPath = `/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}/tar.gz/${value.commitSha.toLowerCase()}`;
  if (
    archiveUrl.protocol !== 'https:'
    || !allowedSourceArchiveHosts.has(archiveUrl.hostname.toLowerCase())
    || archiveUrl.port
    || archiveUrl.username
    || archiveUrl.password
    || archiveUrl.search
    || archiveUrl.hash
    || archiveUrl.pathname.toLowerCase() !== expectedPath.toLowerCase()
  ) {
    throw new PluginProvenanceStoreError('invalid-source', 'The source snapshot archive URL is not approved.');
  }
  return {
    kind: 'source-snapshot',
    repository: value.repository,
    commitSha: value.commitSha.toLowerCase(),
    archiveUrl: archiveUrl.href,
    archiveBytes: value.archiveBytes,
    sha256: value.sha256.toLowerCase(),
  };
}

function cloneSource(source: DesktopPluginInstallSource): DesktopPluginInstallSource {
  return { ...source };
}

function isValidPluginIdentity(pluginId: string, version: string): boolean {
  return pluginIdPattern.test(pluginId) && pluginId.length <= 128 && pluginVersionPattern.test(version);
}

function getEntryKey(pluginId: string, version: string): string {
  return `${pluginId}\u0000${version}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
