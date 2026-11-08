import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DesktopPluginErrorCode,
  DesktopPluginMarketplaceInstallProgress,
  DesktopPluginMarketplaceInstallSource,
} from '../src/shared/desktop-services/plugins';
import { pluginPackageLimits } from './plugin-package';

const githubApiOrigin = 'https://api.github.com';
const githubDownloadHosts = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const githubOwnerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const githubRepositoryPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const shaPattern = /^[a-f0-9]{40}$/i;
const maximumApiResponseBytes = 512 * 1024;
const githubApiVersion = '2022-11-28';

export type PluginMarketplaceInstallErrorCode = Extract<DesktopPluginErrorCode, `marketplace-${string}`>;

export type PluginMarketplaceInstallProgress = Omit<DesktopPluginMarketplaceInstallProgress, 'requestId'>;

export class PluginMarketplaceInstallError extends Error {
  constructor(
    readonly code: PluginMarketplaceInstallErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginMarketplaceInstallError';
  }
}
export interface PluginMarketplaceRepositoryInput {
  readonly owner: string;
  readonly name: string;
}

export type PluginMarketplaceReleaseSource = DesktopPluginMarketplaceInstallSource;

export interface PluginMarketplaceInstallResult<TSnapshot> {
  readonly snapshot: TSnapshot;
  readonly source: PluginMarketplaceReleaseSource;
}

export interface PluginMarketplaceInstallDependencies<TSnapshot> {
  readonly tempRoot: string;
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly installArchive: (archivePath: string, source?: PluginMarketplaceReleaseSource) => Promise<TSnapshot>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PluginMarketplaceInstallProgress) => void;
}

interface GithubRepositoryResponse {
  readonly full_name?: unknown;
  readonly html_url?: unknown;
  readonly archived?: unknown;
  readonly disabled?: unknown;
  readonly fork?: unknown;
  readonly topics?: unknown;
}

interface GithubReleaseResponse {
  readonly tag_name?: unknown;
  readonly html_url?: unknown;
  readonly draft?: unknown;
  readonly prerelease?: unknown;
  readonly published_at?: unknown;
  readonly assets?: unknown;
}

interface GithubCommitResponse {
  readonly sha?: unknown;
}

interface GithubReleaseAsset {
  readonly name?: unknown;
  readonly browser_download_url?: unknown;
  readonly size?: unknown;
  readonly digest?: unknown;
}

interface ReleaseAsset {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly digest?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string, maximumLength = 1024): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    throw new PluginMarketplaceInstallError('marketplace-unavailable', `GitHub returned an invalid ${label}.`);
  }
  return value;
}

