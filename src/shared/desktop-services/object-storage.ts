export type StorageError =
  | 'invalid-request'
  | 'untrusted-renderer'
  | 'not-connected'
  | 'busy'
  | 'cancelled'
  | 'timeout'
  | 'access-denied'
  | 'not-found'
  | 'response-too-large'
  | 'file-too-large'
  | 'object-exists'
  | 'local-file-error'
  | 'network-error'
  | 'service-unavailable';

export type StorageResult<T> = { ok: true; value: T } | { ok: false; error: StorageError };

/** Credentials exist only for this connection attempt; no profile or persistence is provided. */
export interface StorageConnectInput {
  requestId: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface StorageRequest {
  sessionId: string;
  requestId: string;
}

export interface StorageListInput extends StorageRequest {
  prefix: string;
  continuationToken: string | null;
}

export interface StoragePreviewInput extends StorageRequest {
  key: string;
}

export interface StorageUploadInput extends StoragePreviewInput {
  overwrite: boolean;
}

export interface StorageTransferResult {
  key: string;
  bytes: number;
}

export interface StorageProgress {
  requestId: string;
  key: string;
  direction: 'upload' | 'download';
  transferredBytes: number;
  totalBytes: number | null;
}

export interface StorageObject {
  key: string;
  size: number;
  lastModified: string | null;
}

export interface StoragePage {
  objects: StorageObject[];
  nextToken: string | null;
}

export interface StorageConnection {
  sessionId: string;
  endpoint: string;
  bucket: string;
  page: StoragePage;
}

export interface StoragePreview {
  key: string;
  contentType: string;
  text: string;
  binary: boolean;
  truncated: boolean;
}

export const STORAGE_TIMEOUT_MS = 10_000;
export const STORAGE_PAGE_SIZE = 100;
export const STORAGE_RESPONSE_BYTES = 1024 * 1024;
export const STORAGE_PREVIEW_BYTES = 64 * 1024;
export const STORAGE_TRANSFER_BYTES = 1024 * 1024 * 1024;
export const STORAGE_TRANSFER_TIMEOUT_MS = 5 * 60_000;
