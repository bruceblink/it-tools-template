import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const macAddressPattern = /^(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/;
const shardFilePattern = /^oui-([0-9A-F]{1,3})-([a-f0-9]{16})\.json$/;
const shardPrefixPattern = /^[0-9A-F]{1,3}$/;
const ouiRecordPattern = /^[0-9A-F]{6}(?:[0-9A-F]|[0-9A-F]{3})?$/;

export const externalPluginV2OuiLimits = Object.freeze({
  maximumManifestBytes: 64 * 1024,
  maximumShardBytes: 512 * 1024,
  maximumShards: 4096,
  maximumRecords: 100_000,
  maximumVendorCharacters: 512,
  maximumResultBytes: 16 * 1024,
  timeoutMs: 10_000,
});

export const externalPluginV2OuiErrorCodes = Object.freeze([
  'invalid-query',
  'manifest-invalid',
  'path-invalid',
  'resource-limit',
  'resource-unavailable',
  'integrity-mismatch',
  'data-invalid',
  'timeout',
  'cancelled',
] as const);

export type ExternalPluginV2OuiErrorCode = typeof externalPluginV2OuiErrorCodes[number];

/** 主进程读取 OUI 资源的最小接口；测试可以用内存映射替换文件读取。 */
export type ExternalPluginV2OuiResourceReader = (
  relativePath: string,
  maximumBytes: number,
  signal: AbortSignal,
) => Promise<Uint8Array>;

export interface ExternalPluginV2OuiReaderOptions {
  /** 默认读取器使用该目录；目录必须是绝对的真实目录。 */
  readonly baseDirectory?: string;
  /** 提供后覆盖默认文件读取器，返回 UTF-8 JSON 的字节。 */
  readonly readResource?: ExternalPluginV2OuiResourceReader;
  readonly timeoutMs?: number;
}

export interface ExternalPluginV2OuiLookupResult {
  readonly vendor: string | null;
  readonly dataVersion: string;
}

interface OuiShardDescriptor {
  readonly prefix: string;
  readonly file: string;
  readonly sha256: string;
  readonly recordCount: number;
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

interface OuiManifest {
  readonly schemaVersion: 1;
  readonly dataVersion: string;
  readonly recordCount: number;
  readonly shards: readonly OuiShardDescriptor[];
}

type OuiRecords = Readonly<Record<string, string>>;

export class ExternalPluginV2OuiError extends Error {
  constructor(readonly code: ExternalPluginV2OuiErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExternalPluginV2OuiError';
  }
}

/** 读取已生成且带哈希索引的 OUI 数据；模块不执行插件代码。 */
export class ExternalPluginV2OuiReader {
  private readonly timeoutMs: number;
  private readonly readResource: ExternalPluginV2OuiResourceReader;
  private manifestRequest: Promise<OuiManifest> | undefined;
  private readonly shardRequests = new Map<string, Promise<OuiRecords>>();

  constructor(options: ExternalPluginV2OuiReaderOptions) {
    this.timeoutMs = options.timeoutMs ?? externalPluginV2OuiLimits.timeoutMs;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new RangeError('The OUI reader timeout must be a positive integer.');
    }
    if (options.readResource) {
      this.readResource = options.readResource;
      return;
    }
    if (!options.baseDirectory || !isAbsolute(options.baseDirectory)) {
      throw new ExternalPluginV2OuiError('path-invalid', 'The OUI data directory must be absolute.');
    }
    this.readResource = createFileResourceReader(options.baseDirectory);
  }

  async findVendor(query: string, signal?: AbortSignal): Promise<ExternalPluginV2OuiLookupResult> {
    const normalized = normalizeMacAddress(query);
    const operation = createOperationSignal(signal, this.timeoutMs);
    try {
      const manifest = await this.loadManifest(operation.signal);
      assertOperationActive(operation.signal);
      const compactAddress = normalized.replace(/[:-]/g, '');
      const descriptor = manifest.shards.find(candidate => compactAddress.startsWith(candidate.prefix));
      if (!descriptor) {
        return { vendor: null, dataVersion: manifest.dataVersion };
      }
      const records = await this.loadShard(descriptor, operation.signal);
      assertOperationActive(operation.signal);
      const vendor = records[compactAddress.slice(0, 9)]
        ?? records[compactAddress.slice(0, 7)]
        ?? records[compactAddress.slice(0, 6)]
        ?? null;
      const result = { vendor, dataVersion: manifest.dataVersion } satisfies ExternalPluginV2OuiLookupResult;
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > externalPluginV2OuiLimits.maximumResultBytes) {
        throw new ExternalPluginV2OuiError('resource-limit', 'The OUI lookup result is too large.');
      }
      return result;
    }
    catch (error) {
      throw mapOuiError(error, operation);
    }
    finally {
      operation.cleanup();
    }
  }

  private loadManifest(signal: AbortSignal): Promise<OuiManifest> {
    if (!this.manifestRequest) {
      this.manifestRequest = this.readJson('manifest.json', externalPluginV2OuiLimits.maximumManifestBytes, signal)
        .then(validateManifest)
        .catch(error => {
          this.manifestRequest = undefined;
          throw error;
        });
    }
    return this.manifestRequest;
  }

  private loadShard(descriptor: OuiShardDescriptor, signal: AbortSignal): Promise<OuiRecords> {
    let request = this.shardRequests.get(descriptor.file);
    if (!request) {
      request = this.readJson(descriptor.file, externalPluginV2OuiLimits.maximumShardBytes, signal)
        .then(value => validateShard(value, descriptor))
        .catch(error => {
          this.shardRequests.delete(descriptor.file);
          throw error;
        });
      this.shardRequests.set(descriptor.file, request);
    }
    return request;
  }

  private async readJson(path: string, maximumBytes: number, signal: AbortSignal): Promise<unknown> {
    if (path !== 'manifest.json' && !shardFilePattern.test(path)) {
      throw new ExternalPluginV2OuiError('path-invalid', 'The OUI resource path is invalid.');
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.readResource(path, maximumBytes, signal);
    }
    catch (error) {
      if (error instanceof ExternalPluginV2OuiError) {
        throw error;
      }
      throw new ExternalPluginV2OuiError('resource-unavailable', 'The OUI resource could not be read.', { cause: error });
    }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > maximumBytes) {
      throw new ExternalPluginV2OuiError('resource-limit', 'The OUI resource exceeds its size limit.');
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return JSON.parse(text) as unknown;
    }
    catch (error) {
      throw new ExternalPluginV2OuiError('data-invalid', 'The OUI resource is not valid UTF-8 JSON.', { cause: error });
    }
  }
}