function asHttpsUrl(value: unknown, label: string): string {
  const candidate = requiredString(value, label);
  let url: URL;
  try {
    url = new URL(candidate);
  }
  catch (error) {
    throw new PluginMarketplaceInstallError('marketplace-unavailable', `GitHub returned an invalid ${label}.`, { cause: error });
  }
  if (url.protocol !== 'https:' || url.port) {
    throw new PluginMarketplaceInstallError('marketplace-unavailable', `GitHub returned a non-HTTPS ${label}.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new PluginMarketplaceInstallError('marketplace-unavailable', `GitHub returned an invalid ${label}.`);
  }
  return url.href;
}

function normalizeRepositoryInput(input: PluginMarketplaceRepositoryInput): PluginMarketplaceRepositoryInput {
  if (
    !isRecord(input)
    || typeof input.owner !== 'string'
    || typeof input.name !== 'string'
    || !githubOwnerPattern.test(input.owner)
    || !githubRepositoryPattern.test(input.name)
  ) {
    throw new PluginMarketplaceInstallError(
      'marketplace-invalid-repository',
      'The selected GitHub repository is not a valid public repository identifier.',
    );
  }
  return { owner: input.owner, name: input.name };
}

function githubApiUrl(path: string): string {
  return `${githubApiOrigin}${path}`;
}

async function fetchJson<T>(
  fetcher: PluginMarketplaceInstallDependencies<unknown>['fetch'],
  url: string,
  notFoundCode: PluginMarketplaceInstallErrorCode = 'marketplace-unavailable',
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await fetcher(url, {
      redirect: 'error',
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': githubApiVersion,
      },
    });
  }
  catch (error) {
    if (signal?.aborted) {
      throw marketplaceCancelled();
    }
    throw new PluginMarketplaceInstallError('marketplace-unavailable', 'The GitHub API could not be reached.', { cause: error });
  }
  if (!response.ok) {
    throw new PluginMarketplaceInstallError(
      response.status === 404 ? notFoundCode : 'marketplace-unavailable',
      `The GitHub API returned status ${response.status}.`,
    );
  }
  const contentLength = getContentLength(response.headers);
  if (contentLength !== undefined && contentLength > maximumApiResponseBytes) {
    throw new PluginMarketplaceInstallError('marketplace-unavailable', 'The GitHub API response is too large.');
  }
  const body = await readResponseText(response, signal);
  try {
    return JSON.parse(body) as T;
  }
  catch (error) {
    throw new PluginMarketplaceInstallError('marketplace-unavailable', 'The GitHub API returned invalid JSON.', { cause: error });
  }
}

function validateRepositoryMetadata(
  input: PluginMarketplaceRepositoryInput,
  payload: GithubRepositoryResponse,
): string {
  const fullName = requiredString(payload.full_name, 'repository name', 201);
  if (fullName.toLowerCase() !== `${input.owner}/${input.name}`.toLowerCase()) {
    throw new PluginMarketplaceInstallError('marketplace-invalid-repository', 'The GitHub repository identity changed during installation.');
  }
  if (payload.archived === true || payload.disabled === true || payload.fork === true) {
    throw new PluginMarketplaceInstallError('marketplace-invalid-repository', 'Archived, disabled, or forked repositories cannot be installed.');
  }
  if (!Array.isArray(payload.topics) || !payload.topics.some(topic => typeof topic === 'string' && topic.toLowerCase() === 'it-tools-plugin')) {
    throw new PluginMarketplaceInstallError('marketplace-invalid-repository', 'The repository is not registered with the it-tools-plugin topic.');
  }
  const repositoryUrl = asHttpsUrl(payload.html_url, 'repository URL');
  const expectedPath = `/${input.owner}/${input.name}`.toLowerCase();
  let parsedRepositoryUrl: URL;
  try {
    parsedRepositoryUrl = new URL(repositoryUrl);
  }
  catch (error) {
    throw new PluginMarketplaceInstallError('marketplace-invalid-repository', 'The GitHub repository URL is invalid.', { cause: error });
  }
  if (
    parsedRepositoryUrl.hostname.toLowerCase() !== 'github.com'
    || parsedRepositoryUrl.pathname.replace(/\/$/, '').toLowerCase() !== expectedPath
  ) {
    throw new PluginMarketplaceInstallError('marketplace-invalid-repository', 'The GitHub repository URL does not match the selected repository.');
  }
  return fullName;
}

function parseReleaseAsset(value: unknown, owner: string, name: string, tagName: string): ReleaseAsset | null {
  if (!isRecord(value)) {
    return null;
  }
  const asset = value as GithubReleaseAsset;
  const assetName = typeof asset.name === 'string' ? asset.name : '';
  const urlValue = typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '';
  const size = typeof asset.size === 'number' && Number.isSafeInteger(asset.size) ? asset.size : -1;
  if (
    !assetName
    || assetName.length > 255
    || assetName.includes('/')
    || assetName.includes('\\')
    || !assetName.toLowerCase().endsWith('.itplugin')
    || !urlValue
    || size <= 0
    || size > pluginPackageLimits.maximumArchiveBytes
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(urlValue);
  }
  catch {
    return null;
  }
  const expectedPathPrefix = `/${owner}/${name}/releases/download/${encodeURIComponent(tagName)}/`.toLowerCase();
  const expectedPath = `${expectedPathPrefix}${encodeURIComponent(assetName)}`.toLowerCase();
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'github.com'
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname.toLowerCase() !== expectedPath
  ) {
    return null;
  }
  if (typeof asset.digest === 'string' && !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) {
    return null;
  }
  const digest = typeof asset.digest === 'string'
    ? asset.digest.slice('sha256:'.length).toLowerCase()
    : undefined;
  return { name: assetName, url: url.href, size, ...(digest ? { digest } : {}) };
}

function selectReleaseAsset(payload: GithubReleaseResponse, owner: string, name: string): ReleaseAsset {
  if (!Array.isArray(payload.assets)) {
    throw new PluginMarketplaceInstallError('marketplace-release-not-found', 'The latest GitHub release has no plugin package assets.');
  }
  const packageAssets = payload.assets.filter((asset) => {
    if (!isRecord(asset) || typeof asset.name !== 'string') {
      return false;
    }
    return asset.name.toLowerCase().endsWith('.itplugin');
  });
  if (packageAssets.length !== 1) {
    throw new PluginMarketplaceInstallError(
      'marketplace-release-not-found',
      packageAssets.length === 0
        ? 'The latest GitHub release does not contain a .itplugin asset.'
        : 'The latest GitHub release contains multiple .itplugin assets; the publisher must expose exactly one.',
    );
  }
  const asset = parseReleaseAsset(packageAssets[0], owner, name, String(payload.tag_name));
  if (!asset) {
    throw new PluginMarketplaceInstallError('marketplace-release-not-found', 'The latest GitHub release does not contain a valid bounded .itplugin asset.');
  }
  return asset;
}

async function resolveRelease<TSnapshot>(
  input: PluginMarketplaceRepositoryInput,
  dependencies: PluginMarketplaceInstallDependencies<TSnapshot>,
): Promise<{ repository: string; tagName: string; commitSha: string; asset: ReleaseAsset }> {
  throwIfAborted(dependencies.signal);
  const repository = normalizeRepositoryInput(input);
  const repositoryPayload = await fetchJson<GithubRepositoryResponse>(
    dependencies.fetch,
    githubApiUrl(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`),
    'marketplace-invalid-repository',
    dependencies.signal,
  );
  const fullName = validateRepositoryMetadata(repository, repositoryPayload);
  const releasePayload = await fetchJson<GithubReleaseResponse>(
    dependencies.fetch,
    githubApiUrl(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/releases/latest`),
    'marketplace-release-not-found',
    dependencies.signal,
  );
  const tagName = requiredString(releasePayload.tag_name, 'release tag', 256);
  if (releasePayload.draft === true || releasePayload.prerelease === true) {
    throw new PluginMarketplaceInstallError('marketplace-release-not-found', 'Draft and prerelease assets are not eligible for marketplace installation.');
  }
  const asset = selectReleaseAsset(releasePayload, repository.owner, repository.name);
  const commitPayload = await fetchJson<GithubCommitResponse>(
    dependencies.fetch,
    githubApiUrl(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(tagName)}`),
    'marketplace-release-not-found',
    dependencies.signal,
  );
  const commitSha = requiredString(commitPayload.sha, 'commit SHA');
  if (!shaPattern.test(commitSha)) {
    throw new PluginMarketplaceInstallError('marketplace-unavailable', 'GitHub returned an invalid release commit SHA.');
  }
  return { repository: fullName, tagName, commitSha: commitSha.toLowerCase(), asset };
}

