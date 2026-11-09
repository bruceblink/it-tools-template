import { constants as fsConstants, createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createGunzip } from 'node:zlib';

const tarBlockBytes = 512;
const stagingDirectoryPrefix = '.it-tools-plugin-source-';
const maximumPathLength = 1024;
const maximumPathSegments = 32;
const windowsDeviceNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

const defaultMaximumEntries = 1024;
const defaultMaximumFiles = 512;
const defaultMaximumFileBytes = 16 * 1024 * 1024;
const defaultMaximumExpandedBytes = 128 * 1024 * 1024;
const defaultMaximumCompressionRatio = 100;

/** Limits applied while reading a source tarball. */
export interface PluginSourceArchiveLimits {
  readonly maximumEntries?: number;
  readonly maximumFiles?: number;
  readonly maximumFileBytes?: number;
  readonly maximumExpandedBytes?: number;
  readonly maximumCompressionRatio?: number;
}

export const pluginSourceArchiveLimits = Object.freeze({
  maximumEntries: defaultMaximumEntries,
  maximumFiles: defaultMaximumFiles,
  maximumFileBytes: defaultMaximumFileBytes,
  maximumExpandedBytes: defaultMaximumExpandedBytes,
  maximumCompressionRatio: defaultMaximumCompressionRatio,
});

export type PluginSourceArchiveErrorCode =
  | 'archive-invalid'
  | 'archive-unsafe-entry'
  | 'archive-resource-limit'
  | 'archive-cancelled';

export class PluginSourceArchiveError extends Error {
  constructor(
    readonly code: PluginSourceArchiveErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginSourceArchiveError';
  }
}

export interface PluginSourceArchiveResult {
  /** The extracted directory containing the exact root plugin.source.json file. */
  readonly sourceDirectory: string;
  readonly entryCount: number;
  readonly fileCount: number;
  readonly expandedBytes: number;
  /** The GitHub wrapper directory that was removed logically, or an empty string. */
  readonly rootDirectory: string;
}

export interface ExtractPluginSourceArchiveOptions {
  readonly limits?: PluginSourceArchiveLimits;
  readonly signal?: AbortSignal;
}

interface NormalizedLimits {
  readonly maximumEntries: number;
  readonly maximumFiles: number;
  readonly maximumFileBytes: number;
  readonly maximumExpandedBytes: number;
  readonly maximumCompressionRatio: number;
}

interface TarEntryRecord {
  readonly path: string;
  readonly segments: readonly string[];
  readonly isDirectory: boolean;
  readonly size: number;
}

interface ParsedArchive {
  readonly entries: readonly TarEntryRecord[];
  readonly entryCount: number;
  readonly fileCount: number;
  readonly expandedBytes: number;
  readonly compressedBytes: number;
  readonly rootDirectory: string;
}

/**
 * Extract a GitHub tar.gz source snapshot into a fresh directory below
 * `destinationRoot`. Only regular files and directories are accepted. The
 * archive is never executed; extraction writes files with private modes and
 * removes its staging directory on every failed operation.
 */
