import { ipcMain, net } from 'electron';
import type {
  ApiBridgeResult,
  ApiResponse,
  ApiResponseHeader,
  ApiRequestInput,
} from '../../src/shared/desktop-services/api';
import {
  API_MAX_RESPONSE_BYTES,
  API_MAX_RESPONSE_HEADERS,
} from '../../src/shared/desktop-services/api';
import { isTrustedDesktopSender } from '../plugin-ipc-security';
import { parseApiRequest, parseApiRequestId } from './api-protocol';

const REQUEST_CHANNEL = 'desktop:api:request';
const CANCEL_CHANNEL = 'desktop:api:cancel';

interface ApiIpcDependencies {
  trustedRendererUrl: () => string;
}

interface ActiveRequest {
  rendererId: number;
  controller: AbortController;
  reason: 'cancelled' | 'timeout' | null;
  timer: NodeJS.Timeout;
}

/** Performs bounded HTTP requests in the main process and owns cancellation by renderer. */
export function registerApiIpc(dependencies: ApiIpcDependencies) {
  const activeRequests = new Map<string, ActiveRequest>();

  ipcMain.handle(REQUEST_CHANNEL, async (event, value: unknown): Promise<ApiBridgeResult<ApiResponse>> => {
    if (!isTrustedDesktopSender(event, dependencies.trustedRendererUrl())) {
      return { ok: false, error: 'untrusted-renderer' };
    }
    const input = parseApiRequest(value);
    if (!input) {
      return { ok: false, error: 'invalid-request' };
    }
    const key = requestKey(event.sender.id, input.requestId);
    if (activeRequests.has(key)) {
      return { ok: false, error: 'invalid-request' };
    }

    const controller = new AbortController();
    const active: ActiveRequest = {
      rendererId: event.sender.id,
      controller,
      reason: null,
      timer: setTimeout(() => {
        active.reason = 'timeout';
        controller.abort();
      }, input.timeoutMs),
    };
    activeRequests.set(key, active);
    const startedAt = Date.now();
    try {
      const response = await net.fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body ?? undefined,
        redirect: 'follow',
        signal: controller.signal,
      });
      const result = await readResponse(input, response, startedAt, controller.signal);
      return { ok: true, value: result };
    }
    catch {
      if (active.reason === 'timeout') {
        return { ok: false, error: 'timeout' };
      }
      if (active.reason === 'cancelled') {
        return { ok: false, error: 'cancelled' };
      }
      return { ok: false, error: 'network-error' };
    }
    finally {
      clearTimeout(active.timer);
      activeRequests.delete(key);
    }
  });

  ipcMain.handle(CANCEL_CHANNEL, (event, value: unknown): ApiBridgeResult<boolean> => {
    if (!isTrustedDesktopSender(event, dependencies.trustedRendererUrl())) {
      return { ok: false, error: 'untrusted-renderer' };
    }
    const requestId = parseApiRequestId(value);
    if (!requestId) {
      return { ok: false, error: 'invalid-request' };
    }
    const active = activeRequests.get(requestKey(event.sender.id, requestId));
    if (!active) {
      return { ok: true, value: false };
    }
    active.reason = 'cancelled';
    active.controller.abort();
    return { ok: true, value: true };
  });

  return {
    closeRenderer(rendererId: number): void {
      for (const [key, active] of activeRequests) {
        if (active.rendererId === rendererId) {
          active.reason = 'cancelled';
          active.controller.abort();
          activeRequests.delete(key);
        }
      }
    },
    shutdown(): void {
      for (const active of activeRequests.values()) {
        active.reason = 'cancelled';
        active.controller.abort();
        clearTimeout(active.timer);
      }
      activeRequests.clear();
      ipcMain.removeHandler(REQUEST_CHANNEL);
      ipcMain.removeHandler(CANCEL_CHANNEL);
    },
  };
}

async function readResponse(
  input: ApiRequestInput,
  response: Response,
  startedAt: number,
  signal: AbortSignal,
): Promise<ApiResponse> {
  const headers = [...response.headers.entries()]
    .slice(0, API_MAX_RESPONSE_HEADERS)
    .map(([name, value]): ApiResponseHeader => ({ name, value }));
  const content = await readResponseBody(response, signal);
  return {
    requestId: input.requestId,
    status: response.status,
    statusText: response.statusText,
    url: response.url || input.url,
    headers,
    body: content.body,
    truncated: content.truncated,
    elapsedMs: Math.max(0, Date.now() - startedAt),
  };
}

async function readResponseBody(response: Response, signal: AbortSignal): Promise<{ body: string; truncated: boolean }> {
  if (!response.body) {
    return { body: '', truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;
  try {
    while (true) {
      if (signal.aborted) {
        throw new DOMException('The API request was cancelled.', 'AbortError');
      }
      const result = await reader.read();
      if (result.done) {
        break;
      }
      const value = result.value;
      const remaining = API_MAX_RESPONSE_BYTES - totalBytes;
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining));
        totalBytes += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  }
  finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(bytes), truncated };
}

function requestKey(rendererId: number, requestId: string): string {
  return `${rendererId}:${requestId}`;
}
