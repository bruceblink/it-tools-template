import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import { STORAGE_PREVIEW_BYTES, STORAGE_TIMEOUT_MS } from '../../src/shared/desktop-services/object-storage';
import { StorageService } from './storage-service';

const input = {
  requestId: 'connect',
  endpoint: 'https://s3.example.test',
  region: 'us-east-1',
  bucket: 'sample-bucket',
  accessKeyId: 'synthetic-access',
  secretAccessKey: 'synthetic-secret',
};
function setup() {
  const send = vi.fn().mockResolvedValue({ Contents: [] });
  const destroy = vi.fn();
  const service = new StorageService(() => ({ send, destroy }) as unknown as S3Client);
  return { send, destroy, service };
}

afterEach(() => vi.useRealTimers());
describe('object storage lifetime and resource boundaries', () => {
  it('binds sessions to the renderer and closes replaced clients', async () => {
    const { service, destroy } = setup();
    const result = await service.connect(1, input);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      await service.list(2, {
        sessionId: result.value.sessionId,
        requestId: 'list',
        prefix: '',
        continuationToken: null,
      }),
    ).toEqual({ ok: false, error: 'not-connected' });
    await service.connect(1, { ...input, requestId: 'reconnect' });
    expect(destroy).toHaveBeenCalledTimes(1);
    service.shutdown();
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('cancels connection setup and releases the rejected client', async () => {
    const { service, send, destroy } = setup();
    send.mockImplementation(
      (_command, { abortSignal }) =>
        new Promise((_resolve, reject) =>
          abortSignal.addEventListener('abort', () => reject(new Error('private diagnostics'))),
        ),
    );
    const pending = service.connect(1, input);
    expect(service.cancel(2, 'connect')).toBe(false);
    expect(service.cancel(1, 'connect')).toBe(true);
    expect(await pending).toEqual({ ok: false, error: 'cancelled' });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('times out an operation and removes credentials on failed connect', async () => {
    vi.useFakeTimers();
    const { service, send, destroy } = setup();
    send.mockImplementation(
      (_command, { abortSignal }) =>
        new Promise((_resolve, reject) => abortSignal.addEventListener('abort', () => reject(new Error('secret')))),
    );
    const pending = service.connect(1, input);
    await vi.advanceTimersByTimeAsync(STORAGE_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: 'timeout' });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('limits previews even when the server ignores Range and treats HTML as plain text', async () => {
    const { service, send } = setup();
    const result = await service.connect(1, input);
    if (!result.ok) {
      throw new Error('connect failed');
    }
    const body = Readable.from([Buffer.from('<script>window.test=1</script>' + 'x'.repeat(STORAGE_PREVIEW_BYTES))]);
    send.mockResolvedValue({ Body: body, ContentLength: STORAGE_PREVIEW_BYTES + 29, ContentType: 'text/html' });
    const preview = await service.preview(1, {
      sessionId: result.value.sessionId,
      requestId: 'preview',
      key: 'sample.html',
    });
    expect(preview.ok && preview.value.text.length).toBe(STORAGE_PREVIEW_BYTES);
    expect(preview.ok && preview.value.truncated).toBe(true);
    expect(body.destroyed).toBe(true);
    service.shutdown();
  });

  it('rejects oversized pages and reports access errors without service diagnostics', async () => {
    const { service, send, destroy } = setup();
    send.mockResolvedValue({ Contents: Array.from({ length: 101 }, () => ({ Key: 'sample', Size: 1 })) });
    expect(await service.connect(1, input)).toEqual({ ok: false, error: 'response-too-large' });
    send.mockRejectedValue({ message: input.secretAccessKey, $metadata: { httpStatusCode: 403 } });
    expect(await service.connect(1, input)).toEqual({ ok: false, error: 'access-denied' });
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('rejects concurrent work and aborts requests when the renderer closes', async () => {
    const { service, send, destroy } = setup();
    const result = await service.connect(1, input);
    if (!result.ok) {
      throw new Error('connect failed');
    }
    send.mockImplementation(
      (_command, { abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener('abort', () => reject(new Error('closed')));
        }),
    );
    const request = { sessionId: result.value.sessionId, requestId: 'listing', prefix: '', continuationToken: null };
    const pending = service.list(1, request);
    expect(await service.list(1, { ...request, requestId: 'duplicate' })).toEqual({ ok: false, error: 'busy' });
    service.closeRenderer(1);
    expect(await pending).toEqual({ ok: false, error: 'cancelled' });
    expect(destroy).toHaveBeenCalledOnce();
    expect(await service.list(1, request)).toEqual({ ok: false, error: 'not-connected' });
  });
});
