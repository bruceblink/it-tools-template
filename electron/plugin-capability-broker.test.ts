// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createPluginCapabilityBroker,
  filterSupportedPluginCapabilities,
  PLUGIN_CAPABILITY_API_PATH,
  pluginCapabilityLimits,
} from './plugin-capability-broker';
import type { PluginCapabilityCall } from './plugin-capability-broker';

const pluginId = 'org.example.sample';
const pluginOrigin = `it-plugin://${pluginId}`;

describe('Electron plugin capability broker', () => {
  it('filters known package declarations to the capabilities supported by this host', () => {
    expect(filterSupportedPluginCapabilities([
      'file.read',
      'runtime.info',
      'device.camera',
      'settings.write',
    ])).toEqual(['runtime.info', 'settings.write']);
  });

  it('executes only a requested capability that the host granted', async () => {
    const execute = vi.fn(() => ({ platform: 'win32', version: '1.0.0' }));
    const broker = createPluginCapabilityBroker({
      pluginId,
      requestedCapabilities: ['runtime.info', 'clipboard.write'],
      grantedCapabilities: ['runtime.info'],
      execute,
    });

    const allowed = await broker.handle(makeRequest({
      id: 'runtime-1',
      capability: 'runtime.info',
      operation: 'read',
      input: {},
    }));
    await expect(allowed.json()).resolves.toEqual({
      id: 'runtime-1',
      ok: true,
      result: { platform: 'win32', version: '1.0.0' },
    });

    const denied = await broker.handle(makeRequest({
      id: 'clipboard-1',
      capability: 'clipboard.write',
      operation: 'writeText',
      input: { text: 'secret' },
    }));
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: 'permission-denied' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('parses settings read, write, and delete operations', async () => {
    const execute = vi.fn(async (call: PluginCapabilityCall) => {
      if (call.capability === 'settings.read') {
        return { found: true, value: 'saved' };
      }
      if (call.operation === 'set') {
        return { written: true };
      }
      return { deleted: true };
    });
    const broker = createPluginCapabilityBroker({
      pluginId,
      requestedCapabilities: ['settings.read', 'settings.write'],
      grantedCapabilities: ['settings.read', 'settings.write'],
      execute,
    });

    await expect(broker.handle(makeRequest({
      id: 'settings-read',
      capability: 'settings.read',
      operation: 'get',
      input: { key: 'demo-note' },
    }))).resolves.toMatchObject({ status: 200 });
    await expect(broker.handle(makeRequest({
      id: 'settings-write',
      capability: 'settings.write',
      operation: 'set',
      input: { key: 'demo-note', value: 'saved' },
    }))).resolves.toMatchObject({ status: 200 });
    await expect(broker.handle(makeRequest({
      id: 'settings-delete',
      capability: 'settings.write',
      operation: 'delete',
      input: { key: 'demo-note' },
    }))).resolves.toMatchObject({ status: 200 });
    expect(execute).toHaveBeenCalledTimes(3);

    expect((await broker.handle(makeRequest({
      id: 'settings-invalid',
      capability: 'settings.read',
      operation: 'get',
      input: { key: 'bad key' },
    }))).status).toBe(400);
  });

  it('rejects capabilities that the package did not request', async () => {
    const execute = vi.fn(() => ({ ok: true }));
    const broker = createPluginCapabilityBroker({
      pluginId,
      requestedCapabilities: ['runtime.info'],
      grantedCapabilities: ['runtime.info'],
      execute,
    });
    const response = await broker.handle(makeRequest({
      id: 'clipboard-2',
      capability: 'clipboard.write',
      operation: 'writeText',
      input: { text: 'hello' },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'capability-not-requested' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires the active plugin origin, exact endpoint, POST, and JSON', async () => {
    const broker = createPluginCapabilityBroker({
      pluginId,
      requestedCapabilities: ['runtime.info'],
      grantedCapabilities: ['runtime.info'],
      execute: () => ({ ok: true }),
    });

    expect((await broker.handle(makeRequest(validCall(), { initiatorOrigin: 'it-plugin://org.example.other' }))).status).toBe(403);
    expect((await broker.handle(makeRequest(validCall(), { origin: 'it-plugin://org.example.other' }))).status).toBe(403);
    expect((await broker.handle(makeRequest(validCall(), { url: `${pluginOrigin}/other` }))).status).toBe(404);
    expect((await broker.handle(makeRequest(validCall(), { method: 'GET', body: undefined }))).status).toBe(405);
    expect((await broker.handle(makeRequest(validCall(), { contentType: 'text/plain' }))).status).toBe(415);
  });

  it('rejects malformed, oversized, and unsupported capability messages', async () => {
    const broker = createPluginCapabilityBroker({
      pluginId,
      requestedCapabilities: ['runtime.info', 'clipboard.write'],
      grantedCapabilities: ['runtime.info', 'clipboard.write'],
      execute: () => ({ ok: true }),
    });

    expect((await broker.handle(makeRequest('{'))).status).toBe(400);
    expect((await broker.handle(makeRequest({ ...validCall(), extra: true }))).status).toBe(400);
    expect((await broker.handle(makeRequest({ ...validCall(), operation: 'openShell' }))).status).toBe(400);

    const oversized = await broker.handle(makeRequest({
      id: 'clipboard-large',
      capability: 'clipboard.write',
      operation: 'writeText',
      input: { text: 'x'.repeat(pluginCapabilityLimits.maximumRequestBytes) },
    }));
    expect(oversized.status).toBe(413);
  });

  it('bounds the complete serialized response envelope', async () => {
    const broker = createPluginCapabilityBroker({
      pluginId,
      requestedCapabilities: ['runtime.info'],
      grantedCapabilities: ['runtime.info'],
      execute: () => ({ data: 'x'.repeat(pluginCapabilityLimits.maximumResponseBytes - 40) }),
    });
    const response = await broker.handle(makeRequest(validCall('large-response')));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: 'response-too-large' });
  });

  it('limits request frequency and concurrent host operations', async () => {
    let currentTime = 10_000;
    const execute = vi.fn(() => ({ ok: true }));
    const broker = createPluginCapabilityBroker({
      pluginId,
      requestedCapabilities: ['runtime.info'],
      grantedCapabilities: ['runtime.info'],
      execute,
      now: () => currentTime,
    });

    const statuses: number[] = [];
    for (let index = 0; index < pluginCapabilityLimits.maximumRequestsPerMinute + 1; index += 1) {
      statuses.push((await broker.handle(makeRequest(validCall(index)))).status);
    }
    expect(statuses.at(-1)).toBe(429);
    expect(execute).toHaveBeenCalledTimes(pluginCapabilityLimits.maximumRequestsPerMinute);

    currentTime += 60_000;
    expect((await broker.handle(makeRequest(validCall('window-reset')))).status).toBe(200);

    const pending: Array<() => void> = [];
    const concurrentBroker = createPluginCapabilityBroker({
      pluginId,
      requestedCapabilities: ['runtime.info'],
      grantedCapabilities: ['runtime.info'],
      execute: () => new Promise((resolve) => {
        pending.push(() => resolve({ ok: true }));
      }),
    });
    const operations = Array.from(
      { length: pluginCapabilityLimits.maximumConcurrentRequests },
      (_, index) => concurrentBroker.handle(makeRequest(validCall(`concurrent-${index}`))),
    );
    await vi.waitFor(() => expect(pending).toHaveLength(pluginCapabilityLimits.maximumConcurrentRequests));
    expect((await concurrentBroker.handle(makeRequest(validCall('concurrent-rejected')))).status).toBe(429);
    pending.forEach(resolve => resolve());
    expect((await Promise.all(operations)).every(response => response.status === 200)).toBe(true);
  });

  it('revokes outstanding and future requests when the plugin is disabled', async () => {
    let finish!: (value: unknown) => void;
    const broker = createPluginCapabilityBroker({
      pluginId,
      requestedCapabilities: ['runtime.info'],
      grantedCapabilities: ['runtime.info'],
      execute: () => new Promise(resolve => finish = resolve),
    });
    const outstanding = broker.handle(makeRequest(validCall('in-flight')));
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    broker.revoke();
    finish({ platform: 'win32' });

    expect((await outstanding).status).toBe(410);
    expect((await broker.handle(makeRequest(validCall('after-disable')))).status).toBe(410);
  });
});

function validCall(id: string | number = 'request-1') {
  return { id: String(id), capability: 'runtime.info', operation: 'read', input: {} };
}

function makeRequest(
  body: unknown,
  overrides: {
    url?: string;
    method?: string;
    origin?: string;
    initiatorOrigin?: string | null;
    contentType?: string;
    body?: string | undefined;
  } = {},
): Request {
  const bodyValue = Object.hasOwn(overrides, 'body')
    ? overrides.body
    : typeof body === 'string' ? body : JSON.stringify(body);
  const request = new Request('https://example.test/call', {
    method: overrides.method ?? 'POST',
    headers: {
      origin: overrides.origin ?? pluginOrigin,
      'content-type': overrides.contentType ?? 'application/json',
    },
    ...(bodyValue === undefined ? {} : { body: bodyValue }),
  });
  Object.defineProperties(request, {
    url: { value: overrides.url ?? `${pluginOrigin}${PLUGIN_CAPABILITY_API_PATH}` },
    initiatorOrigin: { value: overrides.initiatorOrigin ?? pluginOrigin },
  });
  return request;
}
