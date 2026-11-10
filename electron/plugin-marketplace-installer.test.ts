// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  readonly repositoryUrl?: string;
  readonly repository?: PluginMarketplaceRepositoryInput;
  readonly omitContentLength?: boolean;
  readonly topics?: readonly string[];
  readonly assets?: readonly Record<string, unknown>[];
  readonly commit?: string;
}) {
  const selectedRepository = options.repository ?? repository;
  const assetUrl = options.assetUrl
    ?? `https://github.com/${selectedRepository.owner}/${selectedRepository.name}/releases/download/v1.0.0/demo.itxs`;
  const digest = createHash('sha256').update(options.asset).digest('hex');
  const calls: string[] = [];
  const fetcher = async (url: string, _init?: RequestInit): Promise<Response> => {
    calls.push(url);
    if (url.endsWith(`/repos/${selectedRepository.owner}/${selectedRepository.name}`)) {
      return new Response(JSON.stringify({
        full_name: `${selectedRepository.owner}/${selectedRepository.name}`,
        html_url: options.repositoryUrl ?? `https://github.com/${selectedRepository.owner}/${selectedRepository.name}`,
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
          name: 'demo.itxs',
          browser_download_url: assetUrl,
          size: options.asset.byteLength,
          digest: `sha256:${digest}`,
        }],
      }), { status: 200 });
    }
    if (url.endsWith(`/commits/v1.0.0`)) {
      return new Response(JSON.stringify({ sha: options.commit ?? commitSha }), { status: 200 });
    }
    if (url === assetUrl) {
      const response = new Response(Buffer.from(options.asset), {
        status: 200,
        headers: options.omitContentLength ? undefined : { 'content-length': String(options.asset.byteLength) },
      });
      return response;
    }
    return new Response('not found', { status: 404 });
  };
  return { fetcher, fetchReleaseAsset: fetcher, calls };
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
    let installedSource: unknown;
    const result = await installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      fetchReleaseAsset: fetcher,
      installArchive: async (archivePath, source) => {
        installedPath = archivePath;
        installedSource = source;
        expect(await readFile(archivePath)).toEqual(Buffer.from(asset));
        return { pluginId: 'org.example.demo', version: '1.0.0' };
      },
    });

    expect(result.snapshot).toEqual({ pluginId: 'org.example.demo', version: '1.0.0' });
    expect(result.source).toMatchObject({
      repository: 'example/demo-plugin',
      tagName: 'v1.0.0',
      commitSha,
      assetName: 'demo.itxs',
      archiveBytes: asset.byteLength,
    });
    expect(result.source.sha256).toBe(createHash('sha256').update(asset).digest('hex'));
    expect(installedSource).toEqual(result.source);
    expect(calls).toEqual([
      'https://api.github.com/repos/example/demo-plugin',
      'https://api.github.com/repos/example/demo-plugin/releases/latest',
      'https://api.github.com/repos/example/demo-plugin/commits/v1.0.0',
      'https://github.com/example/demo-plugin/releases/download/v1.0.0/demo.itxs',
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
      fetchReleaseAsset: fetcher,
      installArchive: async () => ({ installed: true }),
    })).resolves.toMatchObject({
      source: { archiveBytes: asset.byteLength },
    });
  });

  it('accepts a valid single-character GitHub owner across repository validation', async () => {
    const tempRoot = await createTempRoot();
    const shortOwnerRepository = { owner: 'A', name: 'demo-plugin' } as const;
    const asset = new Uint8Array([80, 75, 3, 4]);
    const { fetcher } = createFetchMock({ asset, repository: shortOwnerRepository });

    await expect(installPluginMarketplaceRelease(shortOwnerRepository, {
      tempRoot,
      fetch: fetcher,
      fetchReleaseAsset: fetcher,
      installArchive: async () => ({ installed: true }),
    })).resolves.toMatchObject({
      source: { repository: 'A/demo-plugin' },
    });
  });

  it('cleans the temporary archive when the normal installer rejects it', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({ asset: new Uint8Array([1, 2, 3]) });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      fetchReleaseAsset: fetcher,
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
      fetchReleaseAsset: fetcher,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-invalid-repository' } satisfies Partial<PluginMarketplaceInstallError>);
  });

  it('rejects repository metadata that uses a non-standard port', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({
      asset: new Uint8Array([1]),
      repositoryUrl: 'https://github.com:8443/example/demo-plugin',
    });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      fetchReleaseAsset: fetcher,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-unavailable' });
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
      fetchReleaseAsset: fetcher,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-unavailable' });
  });

  it('rejects ambiguous or unapproved release assets before downloading', async () => {
    const tempRoot = await createTempRoot();
    const asset = new Uint8Array([1, 2, 3]);
    const { fetcher } = createFetchMock({
      asset,
      assets: [
        { name: 'one.itxs', browser_download_url: 'https://github.com/example/demo-plugin/releases/download/v1/one.itxs', size: 3 },
        { name: 'two.itxs', browser_download_url: 'https://github.com/example/demo-plugin/releases/download/v1/two.itxs', size: 3 },
      ],
    });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      fetchReleaseAsset: fetcher,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-release-not-found' });
  });

  it('rejects a changed commit identity and cleans failed downloads', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({ asset: new Uint8Array([1, 2]), commit: 'not-a-sha' });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      fetchReleaseAsset: fetcher,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-unavailable' });
    expect(await readdir(join(tempRoot))).toEqual([]);
  });

  it('reports a rejected download without exposing its temporary URL and cleans up', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({ asset: new Uint8Array([1, 2, 3]) });
    const secretUrl = 'https://release-assets.githubusercontent.com/asset?token=secret';
    const download = vi.fn(async () => {
      throw new Error(secretUrl);
    });
    let error: PluginMarketplaceInstallError | undefined;
    try {
      await installPluginMarketplaceRelease(repository, {
        tempRoot,
        fetch: fetcher,
        fetchReleaseAsset: download,
        installArchive: async () => ({}) as never,
      });
    }
    catch (caught) {
      error = caught as PluginMarketplaceInstallError;
    }
    expect(error).toMatchObject({ code: 'marketplace-download-failed' });
    expect(String(error)).not.toContain(secretUrl);
    expect(error?.cause).toBeUndefined();
    expect(download).toHaveBeenCalledOnce();
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('rejects a release asset URL with a query before downloading', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher, fetchReleaseAsset } = createFetchMock({
      asset: new Uint8Array([1]),
      assetUrl: 'https://github.com/example/demo-plugin/releases/download/v1.0.0/demo.itxs?token=secret',
    });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      fetchReleaseAsset,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-release-not-found' });
  });

  it('stops before network access when the installation signal is already aborted', async () => {
    const tempRoot = await createTempRoot();
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      signal: controller.signal,
      fetch: fetcher,
      fetchReleaseAsset: fetcher,
      installArchive: async () => ({ installed: true }),
    })).rejects.toMatchObject({ code: 'marketplace-cancelled' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a malformed package asset even when another package-looking asset exists', async () => {
    const tempRoot = await createTempRoot();
    const asset = new Uint8Array([1, 2, 3]);
    const { fetcher } = createFetchMock({
      asset,
      assets: [
        {
          name: 'demo.itxs',
          browser_download_url: 'https://github.com/example/demo-plugin/releases/download/v1.0.0/demo.itxs',
          size: 3,
        },
        {
          name: 'unbounded.itxs',
          browser_download_url: 'https://github.com/example/demo-plugin/releases/download/v1.0.0/unbounded.itxs',
          size: Number.MAX_SAFE_INTEGER,
        },
      ],
    });
    await expect(installPluginMarketplaceRelease(repository, {
      tempRoot,
      fetch: fetcher,
      fetchReleaseAsset: fetcher,
      installArchive: async () => ({}) as never,
    })).rejects.toMatchObject({ code: 'marketplace-release-not-found' });
  });
});
