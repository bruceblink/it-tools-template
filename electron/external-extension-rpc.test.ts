import { describe, expect, it, vi } from 'vitest';
import {
  ExternalExtensionRpcError,
  ExternalExtensionRpcHost,
  createInProcessExternalExtensionRpcTransport,
} from './external-extension-rpc';
import {
  parseExternalExtensionRpcRequest,
  parseExternalExtensionRpcResponse,
  type ExternalExtensionRpcRequest,
} from '../src/shared/desktop-services/external-extension-rpc';

const pluginId = 'org.it-tools.rpc-demo';

describe('external extension RPC protocol', () => {
  it('accepts only bounded, namespaced requests', () => {
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-1',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/summarize`,
        input: { text: 'hello' },
        requiredCapabilities: [],
      },
    })).toMatchObject({ method: 'executeCommand', pluginId });
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-1',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: 'other-plugin/summarize',
        input: null,
        requiredCapabilities: [],
      },
    })).toBeNull();
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-1',
      pluginId,
      method: 'readData',
      payload: { providerId: `${pluginId}/provider` },
    })).toMatchObject({
      method: 'readData',
      payload: { providerId: `${pluginId}/provider` },
    });
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-1',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/summarize`,
        input: null,
        requiredCapabilities: [],
        extra: true,
      },
    })).toBeNull();
  });

  it('rejects response errors and unknown response fields', () => {
    expect(parseExternalExtensionRpcResponse({
      protocolVersion: 1,
      requestId: 'request-1',
      pluginId,
      ok: false,
      error: 'permission-denied',
    })).toEqual({
      protocolVersion: 1,
      requestId: 'request-1',
      pluginId,
      ok: false,
      error: 'permission-denied',
    });
    expect(parseExternalExtensionRpcResponse({
      protocolVersion: 1,
      requestId: 'request-1',
      pluginId,
      ok: true,
      result: { done: true },
      extra: true,
    })).toBeNull();
    expect(parseExternalExtensionRpcResponse({
      protocolVersion: 1,
      requestId: 'request-1',
      pluginId,
      ok: true,
    })).toMatchObject({ ok: true });
  });
});

describe('ExternalExtensionRpcHost', () => {
  it('activates and executes a structured command through the transport', async () => {
    const methods: string[] = [];
    const transport = createInProcessExternalExtensionRpcTransport(async (request) => {
      methods.push(request.method);
      if (request.method === 'activate') {
        return { protocolVersion: 1, requestId: request.requestId, pluginId, ok: true, result: null };
      }
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        pluginId,
        ok: true,
        result: request.method === 'executeCommand' ? { value: request.payload.input } : null,
      };
    });
    const host = new ExternalExtensionRpcHost({ pluginId, version: '1.0.0', transport });

    await host.activate();
    await expect(host.executeCommand(`${pluginId}/summarize`, { text: 'hello' })).resolves.toEqual({
      value: { text: 'hello' },
    });
    expect(methods).toEqual(['activate', 'executeCommand']);
    await host.dispose();
  });

  it('checks grants before sending a command', async () => {
    const send = vi.fn(async () => ({
      protocolVersion: 1,
      requestId: 'request-1',
      pluginId,
      ok: true as const,
      result: null,
    }));
    const transport = {
      send,
      dispose: vi.fn(),
    };
    const host = new ExternalExtensionRpcHost({ pluginId, version: '1.0.0', transport });
    await expect(host.activate()).rejects.toMatchObject({ code: 'transport-error' });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(host.executeCommand(`${pluginId}/copy`, 'text', ['clipboard.write']))
      .rejects.toMatchObject({ code: 'not-active' });
  });

  it('returns stable timeout and cancellation errors', async () => {
    let resolveHandler: (() => void) | undefined;
    const transport = createInProcessExternalExtensionRpcTransport(async (request) => {
      if (request.method === 'activate') {
        return { protocolVersion: 1, requestId: request.requestId, pluginId, ok: true, result: null };
      }
      await new Promise<void>(resolve => { resolveHandler = resolve; });
      return { protocolVersion: 1, requestId: request.requestId, pluginId, ok: true, result: true };
    });
    const host = new ExternalExtensionRpcHost({ pluginId, version: '1.0.0', transport, timeoutMs: 10 });
    await host.activate();
    await expect(host.executeCommand(`${pluginId}/slow`, null)).rejects.toMatchObject({ code: 'timeout' });
    resolveHandler?.();

    const controller = new AbortController();
    const cancelled = host.executeCommand(`${pluginId}/cancel`, null, [], controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(ExternalExtensionRpcError);
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
    await host.dispose();
  });

  it('cancels activation while the transport request is pending', async () => {
    const transport = {
      send(_request: ExternalExtensionRpcRequest, signal: AbortSignal) {
        return new Promise<unknown>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
      cancel: vi.fn(),
      dispose: vi.fn(),
    };
    const host = new ExternalExtensionRpcHost({ pluginId, version: '1.0.0', transport });
    const controller = new AbortController();
    const activation = host.activate(controller.signal);
    controller.abort();

    await expect(activation).rejects.toMatchObject({ code: 'cancelled' });
    await host.dispose();
  });
});