export function createExternalPluginV2OuiReader(options: ExternalPluginV2OuiReaderOptions): ExternalPluginV2OuiReader {
  return new ExternalPluginV2OuiReader(options);
}

function createFileResourceReader(baseDirectory: string): ExternalPluginV2OuiResourceReader {
  const root = resolve(baseDirectory);
  return async (relativePath, maximumBytes, signal) => {
    const metadata = await lstat(root).catch(error => {
      throw new ExternalPluginV2OuiError('resource-unavailable', 'The OUI data directory could not be inspected.', { cause: error });
    });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new ExternalPluginV2OuiError('path-invalid', 'The OUI data directory must be a real directory.');
    }
    const canonicalRoot = await realpath(root).catch(error => {
      throw new ExternalPluginV2OuiError('resource-unavailable', 'The OUI data directory could not be resolved.', { cause: error });
    });
    if (canonicalRoot !== root) {
      throw new ExternalPluginV2OuiError('path-invalid', 'The OUI data directory must be canonical.');
    }
    const candidate = resolve(canonicalRoot, relativePath);
    if (!isContainedPath(canonicalRoot, candidate)) {
      throw new ExternalPluginV2OuiError('path-invalid', 'The OUI resource escaped its data directory.');
    }
    const resourceMetadata = await lstat(candidate).catch(error => {
      throw new ExternalPluginV2OuiError('resource-unavailable', 'The OUI resource could not be inspected.', { cause: error });
    });
    if (!resourceMetadata.isFile() || resourceMetadata.isSymbolicLink()) {
      throw new ExternalPluginV2OuiError('path-invalid', 'The OUI resource must be a regular file.');
    }
    if (resourceMetadata.size > maximumBytes) {
      throw new ExternalPluginV2OuiError('resource-limit', 'The OUI resource exceeds its size limit.');
    }
    const bytes = await readFile(candidate, { signal });
    if (bytes.byteLength !== resourceMetadata.size || bytes.byteLength > maximumBytes) {
      throw new ExternalPluginV2OuiError('resource-limit', 'The OUI resource changed or exceeds its size limit.');
    }
    return new Uint8Array(bytes);
  };
}

