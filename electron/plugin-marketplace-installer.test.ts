// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installPluginMarketplaceRelease,
  PluginMarketplaceInstallError,
  type PluginMarketplaceRepositoryInput,
} from './plugin-marketplace-installer';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const repository: PluginMarketplaceRepositoryInput = { owner: 'example', name: 'demo-plugin' };
const commitSha = 'a'.repeat(40);

function createFetchMock(options: {
  readonly asset: Uint8Array;
  readonly assetUrl?: string;
  readonly responseUrl?: string;
  readonly omitContentLength?: boolean;
  readonly topics?: readonly string[];
  readonly assets?: readonly Record<string, unknown>[];
  readonly commit?: string;
}) {
  const assetUrl = options.assetUrl ?? 'https://github.com/example/demo-plugin/releases/download/v1.0.0/demo.itplugin';
  const digest = createHash('sha256').update(options.asset).digest('hex');
  const calls: string[] = [];
  const fetcher = async (url: string, _init?: RequestInit): Promise<Response> => {
    calls.push(url);
    if (url.endsWith('/repos/example/demo-plugin')) {
      return new Response(JSON.stringify({
        full_name: 'example/demo-plugin',
        html_url: 'https://github.com/example/demo-plugin',
        archived: false,
        disabled: false,
        fork: false,
        topics: options.topics ?? ['it-tools-plugin'],
      }), { status: 200 });
    }
    if (url.endsWith('/releases/latest')) {
      return new Response(JSON.stringify({
        tag_name: 'v1.0.0',
        assets: options.assets ?? [{
          name: 'demo.itplugin',
          browser_download_url: assetUrl,
          size: options.asset.byteLength,
          digest: `sha256:${digest}`,
        }],
      }), { status: 200 });
    }
    if (url.endsWith('/commits/v1.0.0')) {
      return new Response(JSON.stringify({ sha: options.commit ?? commitSha }), { status: 200 });
    }
    if (url === assetUrl) {
      const response = new Response(Buffer.from(options.asset), {
        status: 200,
        headers: options.omitContentLength ? undefined : { 'content-length': String(options.asset.byteLength) },
      });
      Object.defineProperty(response, 'url', { value: options.responseUrl ?? assetUrl });
      return response;
    }
    return new Response('not found', { status: 404 });
  };
  return { fetcher, calls };
}

async function createTempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-marketplace-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('GitHub release plugin installer', () => {
  it('pins repository and commit, downloads one bounded asset, and cleans the temp archive', async () => {
    const tempRoot = await createTempRoot();
    const asset = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    const { fetcher, calls } = createFetchMock({ asset });
    let installedPath = '';
    const result = await installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      installArchive: async (archivePath) => {
        installedPath = archivePath;
        expect(await readFile(archivePath)).toEqual(Buffer.from(asset));
        return { pluginId: 'org.example.demo', version: '1.0.0' };
      },
    });

    expect(result.snapshot).toEqual({ pluginId: 'org.example.demo', version: '1.0.0' });
    expect(result.source).toMatchObject({
      repository: 'example/demo-plugin',
      tagName: 'v1.0.0',
      commitSha,
      assetName: 'demo.itplugin',
      archiveBytes: asset.byteLength,
    });
    expect(result.source.sha256).toBe(createHash('sha256').update(asset).digest('hex'));
    expect(calls).toEqual([
      'https://api.github.com/repos/example/demo-plugin',
      'https://api.github.com/repos/example/demo-plugin/releases/latest',
      'https://api.github.com/repos/example/demo-plugin/commits/v1.0.0',
      'https://github.com/example/demo-plugin/releases/download/v1.0.0/demo.itplugin',
    ]);
    expect(installedPath).toContain('.it-tools-plugin-marketplace-');
    expect(await readdir(join(tempRoot))).toEqual([]);
  });

  it('accepts chunked GitHub downloads when content-length is omitted', async () => {
    const tempRoot = await createTempRoot();
    const asset = new Uint8Array([80, 75, 3, 4]);
    const { fetcher } = createFetchMock({ asset, omitContentLength: true });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      installArchive: async () => ({ installed: true }),
    })).resolves.toMatchObject({
      source: { archiveBytes: asset.byteLength },
    });
  });

  it('cleans the temporary archive when the normal installer rejects it', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({ asset: new Uint8Array([1, 2, 3]) });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      installArchive: async () => {
        throw new Error('package rejected');
      },
    })).rejects.toThrow('package rejected');
    expect(await readdir(join(tempRoot))).toEqual([]);
  });

  it('rejects repositories that are not registered plugin sources', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({ asset: new Uint8Array([1]), topics: ['utilities'] });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-invalid-repository' } satisfies Partial<PluginMarketplaceInstallError>);
  });

  it('bounds GitHub API responses even when content-length is absent', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({ asset: new Uint8Array([1]) });
    const fetchWithOversizedRepository = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.endsWith('/repos/example/demo-plugin')) {
        return new Response('x'.repeat(512 * 1024 + 1), { status: 200 });
      }
      return fetcher(url, init);
    };
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetchWithOversizedRepository,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-unavailable' });
  });

  it('rejects ambiguous or unapproved release assets before downloading', async () => {
    const tempRoot = await createTempRoot();
    const asset = new Uint8Array([1, 2, 3]);
    const { fetcher } = createFetchMock({
      asset,
      assets: [
        { name: 'one.itplugin', browser_download_url: 'https://github.com/example/demo-plugin/releases/download/v1/one.itplugin', size: 3 },
        { name: 'two.itplugin', browser_download_url: 'https://github.com/example/demo-plugin/releases/download/v1/two.itplugin', size: 3 },
      ],
    });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-release-not-found' });
  });

  it('rejects a changed commit identity and cleans failed downloads', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({ asset: new Uint8Array([1, 2]), commit: 'not-a-sha' });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-unavailable' });
    expect(await readdir(join(tempRoot))).toEqual([]);
  });

  it('rejects an asset redirected outside the GitHub download hosts', async () => {
    const tempRoot = await createTempRoot();
    const asset = new Uint8Array([1, 2, 3]);
    const externalUrl = 'https://evil.example/plugin.itplugin';
    const { fetcher } = createFetchMock({
      asset,
      responseUrl: externalUrl,
    });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-download-failed' });
    expect(await readdir(join(tempRoot))).toEqual([]);
  });

  it('rejects a malformed package asset even when another package-looking asset exists', async () => {
    const tempRoot = await createTempRoot();
    const asset = new Uint8Array([1, 2, 3]);
    const { fetcher } = createFetchMock({
      asset,
      assets: [
        {
          name: 'demo.itplugin',
          browser_download_url: 'https://github.com/example/demo-plugin/releases/download/v1.0.0/demo.itplugin',
          size: 3,
        },
        {
          name: 'unbounded.itplugin',
          browser_download_url: 'https://github.com/example/demo-plugin/releases/download/v1.0.0/unbounded.itplugin',
          size: Number.MAX_SAFE_INTEGER,
        },
      ],
    });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-release-not-found' });
  });
});
