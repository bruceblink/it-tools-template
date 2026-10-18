const assetBaseUrl = `${import.meta.env.BASE_URL}assets/oui-data/`;
const maxManifestBytes = 64 * 1024;
const maxShardBytes = 512 * 1024;
const maxManifestShards = 4096;

type OuiRecords = Record<string, string>;

interface OuiShardDescriptor {
  prefix: string;
  file: string;
  sha256: string;
  recordCount: number;
  rawBytes: number;
  gzipBytes: number;
}

interface OuiManifest {
  schemaVersion: 1;
  dataVersion: string;
  recordCount: number;
  shards: OuiShardDescriptor[];
}

type FetchResource = typeof fetch;
interface RequestSignal {
  signal: AbortSignal
  cleanup(): void
}

function createRequestSignal(signal?: AbortSignal): RequestSignal {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    abort();
  }
  else {
    signal?.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abort);
    },
  };
}

export class OuiDataUnavailableError extends Error {
  constructor() {
    super('OUI vendor data is unavailable.');
    this.name = 'OuiDataUnavailableError';
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function validateManifest(value: unknown): OuiManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OuiDataUnavailableError();
  }
  const manifest = value as Partial<OuiManifest>;
  if (
    manifest.schemaVersion !== 1
    || typeof manifest.dataVersion !== 'string'
    || !manifest.dataVersion
    || !isNonNegativeInteger(manifest.recordCount)
    || manifest.recordCount > 100_000
    || !Array.isArray(manifest.shards)
    || manifest.shards.length === 0
    || manifest.shards.length > maxManifestShards
  ) {
    throw new OuiDataUnavailableError();
  }

  const prefixes = new Set<string>();
  const shards = manifest.shards.map((shard) => {
    if (!shard || typeof shard !== 'object') {
      throw new OuiDataUnavailableError();
    }
    const descriptor = shard as OuiShardDescriptor;
    if (
      !/^[0-9A-F]{1,3}$/.test(descriptor.prefix)
      || prefixes.has(descriptor.prefix)
      || !new RegExp(`^oui-${descriptor.prefix}-[a-f0-9]{16}\\.json$`).test(descriptor.file)
      || !/^[a-f0-9]{64}$/.test(descriptor.sha256)
      || !isNonNegativeInteger(descriptor.recordCount)
      || descriptor.recordCount === 0
      || !isNonNegativeInteger(descriptor.rawBytes)
      || descriptor.rawBytes > maxShardBytes
      || !isNonNegativeInteger(descriptor.gzipBytes)
      || descriptor.gzipBytes > maxShardBytes
    ) {
      throw new OuiDataUnavailableError();
    }
    prefixes.add(descriptor.prefix);
    return descriptor;
  });

  if (shards.reduce((sum, shard) => sum + shard.recordCount, 0) !== manifest.recordCount) {
    throw new OuiDataUnavailableError();
  }

  for (const [leftIndex, leftShard] of shards.entries()) {
    for (const rightShard of shards.slice(leftIndex + 1)) {
      if (leftShard.prefix.startsWith(rightShard.prefix) || rightShard.prefix.startsWith(leftShard.prefix)) {
        throw new OuiDataUnavailableError();
      }
    }
  }

  return { schemaVersion: 1, dataVersion: manifest.dataVersion, recordCount: manifest.recordCount, shards };
}

function validateRecords(value: unknown, descriptor: OuiShardDescriptor): OuiRecords {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OuiDataUnavailableError();
  }
  const records = value as Record<string, unknown>;
  const entries = Object.entries(records);
  if (entries.length !== descriptor.recordCount || entries.some(([prefix, vendor]) => (
    !/^[0-9A-F]{6}(?:[0-9A-F]|[0-9A-F]{3})?$/.test(prefix)
    || !prefix.startsWith(descriptor.prefix)
    || typeof vendor !== 'string'
    || vendor.length === 0
  ))) {
    throw new OuiDataUnavailableError();
  }
  return records as OuiRecords;
}

/** Load a manifest and one prefix shard at a time; failures leave the request retryable. */
export function createOuiVendorLookup(
  fetchResource: FetchResource = (...args) => globalThis.fetch(...args),
  baseUrl = assetBaseUrl,
) {
  let manifestRequest: Promise<OuiManifest> | undefined;
  const shardRequests = new Map<string, Promise<OuiRecords>>();

  async function fetchJson(path: string, byteLimit: number, signal?: AbortSignal): Promise<unknown> {
    const requestSignal = createRequestSignal(signal);
    try {
      const response = await fetchResource(`${baseUrl}${path}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: requestSignal.signal,
      });
      if (!response.ok) {
        throw new OuiDataUnavailableError();
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > byteLimit) {
        throw new OuiDataUnavailableError();
      }
      const content = await response.text();
      if (new TextEncoder().encode(content).byteLength > byteLimit) {
        throw new OuiDataUnavailableError();
      }
      try {
        return JSON.parse(content) as unknown;
      }
      catch {
        throw new OuiDataUnavailableError();
      }
    }
    finally {
      requestSignal.cleanup();
    }
  }

  function loadManifest(signal?: AbortSignal): Promise<OuiManifest> {
    manifestRequest ??= fetchJson('manifest.json', maxManifestBytes, signal)
      .then(validateManifest)
      .catch((error: unknown) => {
        manifestRequest = undefined;
        throw error instanceof OuiDataUnavailableError ? error : new OuiDataUnavailableError();
      });
    return manifestRequest;
  }

  function loadShard(descriptor: OuiShardDescriptor, signal?: AbortSignal): Promise<OuiRecords> {
    let request = shardRequests.get(descriptor.file);
    if (!request) {
      request = fetchJson(descriptor.file, maxShardBytes, signal)
        .then(value => validateRecords(value, descriptor))
        .catch((error: unknown) => {
          shardRequests.delete(descriptor.file);
          throw error instanceof OuiDataUnavailableError ? error : new OuiDataUnavailableError();
        });
      shardRequests.set(descriptor.file, request);
    }
    return request;
  }

  async function findVendor(address: string, signal?: AbortSignal): Promise<string | undefined> {
    const normalized = address.trim().toUpperCase();
    if (!/^(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/.test(normalized)) {
      return undefined;
    }
    const compactAddress = normalized.replace(/[:-]/g, '');
    const manifest = await loadManifest(signal);
    const descriptor = manifest.shards.find(shard => compactAddress.startsWith(shard.prefix));
    if (!descriptor) {
      throw new OuiDataUnavailableError();
    }

    const records = await loadShard(descriptor, signal);
    return records[compactAddress.slice(0, 9)]
      ?? records[compactAddress.slice(0, 7)]
      ?? records[compactAddress.slice(0, 6)];
  }

  return { findVendor };
}