export async function extractPluginSourceArchive(
  archivePath: string,
  destinationRoot: string,
  options: ExtractPluginSourceArchiveOptions = {},
): Promise<PluginSourceArchiveResult> {
  const limits = normalizeLimits(options.limits);
  throwIfAborted(options.signal);

  const resolvedArchivePath = resolve(archivePath);
  const resolvedDestinationRoot = resolve(destinationRoot);
  await assertRegularArchive(resolvedArchivePath);
  const canonicalDestinationRoot = await ensureDestinationRoot(resolvedDestinationRoot);

  let stagingRoot: string | undefined;
  let succeeded = false;
  try {
    stagingRoot = await mkdtemp(join(canonicalDestinationRoot, stagingDirectoryPrefix));
    const parsed = await parseGzipTarArchive(stagingRoot, resolvedArchivePath, limits, options.signal);
    const sourceDirectory = parsed.rootDirectory === ''
      ? stagingRoot
      : resolve(stagingRoot, ...parsed.rootDirectory.split('/'));
    if (!isContainedPath(stagingRoot, sourceDirectory)) {
      throw new PluginSourceArchiveError(
        'archive-unsafe-entry',
        'The extracted plugin source escaped its staging directory.',
      );
    }
    succeeded = true;
    return {
      sourceDirectory,
      entryCount: parsed.entryCount,
      fileCount: parsed.fileCount,
      expandedBytes: parsed.expandedBytes,
      rootDirectory: parsed.rootDirectory,
    };
  }
  catch (error) {
    if (options.signal?.aborted) {
      if (error instanceof PluginSourceArchiveError && error.code === 'archive-cancelled') {
        throw error;
      }
      throw new PluginSourceArchiveError(
        'archive-cancelled',
        'The plugin source archive extraction was cancelled.',
        { cause: error },
      );
    }
    if (error instanceof PluginSourceArchiveError) {
      throw error;
    }
    throw new PluginSourceArchiveError(
      'archive-invalid',
      'The plugin source archive could not be safely extracted.',
      { cause: error },
    );
  }
  finally {
    if (!succeeded && stagingRoot) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function normalizeLimits(input: PluginSourceArchiveLimits | undefined): NormalizedLimits {
  const options = input ?? {};
  return {
    maximumEntries: positiveIntegerLimit(options.maximumEntries, defaultMaximumEntries, 'maximumEntries'),
    maximumFiles: positiveIntegerLimit(options.maximumFiles, defaultMaximumFiles, 'maximumFiles'),
    maximumFileBytes: positiveIntegerLimit(options.maximumFileBytes, defaultMaximumFileBytes, 'maximumFileBytes'),
    maximumExpandedBytes: positiveIntegerLimit(options.maximumExpandedBytes, defaultMaximumExpandedBytes, 'maximumExpandedBytes'),
    maximumCompressionRatio: positiveNumberLimit(
      options.maximumCompressionRatio,
      defaultMaximumCompressionRatio,
      'maximumCompressionRatio',
    ),
  };
}

function positiveIntegerLimit(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PluginSourceArchiveError('archive-resource-limit', `The ${label} limit is invalid.`);
  }
  return value;
}

function positiveNumberLimit(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new PluginSourceArchiveError('archive-resource-limit', `The ${label} limit is invalid.`);
  }
  return value;
}

async function assertRegularArchive(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size <= 0) {
      throw new PluginSourceArchiveError(
        'archive-invalid',
        'The source archive must be a non-empty regular file without links.',
      );
    }
  }
  catch (error) {
    if (error instanceof PluginSourceArchiveError) {
      throw error;
    }
    throw new PluginSourceArchiveError('archive-invalid', 'The source archive cannot be read.', { cause: error });
  }
}

async function ensureDestinationRoot(path: string): Promise<string> {
  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new PluginSourceArchiveError(
        'archive-unsafe-entry',
        'The extraction destination must be a real directory.',
      );
    }
    return realpath(path);
  }
  catch (error) {
    if (error instanceof PluginSourceArchiveError) {
      throw error;
    }
    throw new PluginSourceArchiveError('archive-invalid', 'The extraction destination cannot be prepared.', { cause: error });
  }
}


