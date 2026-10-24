import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import type {
  StorageConnectInput,
  StorageConnection,
  StorageError,
  StorageListInput,
  StoragePage,
  StoragePreview,
  StoragePreviewInput,
  StorageResult,
} from '../../src/shared/desktop-services/object-storage';
import {
  STORAGE_PAGE_SIZE,
  STORAGE_PREVIEW_BYTES,
  STORAGE_TIMEOUT_MS,
} from '../../src/shared/desktop-services/object-storage';
import { createStorageClient, StorageResponseLimit } from './storage-client';

interface ActiveRequest {
  requestId: string;
  controller: AbortController;
  reason: 'cancelled' | 'timeout' | null;
}

interface StorageSession {
  id: string;
  bucket: string;
  client: S3Client;
  active: ActiveRequest | null;
}

/** One memory-only connection and request per renderer. Errors never expose SDK diagnostics or secrets. */
export class StorageService {
  private readonly sessions = new Map<number, StorageSession>();

  constructor(private readonly clientFactory = createStorageClient) {}

  async connect(renderer: number, input: StorageConnectInput): Promise<StorageResult<StorageConnection>> {
    this.closeRenderer(renderer);
    const session: StorageSession = {
      id: randomUUID(),
      bucket: input.bucket,
      client: this.clientFactory(input),
      active: null,
    };
    this.sessions.set(renderer, session);
    const result = await this.run(session, input.requestId, async (signal) => ({
      sessionId: session.id,
      endpoint: input.endpoint,
      bucket: input.bucket,
      page: await this.readPage(session, '', null, signal),
    }));
    if (!result.ok && this.sessions.get(renderer) === session) {
      this.closeRenderer(renderer);
    }
    return result;
  }

  async list(renderer: number, input: StorageListInput): Promise<StorageResult<StoragePage>> {
    const session = this.getSession(renderer, input.sessionId);
    return session
      ? this.run(session, input.requestId, (signal) =>
          this.readPage(session, input.prefix, input.continuationToken, signal),
        )
      : { ok: false, error: 'not-connected' };
  }

  async preview(renderer: number, input: StoragePreviewInput): Promise<StorageResult<StoragePreview>> {
    const session = this.getSession(renderer, input.sessionId);
    return session
      ? this.run(session, input.requestId, async (signal) => {
          const metadata = await session.client.send(
            new HeadObjectCommand({ Bucket: session.bucket, Key: input.key }),
            { abortSignal: signal },
          );
          if (metadata.ContentLength === 0) {
            return {
              key: input.key,
              contentType: (metadata.ContentType ?? '').slice(0, 256),
              text: '',
              binary: false,
              truncated: false,
            };
          }
          const result = await session.client.send(
            new GetObjectCommand({
              Bucket: session.bucket,
              Key: input.key,
              Range: `bytes=0-${STORAGE_PREVIEW_BYTES - 1}`,
            }),
            { abortSignal: signal },
          );
          const body = result.Body as Readable | undefined;
          const buffers: Buffer[] = [];
          let bytes = 0;
          let truncated = false;
          try {
            if (body) {
              for await (const chunk of body) {
                if (signal.aborted) {
                  throw new Error('Storage request aborted');
                }
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                const remaining = STORAGE_PREVIEW_BYTES - bytes;
                buffers.push(buffer.subarray(0, remaining));
                bytes += Math.min(buffer.length, remaining);
                if (bytes >= STORAGE_PREVIEW_BYTES) {
                  const total = result.ContentRange?.match(/\/(\d+)$/)?.[1];
                  truncated = buffer.length > remaining || Number(total ?? result.ContentLength ?? Infinity) > bytes;
                  break;
                }
              }
            }
          } finally {
            body?.destroy();
          }
          const data = Buffer.concat(buffers);
          let text = '';
          let binary = data.some((byte) => byte < 32 && ![9, 10, 13].includes(byte));
          try {
            if (!binary) {
              text = new TextDecoder('utf-8', { fatal: true }).decode(data, { stream: truncated });
            }
          } catch {
            binary = true;
          }
          return { key: input.key, contentType: (result.ContentType ?? '').slice(0, 256), text, binary, truncated };
        })
      : { ok: false, error: 'not-connected' };
  }

  cancel(renderer: number, requestId: string): boolean {
    const active = this.sessions.get(renderer)?.active;
    if (!active || active.requestId !== requestId) {
      return false;
    }
    active.reason = 'cancelled';
    active.controller.abort();
    return true;
  }

  closeRenderer(renderer: number): void {
    const session = this.sessions.get(renderer);
    if (!session) {
      return;
    }
    this.sessions.delete(renderer);
    if (session.active) {
      session.active.reason = 'cancelled';
      session.active.controller.abort();
    }
    session.client.destroy();
  }

  shutdown(): void {
    for (const renderer of this.sessions.keys()) {
      this.closeRenderer(renderer);
    }
  }

  private getSession(renderer: number, id: string): StorageSession | undefined {
    const session = this.sessions.get(renderer);
    return session?.id === id ? session : undefined;
  }

  private async readPage(
    session: StorageSession,
    prefix: string,
    token: string | null,
    signal: AbortSignal,
  ): Promise<StoragePage> {
    const result = await session.client.send(
      new ListObjectsV2Command({
        Bucket: session.bucket,
        Prefix: prefix,
        ContinuationToken: token ?? undefined,
        MaxKeys: STORAGE_PAGE_SIZE,
      }),
      { abortSignal: signal },
    );
    const objects = result.Contents ?? [];
    const nextToken = result.IsTruncated ? result.NextContinuationToken : null;
    if (
      objects.length > STORAGE_PAGE_SIZE ||
      (result.IsTruncated && (!nextToken || Buffer.byteLength(nextToken) > 8192)) ||
      objects.some(
        (object) =>
          typeof object.Key !== 'string' ||
          Buffer.byteLength(object.Key) > 1024 ||
          !Number.isSafeInteger(object.Size) ||
          object.Size! < 0,
      )
    ) {
      throw new StorageResponseLimit();
    }
    return {
      objects: objects.map((object) => ({
        key: object.Key!,
        size: object.Size!,
        lastModified: object.LastModified?.toISOString() ?? null,
      })),
      nextToken: nextToken ?? null,
    };
  }

  private async run<T>(
    session: StorageSession,
    requestId: string,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<StorageResult<T>> {
    if (session.active) {
      return { ok: false, error: 'busy' };
    }
    const active: ActiveRequest = { requestId, controller: new AbortController(), reason: null };
    session.active = active;
    const timer = setTimeout(() => {
      active.reason = 'timeout';
      active.controller.abort();
    }, STORAGE_TIMEOUT_MS);
    try {
      const value = await action(active.controller.signal);
      return active.reason ? { ok: false, error: active.reason } : { ok: true, value };
    } catch (error) {
      return { ok: false, error: active.reason ?? storageError(error) };
    } finally {
      clearTimeout(timer);
      session.active = null;
    }
  }
}

function storageError(error: unknown): StorageError {
  if (error instanceof StorageResponseLimit) {
    return 'response-too-large';
  }
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  if (status === 401 || status === 403) {
    return 'access-denied';
  }
  if (status === 404) {
    return 'not-found';
  }
  return 'network-error';
}
