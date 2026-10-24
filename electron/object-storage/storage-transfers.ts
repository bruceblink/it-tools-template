import { constants, createWriteStream } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type {
  StorageError,
  StorageProgress,
  StorageTransferResult,
} from '../../src/shared/desktop-services/object-storage';
import { STORAGE_TRANSFER_BYTES } from '../../src/shared/desktop-services/object-storage';

export interface StorageTransferDependencies {
  selectUpload(renderer: number): Promise<string | null>;
  selectDownload(renderer: number, key: string): Promise<string | null>;
  confirm(renderer: number, operation: 'overwrite' | 'delete', bucket: string, key: string): Promise<boolean>;
  progress(renderer: number, progress: StorageProgress): void;
}

export class StorageTransferError extends Error {
  constructor(readonly code: StorageError) {
    super(code);
  }
}

interface TransferContext {
  client: S3Client;
  bucket: string;
  key: string;
  requestId: string;
  renderer: number;
  signal: AbortSignal;
  dependencies: StorageTransferDependencies;
}

/** Stream only a file selected in the main process. Conditional PUT prevents accidental replacement. */
export async function uploadStorageObject(
  context: TransferContext,
  overwrite: boolean,
): Promise<StorageTransferResult | null> {
  const { client, bucket, key, signal, renderer, dependencies } = context;
  const path = await dependencies.selectUpload(renderer);
  signal.throwIfAborted();
  if (!path) {
    return null;
  }
  if (overwrite && !(await dependencies.confirm(renderer, 'overwrite', bucket, key))) {
    return null;
  }
  signal.throwIfAborted();
  const file = await open(path, constants.O_RDONLY).catch(() => {
    throw new StorageTransferError('local-file-error');
  });
  let source: Readable | undefined;
  let body: Readable | undefined;
  try {
    const stats = await file.stat();
    if (!stats.isFile()) {
      throw new StorageTransferError('local-file-error');
    }
    if (stats.size > STORAGE_TRANSFER_BYTES) {
      throw new StorageTransferError('file-too-large');
    }
    signal.throwIfAborted();
    const progress = reporter(context, 'upload', stats.size);
    let bytes = 0;
    if (stats.size > 0) {
      source = file.createReadStream({ autoClose: false, end: stats.size - 1, signal });
      const input = source;
      body = Readable.from(
        (async function* () {
          for await (const chunk of input) {
            signal.throwIfAborted();
            bytes += chunk.length;
            progress(bytes);
            yield chunk;
          }
          if (bytes !== stats.size) {
            throw new StorageTransferError('local-file-error');
          }
        })(),
        { objectMode: false, highWaterMark: 64 * 1024 },
      );
    }
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body ?? Buffer.alloc(0),
        ContentLength: stats.size,
        ContentType: 'application/octet-stream',
        IfNoneMatch: overwrite ? undefined : '*',
      }),
      { abortSignal: signal },
    );
    signal.throwIfAborted();
    progress(stats.size, true);
    return { key, bytes: stats.size };
  } catch (error) {
    if (isLocalFileError(error)) {
      throw new StorageTransferError('local-file-error');
    }
    throw error;
  } finally {
    body?.destroy();
    source?.destroy();
    await file.close().catch(() => {});
  }
}

/** Write beside the destination and rename only after a complete bounded download. */
export async function downloadStorageObject(context: TransferContext): Promise<StorageTransferResult | null> {
  const { client, bucket, key, signal, renderer, dependencies } = context;
  const destination = await dependencies.selectDownload(renderer, key);
  signal.throwIfAborted();
  if (!destination) {
    return null;
  }
  const temporary = join(dirname(destination), `.it-tools-${randomUUID()}.part`);
  let source: Readable | undefined;
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
    source = result.Body as Readable | undefined;
    const total = result.ContentLength ?? null;
    if (total !== null && (!Number.isSafeInteger(total) || total < 0 || total > STORAGE_TRANSFER_BYTES)) {
      throw new StorageTransferError('file-too-large');
    }
    if (!source) {
      throw new StorageTransferError('network-error');
    }
    const progress = reporter(context, 'download', total);
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > STORAGE_TRANSFER_BYTES) {
          callback(new StorageTransferError('file-too-large'));
        } else {
          progress(bytes);
          callback(null, chunk);
        }
      },
    });
    await pipeline(source, counter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
    signal.throwIfAborted();
    if (total !== null && bytes !== total) {
      throw new StorageTransferError('network-error');
    }
    await rename(temporary, destination).catch(() => {
      throw new StorageTransferError('local-file-error');
    });
    progress(bytes, true);
    return { key, bytes };
  } catch (error) {
    if (isLocalFileError(error)) {
      throw new StorageTransferError('local-file-error');
    }
    throw error;
  } finally {
    source?.destroy();
    await rm(temporary, { force: true }).catch(() => {
      throw new StorageTransferError('local-file-error');
    });
  }
}

export async function deleteStorageObject(context: TransferContext): Promise<boolean> {
  const { client, bucket, key, signal, renderer, dependencies } = context;
  if (!(await dependencies.confirm(renderer, 'delete', bucket, key))) {
    return false;
  }
  signal.throwIfAborted();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
  return true;
}

// Cap event frequency independently of chunk size, while always reporting the initial and final state.
function reporter(context: TransferContext, direction: StorageProgress['direction'], totalBytes: number | null) {
  let previous = 0;
  const report = (transferredBytes: number, force = false) => {
    const now = Date.now();
    if (force || now - previous >= 100) {
      previous = now;
      context.dependencies.progress(context.renderer, {
        requestId: context.requestId,
        key: context.key,
        direction,
        transferredBytes,
        totalBytes,
      });
    }
  };
  report(0, true);
  return report;
}

const LOCAL_FILE_ERROR_CODES = new Set([
  'EACCES',
  'EBADF',
  'EISDIR',
  'EIO',
  'ELOOP',
  'EMFILE',
  'ENFILE',
  'ENOENT',
  'ENOSPC',
  'ENOTDIR',
  'EPERM',
  'ESTALE',
]);

/** SDK streams can wrap file-system failures, so inspect a short cause chain before mapping the public error. */
function isLocalFileError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && LOCAL_FILE_ERROR_CODES.has(candidate.code)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
