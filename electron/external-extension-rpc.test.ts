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
      requestId: 'request-runtime-info',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/runtime-info`,
        input: {},
        requiredCapabilities: ['runtime.info'],
        capabilityContext: { runtimeInfo: { platform: 'darwin', appVersion: '1.0.0' } },
      },
    })).toMatchObject({
      method: 'executeCommand',
      payload: { requiredCapabilities: ['runtime.info'] },
    });
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-runtime-info-missing',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/runtime-info`,
        input: {},
        requiredCapabilities: ['runtime.info'],
      },
    })).toBeNull();
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-settings-foreign-namespace',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/settings`,
        input: {},
        requiredCapabilities: ['settings.read'],
        capabilityContext: { settings: { 'org.example.other/endpoint': true } },
      },
    })).toBeNull();
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-settings',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/settings`,
        input: {},
        requiredCapabilities: ['settings.read'],
        capabilityContext: { settings: { [`${pluginId}/endpoint`]: 'https://example.test' } },
      },
    })).toMatchObject({
      method: 'executeCommand',
      payload: { requiredCapabilities: ['settings.read'] },
    });
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-runtime-settings',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/runtime-settings`,
        input: {},
        requiredCapabilities: ['runtime.info', 'settings.read'],
        capabilityContext: {
          runtimeInfo: { platform: 'darwin', appVersion: '1.0.0' },
          settings: { [`${pluginId}/endpoint`]: 'https://example.test' },
        },
      },
    })).toMatchObject({
      method: 'executeCommand',
      payload: { requiredCapabilities: ['runtime.info', 'settings.read'] },
    });
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-settings-missing',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/settings`,
        input: {},
        requiredCapabilities: ['settings.read'],
      },
    })).toBeNull();
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-settings-extra',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/settings`,
        input: {},
        requiredCapabilities: [],
        capabilityContext: { settings: { [`${pluginId}/endpoint`]: 'https://example.test' } },
      },
    })).toBeNull();
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-settings-invalid-key',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/settings`,
        input: {},
        requiredCapabilities: ['settings.read'],
        capabilityContext: { settings: { invalid: true } },
      },
    })).toBeNull();
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-settings-too-many',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/settings`,
        input: {},
        requiredCapabilities: ['settings.read'],
        capabilityContext: {
          settings: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`${pluginId}/setting-${index}`, true])),
        },
      },
    })).toBeNull();
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-runtime-info-extra',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/runtime-info`,
        input: {},
        requiredCapabilities: [],
        capabilityContext: { runtimeInfo: { platform: 'darwin', appVersion: '1.0.0' } },
      },
    })).toBeNull();
    // 上下文限制平台白名单、版本长度和字段集合，避免借可选 JSON 扩大暴露面。
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-runtime-info-oversized',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/runtime-info`,
        input: {},
        requiredCapabilities: ['runtime.info'],
        capabilityContext: { runtimeInfo: { platform: 'darwin', appVersion: 'x'.repeat(65) } },
      },
    })).toBeNull();
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-runtime-info-unknown-platform',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/runtime-info`,
        input: {},
        requiredCapabilities: ['runtime.info'],
        capabilityContext: { runtimeInfo: { platform: 'unknown', appVersion: '1.0.0' } },
      },
    })).toBeNull();
    expect(parseExternalExtensionRpcRequest({
      protocolVersion: 1,
      requestId: 'request-runtime-info-extra-field',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/runtime-info`,
        input: {},
        requiredCapabilities: ['runtime.info'],
        capabilityContext: { runtimeInfo: { platform: 'darwin', appVersion: '1.0.0', executablePath: '/app' } },
      },
    })).toBeNull();
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

  // 只有获得只读能力本次授权的主进程调用方可以附带上下文。
  it('sends runtime and settings context only with matching one-command grants', async () => {
    const requests: ExternalExtensionRpcRequest[] = [];
    const transport = createInProcessExternalExtensionRpcTransport(request => {
      requests.push(request);
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        pluginId,
        ok: true,
        result: null,
      };
    });
    const host = new ExternalExtensionRpcHost({
      pluginId,
      version: '1.0.0',
      grantedCapabilities: ['runtime.info'],
      transport,
    });
    const capabilityContext = { runtimeInfo: { platform: 'darwin' as const, appVersion: '1.0.0' } };

    await host.activate();
    await host.executeCommand(`${pluginId}/runtime-info`, {}, ['runtime.info'], undefined, capabilityContext);
    await host.dispose();

    expect(requests.find(request => request.method === 'executeCommand')).toMatchObject({
      payload: {
        requiredCapabilities: ['runtime.info'],
        capabilityContext,
      },
    });

    const settingsHost = new ExternalExtensionRpcHost({
      pluginId,
      version: '1.0.0',
      grantedCapabilities: ['settings.read'],
      transport: createInProcessExternalExtensionRpcTransport(request => {
        requests.push(request);
        return {
          protocolVersion: 1,
          requestId: request.requestId,
          pluginId,
          ok: true,
          result: null,
        };
      }),
    });
    const settingsContext = { settings: { [`${pluginId}/endpoint`]: 'https://example.test' } };
    await settingsHost.activate();
    await settingsHost.executeCommand(`${pluginId}/settings`, {}, ['settings.read'], undefined, settingsContext);
    await settingsHost.dispose();

    expect(requests.find(request => request.method === 'executeCommand' && request.payload.requiredCapabilities[0] === 'settings.read')).toMatchObject({
      payload: {
        requiredCapabilities: ['settings.read'],
        capabilityContext: settingsContext,
      },
    });
  });

  it('does not construct a v2 host with capabilities outside the read-only v2 set', () => {
    expect(() => new ExternalExtensionRpcHost({
      pluginId,
      version: '1.0.0',
      grantedCapabilities: ['clipboard.write'],
      transport: { send: vi.fn(), dispose: vi.fn() },
    })).toThrowError(expect.objectContaining<Partial<ExternalExtensionRpcError>>({ code: 'permission-denied' }));
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