async function downloadReleaseAsset<TSnapshot>(
  release: Awaited<ReturnType<typeof resolveRelease<TSnapshot>>>,
  dependencies: PluginMarketplaceInstallDependencies<TSnapshot>,
  archivePath: string,
): Promise<{ archiveBytes: number; sha256: string }> {
  throwIfAborted(dependencies.signal);
  let response: Response;
  try {
    response = await dependencies.fetch(release.asset.url, {
      redirect: 'follow',
      signal: dependencies.signal,
      headers: { Accept: 'application/octet-stream' },
    });
  }
  catch (error) {
    if (dependencies.signal?.aborted) {
      throw marketplaceCancelled();
    }
    throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The plugin release asset could not be downloaded.', { cause: error });
  }
  if (!response.ok) {
    throw new PluginMarketplaceInstallError('marketplace-download-failed', `The plugin release asset returned status ${response.status}.`);
  }
  let finalUrl: URL;
  try {
    if (!response.url) {
      throw new Error('The release response did not expose its final URL.');
    }
    finalUrl = new URL(response.url);
  }
  catch (error) {
    throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The plugin release redirect was invalid.', { cause: error });
  }
  if (
    finalUrl.protocol !== 'https:'
    || !githubDownloadHosts.has(finalUrl.hostname.toLowerCase())
    || finalUrl.port
    || finalUrl.username
    || finalUrl.password
    || finalUrl.search
    || finalUrl.hash
  ) {
    throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The plugin release redirected to an unapproved host.');
  }
  const contentLength = getContentLength(response.headers);
  if (contentLength !== undefined && (contentLength <= 0 || contentLength > pluginPackageLimits.maximumArchiveBytes)) {
    throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The plugin release asset exceeds the archive size limit.');
  }
  if (contentLength !== undefined && contentLength !== release.asset.size) {
    throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The downloaded plugin release size does not match the published asset.');
  }
  const totalBytes = release.asset.size;
  dependencies.onProgress?.({
    phase: 'downloading',
    repository: release.repository,
    tagName: release.tagName,
    commitSha: release.commitSha,
    assetName: release.asset.name,
    transferredBytes: 0,
    totalBytes,
  });
  const reader = response.body?.getReader();
  if (!reader) {
    throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The plugin release response has no readable body.');
  }
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(archivePath, 'wx', 0o600);
  }
  catch (error) {
    try {
      await reader.cancel();
    }
    catch {
      // Preserve the local file error.
    }
    reader.releaseLock();
    throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The plugin release asset could not be staged.', { cause: error });
  }
  const hash = createHash('sha256');
  let archiveBytes = 0;
  let previousProgressAt = 0;
  try {
    while (true) {
      throwIfAborted(dependencies.signal);
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      }
      catch (error) {
        if (dependencies.signal?.aborted) {
          throw marketplaceCancelled();
        }
        throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The plugin release asset could not be read.', { cause: error });
      }
      if (next.done) {
        break;
      }
      archiveBytes += next.value.byteLength;
      if (archiveBytes > pluginPackageLimits.maximumArchiveBytes) {
        throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The plugin release asset exceeds the archive size limit.');
      }
      hash.update(next.value);
      await writeFileChunk(file, next.value);
      const now = Date.now();
      if (now - previousProgressAt >= 100) {
        previousProgressAt = now;
        dependencies.onProgress?.({
          phase: 'downloading',
          repository: release.repository,
          tagName: release.tagName,
          commitSha: release.commitSha,
          assetName: release.asset.name,
          transferredBytes: archiveBytes,
          totalBytes,
        });
      }
    }
    throwIfAborted(dependencies.signal);
  }
  catch (error) {
    try {
      await reader.cancel();
    }
    catch {
      // Preserve the original download error.
    }
    throw error;
  }
  finally {
    reader.releaseLock();
    await file.close();
  }
  if (archiveBytes === 0 || archiveBytes !== release.asset.size) {
    throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The downloaded plugin release size does not match the published asset.');
  }
  const sha256 = hash.digest('hex');
  if (release.asset.digest && release.asset.digest !== sha256) {
    throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The downloaded plugin release hash does not match GitHub metadata.');
  }
  dependencies.onProgress?.({
    phase: 'verifying',
    repository: release.repository,
    tagName: release.tagName,
    commitSha: release.commitSha,
    assetName: release.asset.name,
    transferredBytes: archiveBytes,
    totalBytes,
  });
  return { archiveBytes, sha256 };
}