async function parseGzipTarArchive(
  stagingRoot: string,
  archivePath: string,
  limits: NormalizedLimits,
  signal: AbortSignal | undefined,
): Promise<ParsedArchive> {
  throwIfAborted(signal);

  const compressed = createReadStream(archivePath);
  const gunzip = createGunzip();
  let compressedBytes = 0;
  compressed.on('data', (chunk: Buffer | string) => {
    compressedBytes += Buffer.byteLength(chunk);
  });
  // Pipe does not forward source errors to the destination. Forwarding here
  // makes a failed local read reject the async iterator deterministically.
  compressed.on('error', error => {
    gunzip.destroy(error);
  });
  // Async iteration also installs an error listener. Keep a no-op listener so
  // an abort during setup cannot become an unhandled EventEmitter error.
  compressed.on('error', () => undefined);
  gunzip.on('error', () => undefined);

  const abortError = new Error('The source archive extraction was cancelled.');
  const onAbort = () => {
    compressed.destroy(abortError);
    gunzip.destroy(abortError);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  compressed.pipe(gunzip);

  const metadataAllowance = Math.min(
    Number.MAX_SAFE_INTEGER - limits.maximumExpandedBytes,
    (limits.maximumEntries + 2) * tarBlockBytes * 2,
  );
  const maximumDecompressedBytes = limits.maximumExpandedBytes + metadataAllowance;
  let decompressedBytes = 0;
  // The reader is declared below the parser to keep the stream logic together.
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  const reader = new TarChunkReader(gunzip, bytes => {
    decompressedBytes += bytes;
    if (decompressedBytes > maximumDecompressedBytes) {
      throw new PluginSourceArchiveError(
        'archive-resource-limit',
        'The source archive expands beyond its bounded stream size.',
      );
    }
  });
  const entries: TarEntryRecord[] = [];
  const entriesByPath = new Map<string, TarEntryRecord>();
  const pathPrefixes = new Map<string, string>();
  let entryCount = 0;
  let fileCount = 0;
  let expandedBytes = 0;
  let sawEndOfArchive = false;

  try {
    while (true) {
      throwIfAborted(signal);
      const header = await reader.readBlock();
      if (header === null) {
        break;
      }
      if (isZeroBlock(header)) {
        sawEndOfArchive = true;
        break;
      }
      entryCount += 1;
      if (entryCount > limits.maximumEntries) {
        throw new PluginSourceArchiveError(
          'archive-resource-limit',
          'The source archive contains too many entries.',
        );
      }

      const parsedHeader = parseTarHeader(header);
      const normalized = normalizeTarPath(parsedHeader.path, parsedHeader.isDirectory);
      registerEntry(normalized.path, normalized.segments, parsedHeader.isDirectory, parsedHeader.size, entriesByPath, pathPrefixes);
      const record: TarEntryRecord = {
        path: normalized.path,
        segments: normalized.segments,
        isDirectory: parsedHeader.isDirectory,
        size: parsedHeader.size,
      };
      entries.push(record);

      if (parsedHeader.isDirectory) {
        if (parsedHeader.size !== 0) {
          throw new PluginSourceArchiveError(
            'archive-unsafe-entry',
            'The source archive contains a directory with file data.',
          );
        }
        await ensureDirectory(stagingRoot, normalized.segments);
        continue;
      }

      fileCount += 1;
      if (fileCount > limits.maximumFiles) {
        throw new PluginSourceArchiveError(
          'archive-resource-limit',
          'The source archive contains too many files.',
        );
      }
      if (parsedHeader.size > limits.maximumFileBytes) {
        throw new PluginSourceArchiveError(
          'archive-resource-limit',
          'A source archive file exceeds the per-file size limit.',
        );
      }
      if (parsedHeader.size > limits.maximumExpandedBytes - expandedBytes) {
        throw new PluginSourceArchiveError(
          'archive-resource-limit',
          'The source archive exceeds the expanded size limit.',
        );
      }
      expandedBytes += parsedHeader.size;

      await writeFileEntry(
        reader,
        stagingRoot,
        normalized.segments,
        parsedHeader.size,
        signal,
      );
      const padding = (tarBlockBytes - (parsedHeader.size % tarBlockBytes)) % tarBlockBytes;
      await reader.discard(padding);
    }

    if (!sawEndOfArchive) {
      throw new PluginSourceArchiveError('archive-invalid', 'The source archive is missing its end marker.');
    }
    // A conforming tar has two zero blocks. Accept one zero block for readers
    // that produce a short archive, but reject any non-zero trailing data.
    while (true) {
      const trailing = await reader.readBlock();
      if (trailing === null) {
        break;
      }
      if (!isZeroBlock(trailing)) {
        throw new PluginSourceArchiveError('archive-invalid', 'The source archive has trailing data after its end marker.');
      }
    }
    if (compressedBytes <= 0) {
      throw new PluginSourceArchiveError('archive-invalid', 'The source archive has no compressed data.');
    }
    if (expandedBytes > compressedBytes * limits.maximumCompressionRatio) {
      throw new PluginSourceArchiveError(
        'archive-resource-limit',
        'The source archive exceeds the compression ratio limit.',
      );
    }

    const rootDirectory = findSingleRootDirectory(entries);
    const manifestPath = rootDirectory === '' ? 'plugin.source.json' : `${rootDirectory}/plugin.source.json`;
    const manifest = entries.find(entry => entry.path === manifestPath);
    if (!manifest || manifest.isDirectory) {
      throw new PluginSourceArchiveError(
        'archive-invalid',
        'The source archive must contain plugin.source.json at its root.',
      );
    }

    return {
      entries,
      entryCount,
      fileCount,
      expandedBytes,
      compressedBytes,
      rootDirectory,
    };
  }
  catch (error) {
    if (signal?.aborted) {
      if (error instanceof PluginSourceArchiveError && error.code === 'archive-cancelled') {
        throw error;
      }
      throw new PluginSourceArchiveError(
        'archive-cancelled',
        'The plugin source archive extraction was cancelled.',
        { cause: error },
      );
    }
    if (error instanceof PluginSourceArchiveError) {
      throw error;
    }
    throw new PluginSourceArchiveError('archive-invalid', 'The source archive is malformed or unreadable.', { cause: error });
  }
  finally {
    signal?.removeEventListener('abort', onAbort);
    await reader.close();
    compressed.destroy();
    gunzip.destroy();
  }
}

interface ParsedTarHeader {
  readonly path: string;
  readonly size: number;
  readonly isDirectory: boolean;
}

function parseTarHeader(header: Buffer): ParsedTarHeader {
  validateTarChecksum(header);
  const name = decodeTarField(header.subarray(0, 100), 'path');
  const prefix = decodeTarField(header.subarray(345, 500), 'path prefix');
  const path = prefix === '' ? name : `${prefix}/${name}`;
  const typeByte = header[156];
  const type = typeByte === 0 ? '\0' : String.fromCharCode(typeByte);
  const isDirectory = type === '5';
  if (type !== '\0' && type !== '0' && !isDirectory) {
    throw new PluginSourceArchiveError(
      'archive-unsafe-entry',
      'The source archive contains a link, device, or unsupported special entry.',
    );
  }
  const mode = parseTarNumber(header.subarray(100, 108), 'mode');
  const modeType = mode & 0o170000;
  const allowedModeTypes = isDirectory ? [0, 0o040000] : [0, 0o100000];
  if (!allowedModeTypes.includes(modeType)) {
    throw new PluginSourceArchiveError(
      'archive-unsafe-entry',
      'The source archive contains a file with an unsafe type mode.',
    );
  }
  const linkName = decodeTarField(header.subarray(157, 257), 'link name');
  if (linkName !== '') {
    throw new PluginSourceArchiveError(
      'archive-unsafe-entry',
      'The source archive contains a linked entry.',
    );
  }
  return {
    path,
    size: parseTarNumber(header.subarray(124, 136), 'size'),
    isDirectory,
  };
}

function validateTarChecksum(header: Buffer): void {
  const expected = parseTarNumber(header.subarray(148, 156), 'checksum');
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]!;
  }
  if (actual !== expected) {
    throw new PluginSourceArchiveError('archive-invalid', 'The source archive contains an invalid tar header checksum.');
  }
}

