import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { getPluginApiV1Script, pluginRendererApiVersion, pluginHostApiVersion } from './plugin-api-v1';

describe('plugin renderer API v1', () => {
  it('exposes frozen versioned methods and sends a bounded runtime capability request', async () => {
    const fetch = vi.fn(async (_input: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { id: string; capability: string; operation: string; input: unknown };
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: request.id, ok: true, result: { platform: 'win32', version: '1.2.0' } }),
      };
    });
    const context = { fetch };
    runInNewContext(getPluginApiV1Script(), context);

    const api = (context as unknown as { itTools: {
      apiVersion: string;
      hostApiVersion: string;
      capabilities: { runtime: { getInfo: () => Promise<unknown> } };
    } }).itTools;
    expect(api.apiVersion).toBe(pluginRendererApiVersion);
    expect(api.hostApiVersion).toBe(pluginHostApiVersion);
    expect(Object.isFrozen(api)).toBe(true);
    expect(await api.capabilities.runtime.getInfo()).toEqual({ platform: 'win32', version: '1.2.0' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/__it_tools/v1/call', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    }));
    const requestBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(requestBody).toMatchObject({ capability: 'runtime.info', operation: 'read', input: {} });
  });

  it('maps broker denial to a stable error and rejects oversized clipboard input locally', async () => {
    const fetch = vi.fn(async (_input: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { id: string };
      return {
        ok: false,
        status: 403,
        json: async () => ({ id: request.id, ok: false, error: 'permission-denied' }),
      };
    });
    const context = { fetch };
    runInNewContext(getPluginApiV1Script(), context);

    const api = (context as unknown as { itTools: {
      capabilities: { clipboard: { writeText: (text: string) => Promise<unknown> } };
    } }).itTools;
    await expect(api.capabilities.clipboard.writeText('not granted')).rejects.toMatchObject({
      name: 'PluginApiError',
      code: 'permission-denied',
      status: 403,
    });
    expect(fetch).toHaveBeenCalledOnce();

    await expect(api.capabilities.clipboard.writeText('x'.repeat(16_385))).rejects.toMatchObject({
      name: 'PluginApiError',
      code: 'invalid-input',
      status: 0,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects an existing global and malformed responses', async () => {
    const occupiedContext = { fetch: vi.fn(), itTools: {} };
    expect(() => runInNewContext(getPluginApiV1Script(), occupiedContext)).toThrow(/already defined/);

    const context = {
      fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })),
    };
    runInNewContext(getPluginApiV1Script(), context);
    const api = (context as unknown as { itTools: {
      capabilities: { runtime: { getInfo: () => Promise<unknown> } };
    } }).itTools;
    await expect(api.capabilities.runtime.getInfo()).rejects.toMatchObject({
      name: 'PluginApiError',
      code: 'invalid-response',
      status: 200,
    });
  });
});
