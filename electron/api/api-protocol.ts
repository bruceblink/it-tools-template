import type { ApiHttpMethod, ApiRequestInput } from '../../src/shared/desktop-services/api';
import {
  API_DEFAULT_TIMEOUT_MS,
  API_MAX_BODY_BYTES,
  API_MAX_HEADER_BYTES,
  API_MAX_HEADER_NAME_LENGTH,
  API_MAX_HEADERS,
  API_MAX_HEADER_VALUE_LENGTH,
  API_MAX_REQUEST_ID_LENGTH,
  API_MAX_TIMEOUT_MS,
  API_MAX_URL_LENGTH,
  API_MIN_TIMEOUT_MS,
  utf8ByteLengthWithinLimit,
} from '../../src/shared/desktop-services/api';

const methods = new Set<ApiHttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const forbiddenHeaders = new Set(['connection', 'content-length', 'host', 'transfer-encoding']);

export function parseApiRequest(value: unknown): ApiRequestInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['requestId', 'method', 'url', 'headers', 'body', 'timeoutMs'])) {
    return null;
  }
  const requestId = parseBoundedString(value.requestId, API_MAX_REQUEST_ID_LENGTH);
  const method = typeof value.method === 'string' && methods.has(value.method as ApiHttpMethod)
    ? value.method as ApiHttpMethod
    : null;
  const url = parseUrl(value.url);
  const headers = parseHeaders(value.headers);
  const body = parseBody(value.body);
  const timeoutMs = parseTimeout(value.timeoutMs);
  if (!requestId || !method || !url || !headers || body === undefined || timeoutMs === null) {
    return null;
  }
  if ((method === 'GET' || method === 'HEAD') && body !== null) {
    return null;
  }
  return { requestId, method, url, headers, body, timeoutMs };
}

export function parseApiRequestId(value: unknown): string | null {
  return isRecord(value) && hasOnlyKeys(value, ['requestId'])
    ? parseBoundedString(value.requestId, API_MAX_REQUEST_ID_LENGTH)
    : null;
}

function parseUrl(value: unknown): string | null {
  if (typeof value !== 'string'
    || value.length === 0
    || utf8ByteLengthWithinLimit(value, API_MAX_URL_LENGTH) === null) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  }
  catch {
    return null;
  }
}

function parseHeaders(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (entries.length > API_MAX_HEADERS) {
    return null;
  }
  const headers: Record<string, string> = {};
  let totalBytes = 0;
  for (const [name, rawValue] of entries) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
      || name.length > API_MAX_HEADER_NAME_LENGTH
      || forbiddenHeaders.has(name.toLowerCase())
      || typeof rawValue !== 'string'
      || rawValue.length > API_MAX_HEADER_VALUE_LENGTH
      || /[\r\n]/.test(rawValue)) {
      return null;
    }
    const nameBytes = utf8ByteLengthWithinLimit(name, API_MAX_HEADER_NAME_LENGTH);
    if (nameBytes === null) {
      return null;
    }
    const remainingValueBytes = API_MAX_HEADER_BYTES - totalBytes - nameBytes;
    const valueBytes = utf8ByteLengthWithinLimit(rawValue, remainingValueBytes);
    if (valueBytes === null) { return null; }
    totalBytes += nameBytes + valueBytes;
    headers[name] = rawValue;
  }
  return headers;
}

function parseBody(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || utf8ByteLengthWithinLimit(value, API_MAX_BODY_BYTES) === null) {
    return undefined;
  }
  return value;
}

function parseTimeout(value: unknown): number | null {
  if (value === undefined) {
    return API_DEFAULT_TIMEOUT_MS;
  }
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= API_MIN_TIMEOUT_MS
    && value <= API_MAX_TIMEOUT_MS
    ? value
    : null;
}

function parseBoundedString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.every(key => expected.includes(key));
}