function parseTarNumber(field: Uint8Array, label: string): number {
  let start = 0;
  let end = field.length;
  while (start < end && (field[start] === 0 || field[start] === 0x20)) {
    start += 1;
  }
  while (end > start && (field[end - 1] === 0 || field[end - 1] === 0x20)) {
    end -= 1;
  }
  if (start === end) {
    return 0;
  }
  if ((field[start]! & 0x80) !== 0) {
    throw new PluginSourceArchiveError('archive-invalid', `The source archive has an unsupported ${label} field.`);
  }
  let value = 0;
  for (let index = start; index < end; index += 1) {
    const byte = field[index]!;
    if (byte < 0x30 || byte > 0x37) {
      throw new PluginSourceArchiveError('archive-invalid', `The source archive has an invalid ${label} field.`);
    }
    value = value * 8 + byte - 0x30;
    if (!Number.isSafeInteger(value)) {
      throw new PluginSourceArchiveError('archive-resource-limit', `The source archive ${label} is too large.`);
    }
  }
  return value;
}

function decodeTarField(field: Uint8Array, label: string): string {
  let end = field.indexOf(0);
  if (end < 0) {
    end = field.length;
  }
  else if (field.subarray(end + 1).some(byte => byte !== 0 && byte !== 0x20)) {
    throw new PluginSourceArchiveError('archive-invalid', `The source archive has non-padding bytes after its ${label} field.`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(field.subarray(0, end));
  }
  catch (error) {
    throw new PluginSourceArchiveError('archive-invalid', `The source archive has an invalid UTF-8 ${label}.`, { cause: error });
  }
}

function normalizeTarPath(path: string, isDirectory: boolean): { path: string; segments: readonly string[] } {
  let candidate = path;
  if (isDirectory && candidate.endsWith('/')) {
    candidate = candidate.slice(0, -1);
  }
  if (
    candidate.length === 0
    || candidate.length > maximumPathLength
    || candidate.includes('\0')
    || candidate.includes('\\')
    || candidate.includes(':')
    || candidate.includes('%')
    || candidate.includes('?')
    || candidate.includes('#')
    || candidate.startsWith('/')
    || isAbsolute(candidate)
    || candidate.normalize('NFC') !== candidate
  ) {
    throw new PluginSourceArchiveError('archive-unsafe-entry', 'The source archive contains an unsafe path.');
  }
  const segments = candidate.split('/');
  if (
    segments.length > maximumPathSegments
    || segments.some(segment => (
      segment.length === 0
      || segment === '.'
      || segment === '..'
      || segment.length > 255
      || segment.endsWith('.')
      || segment.endsWith(' ')
      || windowsDeviceNamePattern.test(segment)
      || [...segment].some(character => character.charCodeAt(0) < 0x20)
    ))
  ) {
    throw new PluginSourceArchiveError('archive-unsafe-entry', 'The source archive contains an unsafe path.');
  }
  if (!isDirectory && path.endsWith('/')) {
    throw new PluginSourceArchiveError('archive-unsafe-entry', 'A regular archive entry cannot have a directory path.');
  }
  return { path: candidate, segments };
}

function registerEntry(
  path: string,
  segments: readonly string[],
  isDirectory: boolean,
  size: number,
  entriesByPath: Map<string, TarEntryRecord>,
  pathPrefixes: Map<string, string>,
): void {
  const key = path.toLowerCase();
  const existing = entriesByPath.get(key);
  if (existing) {
    throw new PluginSourceArchiveError('archive-unsafe-entry', 'The source archive contains duplicate or case-colliding paths.');
  }
  let prefix = '';
  for (const segment of segments) {
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    const prefixKey = prefix.toLowerCase();
    const existingPrefix = pathPrefixes.get(prefixKey);
    if (existingPrefix !== undefined && existingPrefix !== prefix) {
      throw new PluginSourceArchiveError('archive-unsafe-entry', 'The source archive contains case-colliding path components.');
    }
    pathPrefixes.set(prefixKey, prefix);
  }
  const parentSegments = segments.slice(0, -1);
  for (let index = 1; index <= parentSegments.length; index += 1) {
    const parentKey = parentSegments.slice(0, index).join('/').toLowerCase();
    if (entriesByPath.get(parentKey)?.isDirectory === false) {
      throw new PluginSourceArchiveError('archive-unsafe-entry', 'A source archive file contains another entry beneath it.');
    }
  }
  if (!isDirectory && [...entriesByPath.keys()].some(existingPath => existingPath.startsWith(`${key}/`))) {
    throw new PluginSourceArchiveError('archive-unsafe-entry', 'A source archive file conflicts with a directory path.');
  }
  entriesByPath.set(key, { path, segments, isDirectory, size });
}

function findSingleRootDirectory(entries: readonly TarEntryRecord[]): string {
  if (entries.length === 0) {
    throw new PluginSourceArchiveError('archive-invalid', 'The source archive is empty.');
  }
  const roots = new Map<string, string>();
  for (const entry of entries) {
    const root = entry.segments[0]!;
    const key = root.toLowerCase();
    const existing = roots.get(key);
    if (existing !== undefined && existing !== root) {
      throw new PluginSourceArchiveError('archive-unsafe-entry', 'The source archive has case-colliding top-level directories.');
    }
    roots.set(key, root);
  }
  if (roots.size !== 1) {
    return '';
  }
  const root = roots.values().next().value as string;
  const rootEntry = entries.find(entry => entry.segments.length === 1);
  const allNested = entries.every(entry => entry.segments.length > 1 || (
    entry.segments.length === 1 && entry.isDirectory
  ));
  if ((rootEntry === undefined || rootEntry.isDirectory) && allNested) {
    return root;
  }
  return '';
}

async function ensureDirectory(root: string, segments: readonly string[]): Promise<void> {
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    if (!isContainedPath(root, current)) {
      throw new PluginSourceArchiveError('archive-unsafe-entry', 'The source archive path escaped its staging directory.');
    }
    try {
      await mkdir(current, { mode: 0o700 });
    }
    catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') {
        throw error;
      }
    }
    const metadata = await lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new PluginSourceArchiveError('archive-unsafe-entry', 'The source archive contains a directory link.');
    }
  }
}