function validateManifest(value: unknown): OuiManifest {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'dataVersion', 'recordCount', 'shards'])
    || value.schemaVersion !== 1
    || typeof value.dataVersion !== 'string'
    || !stableVersionPattern.test(value.dataVersion)
    || !isBoundedInteger(value.recordCount, 0, externalPluginV2OuiLimits.maximumRecords)
    || !Array.isArray(value.shards)
    || value.shards.length === 0
    || value.shards.length > externalPluginV2OuiLimits.maximumShards) {
    throw new ExternalPluginV2OuiError('manifest-invalid', 'The OUI manifest is invalid.');
  }
  const prefixes = new Set<string>();
  const shards = value.shards.map((raw, index) => validateDescriptor(raw, index, prefixes));
  if (shards.reduce((total, shard) => total + shard.recordCount, 0) !== value.recordCount) {
    throw new ExternalPluginV2OuiError('manifest-invalid', 'The OUI manifest record count is inconsistent.');
  }
  for (const [index, shard] of shards.entries()) {
    for (const other of shards.slice(index + 1)) {
      if (shard.prefix.startsWith(other.prefix) || other.prefix.startsWith(shard.prefix)) {
        throw new ExternalPluginV2OuiError('manifest-invalid', 'The OUI manifest contains overlapping shard prefixes.');
      }
    }
  }
  return { schemaVersion: 1, dataVersion: value.dataVersion, recordCount: value.recordCount, shards };
}

function validateDescriptor(value: unknown, index: number, prefixes: Set<string>): OuiShardDescriptor {
  if (!isRecord(value)
    || !hasExactKeys(value, ['prefix', 'file', 'sha256', 'recordCount', 'rawBytes', 'gzipBytes'])
    || typeof value.prefix !== 'string'
    || !shardPrefixPattern.test(value.prefix)
    || prefixes.has(value.prefix)
    || typeof value.file !== 'string'
    || !shardFilePattern.test(value.file)
    || !value.file.startsWith(`oui-${value.prefix}-`)
    || typeof value.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !isBoundedInteger(value.recordCount, 1, externalPluginV2OuiLimits.maximumRecords)
    || !isBoundedInteger(value.rawBytes, 1, externalPluginV2OuiLimits.maximumShardBytes)
    || !isBoundedInteger(value.gzipBytes, 1, externalPluginV2OuiLimits.maximumShardBytes)) {
    throw new ExternalPluginV2OuiError('manifest-invalid', `The OUI shard descriptor ${index} is invalid.`);
  }
  prefixes.add(value.prefix);
  return {
    prefix: value.prefix,
    file: value.file,
    sha256: value.sha256,
    recordCount: value.recordCount,
    rawBytes: value.rawBytes,
    gzipBytes: value.gzipBytes,
  };
}

function validateShard(value: unknown, descriptor: OuiShardDescriptor): OuiRecords {
  if (!isRecord(value)) {
    throw new ExternalPluginV2OuiError('data-invalid', 'The OUI shard is not an object.');
  }
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new ExternalPluginV2OuiError('data-invalid', 'The OUI shard could not be serialized.');
  }
  const bytes = new TextEncoder().encode(`${serialized}\n`);
  if (bytes.byteLength > externalPluginV2OuiLimits.maximumShardBytes || bytes.byteLength !== descriptor.rawBytes) {
    throw new ExternalPluginV2OuiError('resource-limit', 'The OUI shard exceeds its size limit.');
  }
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== descriptor.sha256) {
    throw new ExternalPluginV2OuiError('integrity-mismatch', 'The OUI shard hash does not match its manifest.');
  }
  const entries = Object.entries(value);
  if (entries.length !== descriptor.recordCount || entries.some(([prefix, vendor]) => (
    !ouiRecordPattern.test(prefix)
    || !prefix.startsWith(descriptor.prefix)
    || typeof vendor !== 'string'
    || vendor.length === 0
    || vendor.length > externalPluginV2OuiLimits.maximumVendorCharacters
  ))) {
    throw new ExternalPluginV2OuiError('data-invalid', 'The OUI shard records are invalid.');
  }
  return Object.freeze(Object.fromEntries(entries) as OuiRecords);
}

function normalizeMacAddress(value: unknown): string {
  if (typeof value !== 'string' || !macAddressPattern.test(value.trim().toUpperCase())) {
    throw new ExternalPluginV2OuiError('invalid-query', 'The OUI query must be a complete MAC address.');
  }
  return value.trim().toUpperCase();
}

function assertOperationActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('The OUI lookup operation was aborted.');
  }
}

function createOperationSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason);
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort('timeout');
  }, timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    onAbort();
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function mapOuiError(error: unknown, operation: ReturnType<typeof createOperationSignal>): ExternalPluginV2OuiError {
  if (operation.timedOut()) {
    return new ExternalPluginV2OuiError('timeout', 'The OUI lookup timed out.', { cause: error });
  }
  if (operation.signal.aborted) {
    return new ExternalPluginV2OuiError('cancelled', 'The OUI lookup was cancelled.', { cause: error });
  }
  if (error instanceof ExternalPluginV2OuiError) {
    return error;
  }
  return new ExternalPluginV2OuiError('resource-unavailable', 'The OUI lookup failed.', { cause: error });
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function isContainedPath(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
