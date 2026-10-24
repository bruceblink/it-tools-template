import { Readable } from 'node:stream';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { S3Client } from '@aws-sdk/client-s3';
import type { StorageConnectInput } from '../../src/shared/desktop-services/object-storage';
import {
  STORAGE_RESPONSE_BYTES,
  STORAGE_TIMEOUT_MS,
  STORAGE_TRANSFER_BYTES,
} from '../../src/shared/desktop-services/object-storage';

export class StorageResponseLimit extends Error {}

/** Limit raw XML before SDK deserialization and destroy sockets on cancellation or early reads. */
export function createStorageClient(input: StorageConnectInput): S3Client {
  const handler = new NodeHttpHandler({
    connectionTimeout: STORAGE_TIMEOUT_MS,
    // Service timers cover the complete operation, including response streaming.
    requestTimeout: 0,
    httpAgent: { keepAlive: false, maxSockets: 1 },
    httpsAgent: { keepAlive: false, maxSockets: 1 },
  });
  const handle = handler.handle.bind(handler);
  handler.handle = async (request, options) => {
    const result = await handle(request, options);
    const maximum =
      request.method === 'GET' && !request.query?.['list-type'] && result.response.statusCode < 300
        ? STORAGE_TRANSFER_BYTES
        : STORAGE_RESPONSE_BYTES;
    const source = result.response.body as Readable;
    if (source instanceof Readable) {
      const signal = options?.abortSignal as AbortSignal | undefined;
      const abort = () => source.destroy(new Error('Storage request aborted'));
      signal?.addEventListener('abort', abort, { once: true });
      source.once('close', () => signal?.removeEventListener('abort', abort));
      if (signal?.aborted) {
        abort();
      }
      const boundedBody = Readable.from(
        (async function* () {
          let bytes = 0;
          try {
            for await (const chunk of source) {
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              bytes += buffer.byteLength;
              if (bytes > maximum) {
                throw new StorageResponseLimit();
              }
              yield buffer;
            }
          } finally {
            signal?.removeEventListener('abort', abort);
            source.destroy();
          }
        })(),
        { objectMode: false, highWaterMark: 16 * 1024 },
      );
      boundedBody.once('close', () => source.destroy());
      result.response.body = boundedBody;
    }
    return result;
  };
  return new S3Client({
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      sessionToken: input.sessionToken,
    },
    requestHandler: handler,
    maxAttempts: 1,
    followRegionRedirects: false,
    disableS3ExpressSessionAuth: true,
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}
