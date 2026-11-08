import type { ClientRequestConstructorOptions, Net } from 'electron';

const defaultMaximumBytes = 64 * 1024 * 1024;
const defaultMaximumRedirects = 5;
const githubDownloadHosts = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const safeResponseHeaders = new Set([
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-length',
  'content-type',
  'etag',
  'last-modified',
]);

export type MarketplaceReleaseDownloadErrorCode =
  | 'invalid-url'
  | 'redirect-rejected'
  | 'redirect-limit'
  | 'request-failed'
  | 'response-failed'
  | 'stream-failed'
  | 'too-large'
  | 'cancelled';

export class MarketplaceReleaseDownloadError extends Error {
  constructor(
    readonly code: MarketplaceReleaseDownloadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MarketplaceReleaseDownloadError';
  }
}

export interface MarketplaceReleaseRequestOptions {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly credentials?: 'omit';
  readonly useSessionCookies?: false;
  readonly redirect?: 'manual';
}

export interface MarketplaceReleaseResponse {
  readonly statusCode?: number;
  readonly headers: Record<string, string | string[]>;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'aborted', listener: () => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  pause(): void;
  resume(): void;
}

export interface MarketplaceReleaseRequest {
  on(event: 'redirect', listener: (
    statusCode: number,
    method: string,
    redirectUrl: string,
    responseHeaders: Record<string, string[]>,
  ) => void): unknown;
  on(event: 'response', listener: (response: MarketplaceReleaseResponse) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'abort', listener: () => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  followRedirect(): void;
  abort(): void;
  end(): unknown;
}

export interface MarketplaceReleaseRequestFactory {
  request(options: MarketplaceReleaseRequestOptions): MarketplaceReleaseRequest;
}

export interface MarketplaceReleaseDownloadOptions {
  readonly signal?: AbortSignal;
  readonly maximumBytes?: number;
  readonly maximumRedirects?: number;
}

export interface MarketplaceReleaseFetcherConfig {
  readonly maximumBytes?: number;
  readonly maximumRedirects?: number;
}

/**
 * Creates the narrowly scoped request function used for GitHub release assets.
 *
 * Electron's `net.fetch` does not expose each redirect before it is followed and
 * documents its response URL as incorrect. `net.request` with manual redirects
 * lets this adapter validate every destination synchronously before following it.
 */
export function createMarketplaceReleaseFetcher(
  net: Pick<Net, 'request'>,
  config: MarketplaceReleaseFetcherConfig = {},
): (url: string, init?: Pick<RequestInit, 'signal'>) => Promise<Response> {
  const requestFactory: MarketplaceReleaseRequestFactory = {
    request: options => net.request(options as ClientRequestConstructorOptions) as unknown as MarketplaceReleaseRequest,
  };
  return (url, init) => fetchMarketplaceReleaseAsset(url, requestFactory, {
    signal: init?.signal ?? undefined,
    ...config,
  });
}

export async function fetchMarketplaceReleaseAsset(
  url: string,
  requestFactory: MarketplaceReleaseRequestFactory,
  options: MarketplaceReleaseDownloadOptions = {},
): Promise<Response> {
  const maximumBytes = normalizePositiveLimit(options.maximumBytes, defaultMaximumBytes);
  const maximumRedirects = normalizeNonNegativeLimit(options.maximumRedirects, defaultMaximumRedirects);
  const initialUrl = validateDownloadUrl(url, true);
  throwIfAborted(options.signal);

  return new Promise<Response>((resolve, reject) => {
    let request: MarketplaceReleaseRequest | undefined;
    let responseStarted = false;
    let settled = false;
    let requestAborted = false;
    let streamClosed = false;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let closeResponseBody = () => {};
    let currentUrl = initialUrl;
    let redirectCount = 0;
    let onAbort = () => {};
    const removeAbortListener = () => {
      options.signal?.removeEventListener('abort', onAbort);
    };

    const cancelled = () => new MarketplaceReleaseDownloadError(
      'cancelled',
      'The plugin release asset download was cancelled.',
    );
    const requestFailed = () => new MarketplaceReleaseDownloadError(
      'request-failed',
      'The plugin release asset could not be downloaded.',
    );
    const responseFailed = () => new MarketplaceReleaseDownloadError(
      'response-failed',
      'The plugin release response was invalid.',
    );
    const streamFailed = () => new MarketplaceReleaseDownloadError(
      'stream-failed',
      'The plugin release asset could not be read.',
    );

    const abortRequest = () => {
      if (requestAborted) {
        return;
      }
      requestAborted = true;
      removeAbortListener();
      try {
        request?.abort();
      }
      catch {
        // The request may already be closed.
      }
    };

    const rejectBeforeResponse = (error: MarketplaceReleaseDownloadError) => {
      if (settled) {
        return;
      }
      settled = true;
      removeAbortListener();
      abortRequest();
      reject(error);
    };

    const failBody = (error: MarketplaceReleaseDownloadError) => {
      if (streamClosed) {
        return;
      }
      streamClosed = true;
      closeResponseBody();
      abortRequest();
      try {
        streamController?.error(error);
      }
      catch {
        // The consumer may have already cancelled or closed the stream.
      }
    };

    onAbort = () => {
      if (!responseStarted) {
        rejectBeforeResponse(cancelled());
        return;
      }
      failBody(cancelled());
    };

    if (options.signal?.aborted) {
      rejectBeforeResponse(cancelled());
      return;
    }

    try {
      request = requestFactory.request({
        url: currentUrl.href,
        method: 'GET',
        headers: { Accept: 'application/octet-stream' },
        credentials: 'omit',
        useSessionCookies: false,
        redirect: 'manual',
      });
      request.on('redirect', (_statusCode, _method, redirectUrl) => {
        if (settled || streamClosed) {
          return;
        }
        if (redirectCount >= maximumRedirects) {
          rejectBeforeResponse(new MarketplaceReleaseDownloadError(
            'redirect-limit',
            'The plugin release asset used too many redirects.',
          ));
          return;
        }
        let nextUrl: URL;
        try {
          nextUrl = validateDownloadUrl(redirectUrl, false, currentUrl);
        }
        catch (error) {
          const safeError = error instanceof MarketplaceReleaseDownloadError
            ? error
            : new MarketplaceReleaseDownloadError(
              'redirect-rejected',
              'The plugin release asset redirected to an unapproved destination.',
            );
          rejectBeforeResponse(safeError);
          return;
        }
        currentUrl = nextUrl;
        redirectCount += 1;
        try {
          // Electron requires this call synchronously from the redirect event.
          request?.followRedirect();
        }
        catch {
          rejectBeforeResponse(requestFailed());
        }
      });
      request.on('response', (incomingResponse) => {
        responseStarted = true;
        const statusCode = incomingResponse.statusCode;
        if (
          statusCode === undefined
          || !Number.isInteger(statusCode)
          || statusCode < 200
          || statusCode > 599
        ) {
          listenForResponseErrors(incomingResponse);
          rejectBeforeResponse(responseFailed());
          return;
        }
        const parsedContentLength = parseContentLength(incomingResponse.headers);
        if (!parsedContentLength.valid) {
          listenForResponseErrors(incomingResponse);
          rejectBeforeResponse(responseFailed());
          return;
        }
        const headers = toSafeHeaders(incomingResponse.headers);
        const contentLength = parsedContentLength.length;
        if (contentLength !== undefined && contentLength > maximumBytes) {
          listenForResponseErrors(incomingResponse);
          rejectBeforeResponse(new MarketplaceReleaseDownloadError(
            'too-large',
            'The plugin release asset exceeds the download size limit.',
          ));
          return;
        }
        if (statusCode === 304) {
          listenForResponseErrors(incomingResponse);
          rejectBeforeResponse(responseFailed());
          return;
        }
        if (statusCode === 204 || statusCode === 205) {
          drainResponse(incomingResponse);
          settled = true;
          streamClosed = true;
          removeAbortListener();
          resolve(new Response(null, { status: statusCode, headers }));
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          drainResponse(incomingResponse);
          settled = true;
          streamClosed = true;
          removeAbortListener();
          resolve(new Response(null, { status: statusCode, headers }));
          return;
        }

        const body = createResponseBody(
          incomingResponse,
          maximumBytes,
          () => {
            streamClosed = true;
            removeAbortListener();
            abortRequest();
          },
          controller => {
            streamController = controller;
          },
          closeBody => { closeResponseBody = closeBody; },
          () => {
            streamClosed = true;
            removeAbortListener();
          },
          failBody,
        );
        settled = true;
        resolve(new Response(body, { status: statusCode, headers }));
      });
      request.on('error', () => {
        if (responseStarted) {
          failBody(streamFailed());
          return;
        }
        rejectBeforeResponse(requestFailed());
      });
      request.on('abort', () => {
        if (responseStarted && !streamClosed) {
          failBody(options.signal?.aborted ? cancelled() : streamFailed());
        }
        else if (!responseStarted && !settled) {
          rejectBeforeResponse(options.signal?.aborted ? cancelled() : requestFailed());
        }
      });
      request.on('close', () => {
        if (responseStarted && !streamClosed) {
          failBody(streamFailed());
        }
        // Electron can emit close after the upload finishes but before a redirect or response.
      });
      options.signal?.addEventListener('abort', onAbort, { once: true });
      request.end();
    }
    catch {
      rejectBeforeResponse(requestFailed());
    }
  });
}

function createResponseBody(
  response: MarketplaceReleaseResponse,
  maximumBytes: number,
  onCancel: () => void,
  onController: (controller: ReadableStreamDefaultController<Uint8Array>) => void,
  onCloseBody: (closeBody: () => void) => void,
  onComplete: () => void,
  onFailure: (error: MarketplaceReleaseDownloadError) => void,
): ReadableStream<Uint8Array> {
  let bytes = 0;
  let closed = false;
  response.pause();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      onController(controller);
      onCloseBody(() => { closed = true; });
      response.on('end', () => {
        if (closed) {
          return;
        }
        closed = true;
        controller.close();
        onComplete();
      });
      response.on('data', chunk => {
        if (closed) {
          return;
        }
        if (!(chunk instanceof Uint8Array)) {
          closed = true;
          onFailure(new MarketplaceReleaseDownloadError(
            'stream-failed',
            'The plugin release asset returned an invalid response body.',
          ));
          return;
        }
        bytes += chunk.byteLength;
        if (bytes > maximumBytes) {
          closed = true;
          onFailure(new MarketplaceReleaseDownloadError(
            'too-large',
            'The plugin release asset exceeds the download size limit.',
          ));
          return;
        }
        controller.enqueue(new Uint8Array(chunk));
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          response.pause();
        }
      });
      response.on('close', () => {
        if (!closed) {
          closed = true;
          onFailure(new MarketplaceReleaseDownloadError(
            'stream-failed',
            'The plugin release response closed before the download completed.',
          ));
        }
      });
      response.on('aborted', () => {
        if (!closed) {
          closed = true;
          onFailure(new MarketplaceReleaseDownloadError(
            'stream-failed',
            'The plugin release asset was cancelled by the network.',
          ));
        }
      });
      response.on('error', () => {
        if (!closed) {
          closed = true;
          onFailure(new MarketplaceReleaseDownloadError(
            'stream-failed',
            'The plugin release asset could not be read.',
          ));
        }
      });
    },
    pull() {
      if (!closed) {
        response.resume();
      }
    },
    cancel() {
      if (!closed) {
        closed = true;
        onCancel();
      }
    },
  });
  return body;
}

