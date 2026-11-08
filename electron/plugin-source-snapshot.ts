import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';

const githubApiOrigin = 'https://api.github.com';
const githubSourceHosts = new Set([
  'codeload.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const githubOwnerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const githubRepositoryPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const commitShaPattern = /^[a-f0-9]{40}$/i;
const maximumApiResponseBytes = 512 * 1024;
const maximumSourceArchiveBytes = 128 * 1024 * 1024;
const githubApiVersion = '2022-11-28';
const gzipMagic = [0x1f, 0x8b];

export const pluginSourceSnapshotLimits = Object.freeze({
  maximumApiResponseBytes,
  maximumSourceArchiveBytes,
});

export type PluginSourceSnapshotErrorCode =
  | 'source-invalid-repository'
  | 'source-unavailable'
  | 'source-commit-not-found'
  | 'source-download-failed'
  | 'source-cancelled';

export class PluginSourceSnapshotError extends Error {
  constructor(
    readonly code: PluginSourceSnapshotErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginSourceSnapshotError';
  }
}

export interface PluginSourceSnapshotInput {
  readonly owner: string;
  readonly name: string;
  /** A full immutable Git commit SHA, never a branch or tag. */
  readonly commitSha: string;
}

export interface PluginSourceSnapshotSource {
  readonly repository: string;
  readonly commitSha: string;
  readonly archiveUrl: string;
  readonly archiveBytes: number;
  readonly sha256: string;
}

export interface PluginSourceSnapshotDependencies<TValue> {
  readonly tempRoot: string;
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Consume the archive while it exists. This callback must not retain the path. */
  readonly processArchive: (archivePath: string, source: PluginSourceSnapshotSource) => Promise<TValue>;
  readonly signal?: AbortSignal;
}

export interface PluginSourceSnapshotResult<TValue> {
  readonly value: TValue;
  readonly source: PluginSourceSnapshotSource;
}

interface GithubRepositoryResponse {
  readonly full_name?: unknown;
  readonly html_url?: unknown;
  readonly archived?: unknown;
  readonly disabled?: unknown;
  readonly fork?: unknown;
  readonly topics?: unknown;
}

interface GithubCommitResponse {
  readonly sha?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string, maximumLength = 1024): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    throw new PluginSourceSnapshotError('source-unavailable', `GitHub returned an invalid ${label}.`);
  }
  return value;
}

function normalizeInput(input: PluginSourceSnapshotInput): PluginSourceSnapshotInput {
  if (
    !isRecord(input)
    || typeof input.owner !== 'string'
    || typeof input.name !== 'string'
    || typeof input.commitSha !== 'string'
    || !githubOwnerPattern.test(input.owner)
    || !githubRepositoryPattern.test(input.name)
    || !commitShaPattern.test(input.commitSha)
  ) {
    throw new PluginSourceSnapshotError(
      'source-invalid-repository',
      'The source snapshot must identify a GitHub repository and a full commit SHA.',
    );
  }
  return {
    owner: input.owner,
    name: input.name,
    commitSha: input.commitSha.toLowerCase(),
  };
}

