import type {
  StorageConnectInput,
  StorageListInput,
  StoragePreviewInput,
} from '../../src/shared/desktop-services/object-storage';

function record(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function text(value: unknown, max: number, empty = false): value is string {
  return (
    typeof value === 'string' &&
    (empty || value.length > 0) &&
    Buffer.byteLength(value, 'utf8') <= max &&
    !value.includes('\0')
  );
}

function id(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/i.test(value);
}

/** Restrict signed requests to a single explicit origin; plaintext is only for local testing. */
export function parseStorageConnect(value: unknown): StorageConnectInput | null {
  if (
    !record(value, ['requestId', 'endpoint', 'region', 'bucket', 'accessKeyId', 'secretAccessKey', 'sessionToken']) ||
    !id(value.requestId) ||
    !text(value.endpoint, 2048) ||
    typeof value.region !== 'string' ||
    !/^[a-z0-9-]{1,64}$/i.test(value.region) ||
    typeof value.bucket !== 'string' ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket) ||
    value.bucket.includes('..') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(value.bucket) ||
    !text(value.accessKeyId, 256) ||
    !text(value.secretAccessKey, 4096) ||
    /[\x00-\x20\x7f]/.test(value.accessKeyId + value.secretAccessKey) ||
    (value.sessionToken !== undefined &&
      (!text(value.sessionToken, 16384, true) || /[\x00-\x20\x7f]/.test(value.sessionToken)))
  ) {
    return null;
  }
  try {
    const endpoint = new URL(value.endpoint);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (
      (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && local)) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== '/'
    ) {
      return null;
    }
    return {
      requestId: value.requestId,
      endpoint: endpoint.origin,
      region: value.region,
      bucket: value.bucket,
      accessKeyId: value.accessKeyId,
      secretAccessKey: value.secretAccessKey,
      sessionToken: value.sessionToken || undefined,
    };
  } catch {
    return null;
  }
}

export function parseStorageList(value: unknown): StorageListInput | null {
  if (
    !record(value, ['sessionId', 'requestId', 'prefix', 'continuationToken']) ||
    !id(value.sessionId) ||
    !id(value.requestId) ||
    !text(value.prefix, 1024, true) ||
    !(value.continuationToken === null || text(value.continuationToken, 8192))
  ) {
    return null;
  }
  return {
    sessionId: value.sessionId,
    requestId: value.requestId,
    prefix: value.prefix,
    continuationToken: value.continuationToken,
  };
}

export function parseStoragePreview(value: unknown): StoragePreviewInput | null {
  return record(value, ['sessionId', 'requestId', 'key']) &&
    id(value.sessionId) &&
    id(value.requestId) &&
    text(value.key, 1024)
    ? { sessionId: value.sessionId, requestId: value.requestId, key: value.key }
    : null;
}

export function parseStorageCancel(value: unknown): string | null {
  return record(value, ['requestId']) && id(value.requestId) ? value.requestId : null;
}
