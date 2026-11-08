// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchMarketplaceReleaseAsset,
  MarketplaceReleaseDownloadError,
  type MarketplaceReleaseRequest,
  type MarketplaceReleaseRequestFactory,
  type MarketplaceReleaseResponse,
} from './plugin-marketplace-download';

class FakeResponse extends EventEmitter implements MarketplaceReleaseResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  paused = false;
  destroyed = false;

  constructor(statusCode: number, headers: Record<string, string | string[]> = {}) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }
}

class FakeRequest extends EventEmitter implements MarketplaceReleaseRequest {
  readonly options: unknown;
  followRedirect = vi.fn();
  abort = vi.fn();
  end = vi.fn();

  constructor(options: unknown) {
    super();
    this.options = options;
  }
}

function createRequestFactory(requests: FakeRequest[]): MarketplaceReleaseRequestFactory {
  return {
    request(options) {
      const request = new FakeRequest(options);
      requests.push(request);
      return request;
    },
  };
}

function emitResponse(request: FakeRequest, response: FakeResponse): void {
  request.emit('response', response);
}

async function readBody(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

describe('marketplace release download adapter', () => {
  it('validates each relative redirect before following it and preserves an approved CDN query', async () => {
    const requests: FakeRequest[] = [];
    const factory = createRequestFactory(requests);
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      factory,
    );

    const first = requests[0]!;
    first.emit(
      'redirect',
      302,
      'GET',
      '/example/demo/releases/download/v1/demo.itplugin',
      {},
    );
    expect(first.followRedirect).toHaveBeenCalledOnce();

    first.emit(
      'redirect',
      302,
      'GET',
      'https://release-assets.githubusercontent.com/github-production-release-asset/demo?X-Amz-Signature=secret',
      {},
    );
    expect(first.followRedirect).toHaveBeenCalledTimes(2);

    const body = new FakeResponse(200, { 'content-length': '3', 'content-type': 'application/octet-stream' });
    emitResponse(first, body);
    const response = await operation;
    body.emit('data', Buffer.from([1, 2, 3]));
    body.emit('end');

    expect(await readBody(response)).toEqual(new Uint8Array([1, 2, 3]));
    expect(response.url).toBe('');
    expect(response.headers.get('content-length')).toBe('3');
    expect(response.headers.get('x-amz-signature')).toBeNull();
  });

  it('rejects an unapproved redirect without following or exposing its URL', async () => {
    const requests: FakeRequest[] = [];
    const factory = createRequestFactory(requests);
    const secretUrl = 'https://evil.example/download?token=secret';
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      factory,
    );
    const request = requests[0]!;
    request.emit('redirect', 302, 'GET', secretUrl, {});

    await expect(operation).rejects.toMatchObject({
      code: 'redirect-rejected',
    } satisfies Partial<MarketplaceReleaseDownloadError>);
    await expect(operation).rejects.not.toThrow(secretUrl);
    expect(request.followRedirect).not.toHaveBeenCalled();
    expect(request.abort).toHaveBeenCalledOnce();
  });

  it('rejects a GitHub URL with a query before creating a request', async () => {
    const request = vi.fn();
    await expect(fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin?token=secret',
      { request: request as MarketplaceReleaseRequestFactory['request'] },
    )).rejects.toMatchObject({ code: 'invalid-url' });
    expect(request).not.toHaveBeenCalled();
  });

  it('enforces the redirect limit', async () => {
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
      { maximumRedirects: 1 },
    );
    const request = requests[0]!;
    request.emit('redirect', 302, 'GET', '/first', {});
    request.emit('redirect', 302, 'GET', '/second', {});

    await expect(operation).rejects.toMatchObject({ code: 'redirect-limit' });
    expect(request.followRedirect).toHaveBeenCalledOnce();
    expect(request.abort).toHaveBeenCalledOnce();
  });

  it('cancels before a response and aborts the request', async () => {
    const controller = new AbortController();
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
      { signal: controller.signal },
    );
    controller.abort();

    await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
    expect(requests[0]!.abort).toHaveBeenCalledOnce();
  });

  it('cancels an active response stream and aborts the request', async () => {
    const controller = new AbortController();
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
      { signal: controller.signal },
    );
    const body = new FakeResponse(200);
    emitResponse(requests[0]!, body);
    const response = await operation;
    const reading = response.arrayBuffer();
    controller.abort();

    await expect(reading).rejects.toThrow();
    expect(requests[0]!.abort).toHaveBeenCalledOnce();
  });

  it('fails and aborts when a streamed body exceeds the bound', async () => {
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
      { maximumBytes: 2 },
    );
    const body = new FakeResponse(200);
    emitResponse(requests[0]!, body);
    const response = await operation;
    const reading = response.arrayBuffer();
    body.emit('data', Buffer.from([1, 2, 3]));

    await expect(reading).rejects.toMatchObject({ code: 'too-large' });
    expect(requests[0]!.abort).toHaveBeenCalledOnce();
  });

  it('returns an empty non-success response after draining it', async () => {
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
    );
    const body = new FakeResponse(404, { 'content-length': '7', 'x-private': 'hidden' });
    emitResponse(requests[0]!, body);
    const response = await operation;
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
    expect(response.headers.get('content-length')).toBe('7');
    expect(response.headers.get('x-private')).toBeNull();
    expect(requests[0]!.abort).not.toHaveBeenCalled();
    expect(body.paused).toBe(false);
  });

  it('rejects 304 responses that cannot be constructed as a Response', async () => {
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
    );
    emitResponse(requests[0]!, new FakeResponse(304));

    await expect(operation).rejects.toMatchObject({ code: 'response-failed' });
    expect(requests[0]!.abort).toHaveBeenCalledOnce();
  });

  it('returns valid bodyless responses for 204 and 205', async () => {
    for (const status of [204, 205]) {
      const requests: FakeRequest[] = [];
      const operation = fetchMarketplaceReleaseAsset(
        'https://github.com/example/demo/releases/download/v1/demo.itplugin',
        createRequestFactory(requests),
      );
      const body = new FakeResponse(status);
      emitResponse(requests[0]!, body);
      const response = await operation;

      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
      expect(body.paused).toBe(false);
      expect(requests[0]!.abort).not.toHaveBeenCalled();
    }
  });

  it('rejects malformed or duplicate content-length headers', async () => {
    for (const headers of [
      { 'content-length': 'not-a-number' },
      { 'content-length': ['3', '3'] },
    ]) {
      const requests: FakeRequest[] = [];
      const operation = fetchMarketplaceReleaseAsset(
        'https://github.com/example/demo/releases/download/v1/demo.itplugin',
        createRequestFactory(requests),
      );
      emitResponse(requests[0]!, new FakeResponse(200, headers));

      await expect(operation).rejects.toMatchObject({ code: 'response-failed' });
      expect(requests[0]!.abort).toHaveBeenCalledOnce();
    }
  });

  it('fails a response that closes before its body ends', async () => {
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
    );
    const body = new FakeResponse(200);
    emitResponse(requests[0]!, body);
    const response = await operation;
    const reading = response.arrayBuffer();
    body.emit('close');

    await expect(reading).rejects.toMatchObject({ code: 'stream-failed' });
    expect(requests[0]!.abort).toHaveBeenCalledOnce();
  });

  it('fails a response when the request closes before the body ends', async () => {
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
    );
    const body = new FakeResponse(200);
    emitResponse(requests[0]!, body);
    const response = await operation;
    const reading = response.arrayBuffer();
    requests[0]!.emit('close');

    await expect(reading).rejects.toMatchObject({ code: 'stream-failed' });
    expect(requests[0]!.abort).toHaveBeenCalledOnce();
  });

  it('allows a redirect event that follows the initial request close', async () => {
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
    );
    const request = requests[0]!;
    request.emit('finish');
    request.emit('close');
    request.emit(
      'redirect',
      302,
      'GET',
      'https://release-assets.githubusercontent.com/github-production-release-asset/demo?signature=secret',
      {},
    );
    expect(request.followRedirect).toHaveBeenCalledOnce();

    const body = new FakeResponse(200, { 'content-length': '3' });
    emitResponse(request, body);
    const response = await operation;
    const reading = response.arrayBuffer();
    body.emit('data', Buffer.from([1, 2, 3]));
    body.emit('end');

    expect((await reading).byteLength).toBe(3);
    expect(request.abort).not.toHaveBeenCalled();
  });

  it('registers the response end listener before data and ignores cancellation after completion', async () => {
    const controller = new AbortController();
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
      { signal: controller.signal },
    );
    const body = new FakeResponse(200);
    emitResponse(requests[0]!, body);
    const response = await operation;
    const reading = response.arrayBuffer();

    expect(body.listeners('end').length).toBe(1);
    expect(body.listeners('data').length).toBe(1);
    expect(body.listeners('end')[0]).not.toBe(body.listeners('data')[0]);
    expect(body.rawListeners('end').length).toBe(1);
    expect(body.rawListeners('data').length).toBe(1);
    body.emit('data', Buffer.from([1, 2, 3]));
    body.emit('end');
    await reading;
    controller.abort();

    expect(requests[0]!.abort).not.toHaveBeenCalled();
  });

  it('removes the abort listener after successful response completion', async () => {
    const controller = new AbortController();
    const removeAbortListener = vi.spyOn(controller.signal, 'removeEventListener');
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
      { signal: controller.signal },
    );
    const body = new FakeResponse(200);
    emitResponse(requests[0]!, body);
    const response = await operation;
    const reading = response.arrayBuffer();
    body.emit('end');
    await reading;

    expect(removeAbortListener).toHaveBeenCalledWith('abort', expect.any(Function));
    const removeCallCount = removeAbortListener.mock.calls.length;
    controller.abort();

    expect(removeAbortListener).toHaveBeenCalledTimes(removeCallCount);
    expect(requests[0]!.abort).not.toHaveBeenCalled();
  });

  it('maps a response stream error to a redacted error', async () => {
    const requests: FakeRequest[] = [];
    const operation = fetchMarketplaceReleaseAsset(
      'https://github.com/example/demo/releases/download/v1/demo.itplugin',
      createRequestFactory(requests),
    );
    const body = new FakeResponse(200);
    emitResponse(requests[0]!, body);
    const response = await operation;
    const reading = response.arrayBuffer();
    body.emit('error', new Error('https://release-assets.githubusercontent.com/asset?token=secret'));

    await expect(reading).rejects.toMatchObject({ code: 'stream-failed' });
    await expect(reading).rejects.not.toThrow('token=secret');
  });
});