async function writeFileChunk(file: Awaited<ReturnType<typeof open>>, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await file.write(chunk, offset, chunk.byteLength - offset);
    if (result.bytesWritten <= 0) {
      throw new PluginMarketplaceInstallError('marketplace-download-failed', 'The plugin release asset could not be written.');
    }
    offset += result.bytesWritten;
  }
}

function getContentLength(headers: Headers): number | undefined {
  const value = headers.get('content-length');
  if (value === null || value.trim() === '') {
    return undefined;
  }
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined;
}

async function readResponseText(response: Response, signal?: AbortSignal): Promise<string> {
  if (!response.body) {
    throw new PluginMarketplaceInstallError('marketplace-unavailable', 'The GitHub API response has no readable body.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      }
      catch (error) {
        if (signal?.aborted) {
          throw marketplaceCancelled();
        }
        throw new PluginMarketplaceInstallError('marketplace-unavailable', 'The GitHub API response could not be read.', { cause: error });
      }
      if (next.done) {
        break;
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > maximumApiResponseBytes) {
        throw new PluginMarketplaceInstallError('marketplace-unavailable', 'The GitHub API response is too large.');
      }
      parts.push(decoder.decode(next.value, { stream: true }));
    }
    parts.push(decoder.decode());
  }
  catch (error) {
    try {
      await reader.cancel();
    }
    catch {
      // The original response error is the useful diagnostic.
    }
    throw error;
  }
  finally {
    reader.releaseLock();
  }
  return parts.join('');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw marketplaceCancelled();
  }
}

