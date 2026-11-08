// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginMarketplaceInstallController } from './plugin-marketplace-controller';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function createTempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-marketplace-controller-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('PluginMarketplaceInstallController', () => {
  it('allows only one active installation and cancels the matching request', async () => {
    const tempRoot = await createTempRoot();
    let releaseFetch!: () => void;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      await new Promise<void>((resolve, reject) => {
        releaseFetch = resolve;
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
      return new Response('{}', { status: 200 });
    });
    const controller = new PluginMarketplaceInstallController({
      tempRoot,
      fetch: fetcher,
      fetchReleaseAsset: fetcher,
      installArchive: async () => ({ installed: true }),
    });
    const progress: string[] = [];
    const first = controller.start(
      { requestId: 'request-1', owner: 'example', name: 'first' },
      event => progress.push(event.phase),
    );
    expect(() => controller.start(
      { requestId: 'request-2', owner: 'example', name: 'second' },
      () => {},
    )).toThrowError('Another plugin marketplace installation is already running.');
    expect(controller.cancel('request-2')).toBe(false);
    expect(controller.cancel('request-1')).toBe(true);
    await expect(first).rejects.toMatchObject({ code: 'marketplace-cancelled' });
    expect(progress).toEqual(['discovering', 'cancelled']);
    releaseFetch?.();
    expect(controller.cancel('request-1')).toBe(false);
  });

  it('waits for an active operation to stop during disposal', async () => {
    const tempRoot = await createTempRoot();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
      return new Response('{}', { status: 200 });
    });
    const controller = new PluginMarketplaceInstallController({
      tempRoot,
      fetch: fetcher,
      fetchReleaseAsset: fetcher,
      installArchive: async () => ({ installed: true }),
    });
    const first = controller.start(
      { requestId: 'request-dispose', owner: 'example', name: 'first' },
      () => {},
    );
    await controller.dispose();
    await expect(first).rejects.toMatchObject({ code: 'marketplace-cancelled' });
    expect(controller.cancel('request-dispose')).toBe(false);
  });
});
