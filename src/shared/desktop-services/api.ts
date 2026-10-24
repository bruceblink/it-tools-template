export type ApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type ApiErrorCode =
  | 'invalid-request'
  | 'untrusted-renderer'
  | 'cancelled'
  | 'timeout'
  | 'network-error'
  | 'service-unavailable';

export type ApiBridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApiErrorCode };

export interface ApiRequestInput {
  requestId: string;
  method: ApiHttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
}

export interface ApiResponseHeader {
  name: string;
  value: string;
}

export interface ApiResponse {
  requestId: string;
  status: number;
  statusText: string;
  url: string;
  headers: ApiResponseHeader[];
  body: string;
  truncated: boolean;
  elapsedMs: number;
}

export const API_DEFAULT_TIMEOUT_MS = 10_000;
export const API_MIN_TIMEOUT_MS = 1_000;
export const API_MAX_TIMEOUT_MS = 30_000;
export const API_MAX_URL_LENGTH = 8 * 1024;
export const API_MAX_HEADERS = 64;
export const API_MAX_HEADER_NAME_LENGTH = 128;
export const API_MAX_HEADER_VALUE_LENGTH = 4 * 1024;
export const API_MAX_HEADER_BYTES = 16 * 1024;
export const API_MAX_BODY_BYTES = 256 * 1024;
export const API_MAX_RESPONSE_BYTES = 1 * 1024 * 1024;
export const API_MAX_RESPONSE_HEADERS = 128;
export const API_MAX_REQUEST_ID_LENGTH = 64;