function marketplaceCancelled(): PluginMarketplaceInstallError {
  return new PluginMarketplaceInstallError('marketplace-cancelled', 'The plugin marketplace installation was cancelled.');
}

/** Download exactly one bounded GitHub release package into a temp directory, then pass it to the normal installer. */
export async function installPluginMarketplaceRelease<TSnapshot>(
  input: PluginMarketplaceRepositoryInput,
  dependencies: PluginMarketplaceInstallDependencies<TSnapshot>,
): Promise<PluginMarketplaceInstallResult<TSnapshot>> {
  dependencies.onProgress?.({ phase: 'discovering' });
  const release = await resolveRelease(input, dependencies);
  throwIfAborted(dependencies.signal);
  dependencies.onProgress?.({
    phase: 'pinned',
    repository: release.repository,
    tagName: release.tagName,
    commitSha: release.commitSha,
    assetName: release.asset.name,
    totalBytes: release.asset.size,
  });
  await mkdir(dependencies.tempRoot, { recursive: true, mode: 0o700 });
  const temporaryDirectory = await mkdtemp(join(dependencies.tempRoot, '.it-tools-plugin-marketplace-'));
  const archivePath = join(temporaryDirectory, 'release.itplugin');
  try {
    const downloaded = await downloadReleaseAsset(release, dependencies, archivePath);
    throwIfAborted(dependencies.signal);
    dependencies.onProgress?.({
      phase: 'installing',
      repository: release.repository,
      tagName: release.tagName,
      commitSha: release.commitSha,
      assetName: release.asset.name,
      transferredBytes: downloaded.archiveBytes,
      totalBytes: release.asset.size,
    });
    const source: PluginMarketplaceReleaseSource = {
      repository: release.repository,
      tagName: release.tagName,
      commitSha: release.commitSha,
      assetName: release.asset.name,
      assetUrl: release.asset.url,
      archiveBytes: downloaded.archiveBytes,
      sha256: downloaded.sha256,
    };
    const snapshot = await dependencies.installArchive(archivePath, source);
    dependencies.onProgress?.({
      phase: 'completed',
      repository: release.repository,
      tagName: release.tagName,
      commitSha: release.commitSha,
      assetName: release.asset.name,
      transferredBytes: downloaded.archiveBytes,
      totalBytes: release.asset.size,
    });
    return {
      snapshot,
      source,
    };
  }
  finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