function apiUrl(path: string): string {
  return `${githubApiOrigin}${path}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PluginSourceSnapshotError('source-cancelled', 'The source snapshot download was cancelled.');
  }
}

async function fetchJson<T>(
  fetcher: PluginSourceSnapshotDependencies<unknown>['fetch'],
  url: string,
  signal: AbortSignal | undefined,
  notFoundCode: PluginSourceSnapshotErrorCode,
): Promise<T> {
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await fetcher(url, {
      redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': githubApiVersion,
      },
      ...(signal ? { signal } : {}),
    });
  }
  catch (error) {
    if (signal?.aborted) {
      throw new PluginSourceSnapshotError('source-cancelled', 'The source snapshot download was cancelled.', { cause: error });
    }
    throw new PluginSourceSnapshotError('source-unavailable', 'The GitHub API could not be reached.', { cause: error });
  }
  if (!response.ok) {
    throw new PluginSourceSnapshotError(
      response.status === 404 ? notFoundCode : 'source-unavailable',
      `The GitHub API returned status ${response.status}.`,
    );
  }
  const contentLength = getContentLength(response.headers);
  if (contentLength !== undefined && contentLength > maximumApiResponseBytes) {
    throw new PluginSourceSnapshotError('source-unavailable', 'The GitHub API response is too large.');
  }
  const body = await readResponseText(response, signal);
  try {
    return JSON.parse(body) as T;
  }
  catch (error) {
    throw new PluginSourceSnapshotError('source-unavailable', 'The GitHub API returned invalid JSON.', { cause: error });
  }
}

function validateRepositoryMetadata(input: PluginSourceSnapshotInput, payload: GithubRepositoryResponse): string {
  const fullName = requiredString(payload.full_name, 'repository name', 201);
  if (fullName.toLowerCase() !== `${input.owner}/${input.name}`.toLowerCase()) {
    throw new PluginSourceSnapshotError('source-invalid-repository', 'The GitHub repository identity changed during snapshot resolution.');
  }
  if (payload.archived === true || payload.disabled === true || payload.fork === true) {
    throw new PluginSourceSnapshotError('source-invalid-repository', 'Archived, disabled, or forked repositories cannot be snapshotted.');
  }
  if (!Array.isArray(payload.topics) || !payload.topics.some(topic => typeof topic === 'string' && topic.toLowerCase() === 'it-tools-plugin')) {
    throw new PluginSourceSnapshotError('source-invalid-repository', 'The repository is not registered with the it-tools-plugin topic.');
  }
  const repositoryUrl = requiredString(payload.html_url, 'repository URL', 2048);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(repositoryUrl);
  }
  catch (error) {
    throw new PluginSourceSnapshotError('source-invalid-repository', 'The GitHub repository URL is invalid.', { cause: error });
  }
  if (
    parsedUrl.protocol !== 'https:'
    || parsedUrl.hostname.toLowerCase() !== 'github.com'
    || parsedUrl.port
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.search
    || parsedUrl.hash
    || parsedUrl.pathname.replace(/\/$/, '').toLowerCase() !== `/${input.owner}/${input.name}`.toLowerCase()
  ) {
    throw new PluginSourceSnapshotError('source-invalid-repository', 'The GitHub repository URL does not match the selected repository.');
  }
  return fullName;
}

async function resolveSnapshot(
  input: PluginSourceSnapshotInput,
  dependencies: PluginSourceSnapshotDependencies<unknown>,
): Promise<{ repository: string; commitSha: string; archiveUrl: string }> {
  const normalized = normalizeInput(input);
  const repository = await fetchJson<GithubRepositoryResponse>(
    dependencies.fetch,
    apiUrl(`/repos/${encodeURIComponent(normalized.owner)}/${encodeURIComponent(normalized.name)}`),
    dependencies.signal,
    'source-invalid-repository',
  );
  const fullName = validateRepositoryMetadata(normalized, repository);
  const commit = await fetchJson<GithubCommitResponse>(
    dependencies.fetch,
    apiUrl(`/repos/${encodeURIComponent(normalized.owner)}/${encodeURIComponent(normalized.name)}/commits/${encodeURIComponent(normalized.commitSha)}`),
    dependencies.signal,
    'source-commit-not-found',
  );
  const returnedSha = requiredString(commit.sha, 'commit SHA', 64);
  if (!commitShaPattern.test(returnedSha) || returnedSha.toLowerCase() !== normalized.commitSha) {
    throw new PluginSourceSnapshotError('source-commit-not-found', 'GitHub did not return the requested immutable commit.');
  }
  const archiveUrl = `https://codeload.github.com/${encodeURIComponent(normalized.owner)}/${encodeURIComponent(normalized.name)}/tar.gz/${normalized.commitSha}`;
  return { repository: fullName, commitSha: normalized.commitSha, archiveUrl };
}