function parseContentLength(
  headers: Record<string, string | string[]>,
): { readonly valid: true; readonly length?: number } | { readonly valid: false } {
  const entries = Object.entries(headers).filter(([name]) => name.toLowerCase() === 'content-length');
  if (entries.length === 0) {
    return { valid: true };
  }
  if (entries.length !== 1) {
    return { valid: false };
  }
  const rawValue = entries[0]![1];
  if (Array.isArray(rawValue) && rawValue.length !== 1) {
    return { valid: false };
  }
  const value = (Array.isArray(rawValue) ? rawValue[0] : rawValue)?.trim();
  if (!value || !/^\d+$/.test(value)) {
    return { valid: false };
  }
  const length = Number(value);
  return Number.isSafeInteger(length) ? { valid: true, length } : { valid: false };
}

function drainResponse(response: MarketplaceReleaseResponse): void {
  listenForResponseErrors(response);
  try {
    response.resume();
  }
  catch {
    // Preserve the HTTP status when the connection has already closed.
  }
}

function listenForResponseErrors(response: MarketplaceReleaseResponse): void {
  response.on('error', () => {
    // Response errors are reported through the request's sanitized error path.
  });
}

function validateDownloadUrl(value: string, initial: boolean, base?: URL): URL {
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  }
  catch {
    throw new MarketplaceReleaseDownloadError(
      initial ? 'invalid-url' : 'redirect-rejected',
      initial
        ? 'The plugin release asset URL is invalid.'
        : 'The plugin release asset redirected to an unapproved destination.',
    );
  }
  if (
    parsed.protocol !== 'https:'
    || !githubDownloadHosts.has(parsed.hostname.toLowerCase())
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.hash
    || (parsed.hostname.toLowerCase() === 'github.com' && parsed.search)
  ) {
    throw new MarketplaceReleaseDownloadError(
      initial ? 'invalid-url' : 'redirect-rejected',
      initial
        ? 'The plugin release asset URL is not an approved HTTPS URL.'
        : 'The plugin release asset redirected to an unapproved destination.',
    );
  }
  return parsed;
}

function toSafeHeaders(input: Record<string, string | string[]>): Headers {
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(input)) {
    if (!safeResponseHeaders.has(name.toLowerCase())) {
      continue;
    }
    const value = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
    try {
      headers.set(name, value);
    }
    catch {
      // Skip malformed headers instead of exposing or propagating them.
    }
  }
  return headers;
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeNonNegativeLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new MarketplaceReleaseDownloadError(
      'cancelled',
      'The plugin release asset download was cancelled.',
    );
  }
}