async function writeFileEntry(
  reader: TarChunkReader,
  root: string,
  segments: readonly string[],
  size: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const target = resolve(root, ...segments);
  if (!isContainedPath(root, target)) {
    throw new PluginSourceArchiveError('archive-unsafe-entry', 'The source archive path escaped its staging directory.');
  }
  await ensureDirectory(root, segments.slice(0, -1));
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
    handle = await open(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow, 0o600);
    created = true;
    let writtenBytes = 0;
    await reader.readExactly(size, async chunk => {
      throwIfAborted(signal);
      await writeAll(handle!, chunk);
      writtenBytes += chunk.byteLength;
    });
    if (writtenBytes !== size) {
      throw new PluginSourceArchiveError('archive-invalid', 'A source archive file ended before its declared size.');
    }
  }
  catch (error) {
    if (created) {
      await rm(target, { force: true }).catch(() => undefined);
    }
    throw error;
  }
  finally {
    await handle?.close();
  }
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (result.bytesWritten <= 0) {
      throw new PluginSourceArchiveError('archive-invalid', 'A source archive file could not be written.');
    }
    offset += result.bytesWritten;
  }
}

function isZeroBlock(block: Uint8Array): boolean {
  for (const byte of block) {
    if (byte !== 0) {
      return false;
    }
  }
  return true;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new PluginSourceArchiveError('archive-cancelled', 'The plugin source archive extraction was cancelled.');
  }
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

class TarChunkReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private readonly onBytes: (bytes: number) => void;
  private pending: Buffer | undefined;
  private pendingOffset = 0;
  private ended = false;

  constructor(stream: AsyncIterable<Uint8Array>, onBytes: (bytes: number) => void) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.onBytes = onBytes;
  }

  async readBlock(): Promise<Buffer | null> {
    if (this.ended && this.pending === undefined) {
      return null;
    }
    const block = Buffer.allocUnsafe(tarBlockBytes);
    let offset = 0;
    while (offset < block.length) {
      const chunk = await this.nextChunk();
      if (chunk === null) {
        if (offset === 0) {
          return null;
        }
        throw new PluginSourceArchiveError('archive-invalid', 'The source archive ended inside a tar header.');
      }
      const copyLength = Math.min(chunk.length, block.length - offset);
      chunk.copy(block, offset, 0, copyLength);
      offset += copyLength;
      if (copyLength < chunk.length) {
        this.pending = chunk;
        this.pendingOffset = copyLength;
      }
    }
    return block;
  }

  async readExactly(length: number, onChunk: (chunk: Buffer) => Promise<void>): Promise<void> {
    let remaining = length;
    while (remaining > 0) {
      const chunk = await this.nextChunk();
      if (chunk === null) {
        throw new PluginSourceArchiveError('archive-invalid', 'The source archive ended inside a file entry.');
      }
      const copyLength = Math.min(chunk.length, remaining);
      await onChunk(chunk.subarray(0, copyLength));
      remaining -= copyLength;
      if (copyLength < chunk.length) {
        this.pending = chunk;
        this.pendingOffset = copyLength;
      }
    }
  }

  async discard(length: number): Promise<void> {
    await this.readExactly(length, async () => undefined);
  }

  async close(): Promise<void> {
    try {
      await this.iterator.return?.();
    }
    catch {
      // Preserve the parser's original error during cleanup.
    }
  }

  private async nextChunk(): Promise<Buffer | null> {
    if (this.pending !== undefined) {
      const chunk = this.pending.subarray(this.pendingOffset);
      this.pending = undefined;
      this.pendingOffset = 0;
      if (chunk.length === 0) {
        return this.nextChunk();
      }
      return chunk;
    }
    if (this.ended) {
      return null;
    }
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return null;
    }
    const chunk = Buffer.from(next.value);
    if (chunk.length === 0) {
      return this.nextChunk();
    }
    this.onBytes(chunk.length);
    return chunk;
  }
}