async function downloadSnapshotArchive(
  resolved: Awaited<ReturnType<typeof resolveSnapshot>>,
  dependencies: PluginSourceSnapshotDependencies<unknown>,
  archivePath: string,
): Promise<{ archiveBytes: number; sha256: string }> {
  throwIfAborted(dependencies.signal);
  let response: Response;
  try {
    response = await dependencies.fetch(resolved.archiveUrl, {
      redirect: 'follow',
      headers: { Accept: 'application/gzip, application/octet-stream' },
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    });
  }
  catch (error) {
    if (dependencies.signal?.aborted) {
      throw new PluginSourceSnapshotError('source-cancelled', 'The source snapshot download was cancelled.', { cause: error });
    }
    throw new PluginSourceSnapshotError('source-download-failed', 'The source snapshot archive could not be downloaded.', { cause: error });
  }
  if (!response.ok) {
    throw new PluginSourceSnapshotError('source-download-failed', `The source snapshot archive returned status ${response.status}.`);
  }
  let finalUrl: URL;
  try {
    if (!response.url) {
      throw new Error('The source snapshot response did not expose its final URL.');
    }
    finalUrl = new URL(response.url);
  }
  catch (error) {
    throw new PluginSourceSnapshotError('source-download-failed', 'The source snapshot redirect was invalid.', { cause: error });
  }
  if (
    finalUrl.protocol !== 'https:'
    || !githubSourceHosts.has(finalUrl.hostname.toLowerCase())
    || finalUrl.port
    || finalUrl.username
    || finalUrl.password
    || finalUrl.search
    || finalUrl.hash
  ) {
    throw new PluginSourceSnapshotError('source-download-failed', 'The source snapshot redirected to an unapproved host.');
  }
  const contentLength = getContentLength(response.headers);
  if (contentLength !== undefined && (contentLength <= 0 || contentLength > maximumSourceArchiveBytes)) {
    throw new PluginSourceSnapshotError('source-download-failed', 'The source snapshot archive exceeds the size limit.');
  }
  const downloaded = await streamResponseToFile(response, archivePath, dependencies.signal);
  if (
    downloaded.bytes < 2
    || downloaded.bytes > maximumSourceArchiveBytes
    || downloaded.firstBytes[0] !== gzipMagic[0]
    || downloaded.firstBytes[1] !== gzipMagic[1]
  ) {
    throw new PluginSourceSnapshotError('source-download-failed', 'The source snapshot is not a valid gzip archive within the size limit.');
  }
  if (contentLength !== undefined && contentLength !== downloaded.bytes) {
    throw new PluginSourceSnapshotError('source-download-failed', 'The source snapshot size does not match the response metadata.');
  }
  return { archiveBytes: downloaded.bytes, sha256: downloaded.sha256 };
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
    throw new PluginSourceSnapshotError('source-unavailable', 'The GitHub API response has no readable body.');
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
          throw new PluginSourceSnapshotError('source-cancelled', 'The source snapshot download was cancelled.', { cause: error });
        }
        throw new PluginSourceSnapshotError('source-unavailable', 'The GitHub API response could not be read.', { cause: error });
      }
      if (next.done) {
        break;
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > maximumApiResponseBytes) {
        throw new PluginSourceSnapshotError('source-unavailable', 'The GitHub API response is too large.');
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
      // Preserve the original response error.
    }
    throw error;
  }
  finally {
    reader.releaseLock();
  }
  return parts.join('');
}

async function streamResponseToFile(
  response: Response,
  archivePath: string,
  signal?: AbortSignal,
): Promise<{ bytes: number; sha256: string; firstBytes: Uint8Array }> {
  if (!response.body) {
    throw new PluginSourceSnapshotError('source-download-failed', 'The source snapshot response has no readable body.');
  }
  const reader = response.body.getReader();
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
    throw new PluginSourceSnapshotError('source-download-failed', 'The source snapshot archive could not be staged.', { cause: error });
  }
  const hash = createHash('sha256');
  const firstBytes = new Uint8Array(2);
  let firstByteCount = 0;
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
          throw new PluginSourceSnapshotError('source-cancelled', 'The source snapshot download was cancelled.', { cause: error });
        }
        throw new PluginSourceSnapshotError('source-download-failed', 'The source snapshot archive could not be read.', { cause: error });
      }
      if (next.done) {
        break;
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > maximumSourceArchiveBytes) {
        throw new PluginSourceSnapshotError('source-download-failed', 'The source snapshot archive exceeds the size limit.');
      }
      hash.update(next.value);
      if (firstByteCount < firstBytes.length) {
        const copyLength = Math.min(firstBytes.length - firstByteCount, next.value.byteLength);
        firstBytes.set(next.value.subarray(0, copyLength), firstByteCount);
        firstByteCount += copyLength;
      }
      let offset = 0;
      while (offset < next.value.byteLength) {
        const written = await file.write(next.value, offset, next.value.byteLength - offset);
        if (written.bytesWritten <= 0) {
          throw new PluginSourceSnapshotError('source-download-failed', 'The source snapshot archive could not be written.');
        }
        offset += written.bytesWritten;
      }
    }
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
  return { bytes: totalBytes, sha256: hash.digest('hex'), firstBytes };
}

/**
 * Resolve and download a fixed GitHub source snapshot, then delete the archive.
 * This function never extracts or executes repository contents; callers consume the archive only inside `processArchive`.
 */
export async function downloadPluginSourceSnapshot<TValue>(
  input: PluginSourceSnapshotInput,
  dependencies: PluginSourceSnapshotDependencies<TValue>,
): Promise<PluginSourceSnapshotResult<TValue>> {
  const resolved = await resolveSnapshot(input, dependencies);
  await mkdir(dependencies.tempRoot, { recursive: true, mode: 0o700 });
  const temporaryDirectory = await mkdtemp(join(dependencies.tempRoot, '.it-tools-plugin-source-'));
  const archivePath = join(temporaryDirectory, 'source.tar.gz');
  try {
    const downloaded = await downloadSnapshotArchive(resolved, dependencies, archivePath);
    const source: PluginSourceSnapshotSource = {
      repository: resolved.repository,
      commitSha: resolved.commitSha,
      archiveUrl: resolved.archiveUrl,
      archiveBytes: downloaded.archiveBytes,
      sha256: downloaded.sha256,
    };
    const value = await dependencies.processArchive(archivePath, source);
    return { value, source };
  }
  finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
