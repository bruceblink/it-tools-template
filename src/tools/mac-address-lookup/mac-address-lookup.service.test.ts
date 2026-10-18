import { describe, expect, it, vi } from 'vitest';
import { createOuiVendorLookup, OuiDataUnavailableError } from './mac-address-lookup.service';

const shard = {
  prefix: '2',
  file: 'oui-2-0123456789abcdef.json',
  sha256: '0123456789abcdef'.repeat(4),
  recordCount: 3,
  rawBytes: 100,
  gzipBytes: 80,
};
const manifest = {
  schemaVersion: 1,
  dataVersion: '1.2.0',
  recordCount: 3,
  shards: [shard],
};
const records = {
  '203706': 'MA-L vendor',
  '2037061': 'MA-M vendor',
  '203706123': 'MA-S vendor',
};

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('MAC address OUI lookup service', () => {
  it('loads one shard and returns the longest matching registry prefix', async () => {
    const fetchResource = vi.fn(async (url: RequestInfo | URL) => response(String(url).endsWith('manifest.json') ? manifest : records));
    const lookup = createOuiVendorLookup(fetchResource as typeof fetch, '/assets/oui-data/');

    await expect(lookup.findVendor('20:37:06:12:34:56')).resolves.toBe('MA-S vendor');
    await expect(lookup.findVendor('20-37-06-1A-BC-DE')).resolves.toBe('MA-M vendor');
    await expect(lookup.findVendor('20:37:06:AA:BB:CC')).resolves.toBe('MA-L vendor');
    expect(fetchResource).toHaveBeenCalledTimes(2);
    expect(fetchResource.mock.calls.map(([url]) => String(url))).toEqual([
      '/assets/oui-data/manifest.json',
      `/assets/oui-data/${shard.file}`,
    ]);
  });

  it('does not fetch data for partial or malformed addresses', async () => {
    const fetchResource = vi.fn();
    const lookup = createOuiVendorLookup(fetchResource as typeof fetch, '/assets/oui-data/');

    await expect(lookup.findVendor('20:37:06')).resolves.toBeUndefined();
    await expect(lookup.findVendor('2x:37:06:12:34:56')).resolves.toBeUndefined();
    expect(fetchResource).not.toHaveBeenCalled();
  });

  it('aborts pending shard requests when the caller cancels the lookup', async () => {
    const controller = new AbortController();
    const addAbortListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeAbortListener = vi.spyOn(controller.signal, 'removeEventListener');
    let requestSignal: AbortSignal | undefined;
    const fetchResource = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal ?? undefined;
      requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const lookup = createOuiVendorLookup(fetchResource as typeof fetch, '/assets/oui-data/');
    const request = lookup.findVendor('20:37:06:12:34:56', controller.signal);
    controller.abort();

    await expect(request).rejects.toBeInstanceOf(OuiDataUnavailableError);
    expect(requestSignal?.aborted).toBe(true);
    const abortRegistration = addAbortListener.mock.calls.find(([type]) => type === 'abort');
    expect(abortRegistration?.[1]).toEqual(expect.any(Function));
    expect(removeAbortListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
  });

  it('deduplicates concurrent manifest and shard requests', async () => {
    let resolveManifest: ((value: Response) => void) | undefined;
    const fetchResource = vi.fn((url: RequestInfo | URL) => new Promise<Response>((resolve) => {
      if (String(url).endsWith('manifest.json')) {
        resolveManifest = resolve;
      }
      else {
        resolve(response(records));
      }
    }));
    const lookup = createOuiVendorLookup(fetchResource as typeof fetch, '/assets/oui-data/');
    const first = lookup.findVendor('20:37:06:12:34:56');
    const second = lookup.findVendor('20:37:06:12:34:56');
    resolveManifest?.(response(manifest));

    await expect(Promise.all([first, second])).resolves.toEqual(['MA-S vendor', 'MA-S vendor']);
    expect(fetchResource).toHaveBeenCalledTimes(2);
  });

  it('allows a failed request to retry and rejects unsafe manifest file names', async () => {
    const fetchResource = vi.fn()
      .mockResolvedValueOnce(response(manifest, 503))
      .mockResolvedValueOnce(response({ ...manifest, shards: [{ ...shard, file: '../outside.json' }] }))
      .mockResolvedValueOnce(response(manifest))
      .mockResolvedValueOnce(response(records));
    const lookup = createOuiVendorLookup(fetchResource as typeof fetch, '/assets/oui-data/');

    await expect(lookup.findVendor('20:37:06:12:34:56')).rejects.toBeInstanceOf(OuiDataUnavailableError);
    await expect(lookup.findVendor('20:37:06:12:34:56')).rejects.toBeInstanceOf(OuiDataUnavailableError);
    await expect(lookup.findVendor('20:37:06:12:34:56')).resolves.toBe('MA-S vendor');
    expect(fetchResource).toHaveBeenCalledTimes(4);
  });

  it('rejects shard responses whose entry count or prefixes do not match the manifest', async () => {
    const fetchResource = vi.fn(async (url: RequestInfo | URL) => response(
      String(url).endsWith('manifest.json') ? manifest : { 'not-an-oui': 'Invalid vendor' },
    ));
    const lookup = createOuiVendorLookup(fetchResource as typeof fetch, '/assets/oui-data/');

    await expect(lookup.findVendor('20:37:06:12:34:56')).rejects.toBeInstanceOf(OuiDataUnavailableError);
  });
});
