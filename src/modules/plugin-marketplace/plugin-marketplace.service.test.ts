import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPluginSearchQuery,
  fetchPluginManifest,
  PluginMarketplaceApiError,
  searchPluginRepositories,
  supportsPluginMarketplaceDirectInstall,
  type PluginMarketplaceRepository,
} from './plugin-marketplace.service';

afterEach(() => {
  vi.unstubAllGlobals();
});

function repository(overrides: Partial<PluginMarketplaceRepository> = {}): PluginMarketplaceRepository {
  return {
    id: 1,
    fullName: 'example/demo-plugin',
    name: 'demo-plugin',
    ownerLogin: 'example',
    htmlUrl: 'https://github.com/example/demo-plugin',
    description: 'A demo plugin.',
    homepage: null,
    topics: ['it-tools-plugin', 'demo'],
    language: 'TypeScript',
    license: 'MIT',
    stars: 4,
    forks: 1,
    openIssues: 0,
    updatedAt: '2026-01-01T00:00:00Z',
    pushedAt: '2026-01-01T00:00:00Z',
    defaultBranch: 'main',
    archived: false,
    disabled: false,
    ...overrides,
  };
}

describe('plugin marketplace GitHub adapter', () => {
  it('only enables direct installation for the public GitHub API', () => {
    expect(supportsPluginMarketplaceDirectInstall('https://api.github.com')).toBe(true);
    expect(supportsPluginMarketplaceDirectInstall('https://api.github.com/')).toBe(true);
    expect(supportsPluginMarketplaceDirectInstall('https://api.github.com:8443')).toBe(false);
    expect(supportsPluginMarketplaceDirectInstall('https://api.github.com/enterprise')).toBe(false);
    expect(supportsPluginMarketplaceDirectInstall('https://marketplace-proxy.example')).toBe(false);
    expect(supportsPluginMarketplaceDirectInstall('http://api.github.com')).toBe(false);
    expect(supportsPluginMarketplaceDirectInstall('https://api.github.com/?token=secret')).toBe(false);
  });

  it('builds a bounded topic query with optional owner and search text', () => {
    expect(buildPluginSearchQuery('  json   parser  ', {
      topic: 'it-tools-plugin',
      owner: 'example',
    })).toBe('topic:it-tools-plugin archived:false fork:false user:example json parser');
  });

  it('normalizes repository search results and calculates pagination', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      total_count: 30,
      incomplete_results: false,
      items: [{
        id: 1,
        full_name: 'example/demo-plugin',
        name: 'demo-plugin',
        owner: { login: 'example' },
        html_url: 'https://github.com/example/demo-plugin',
        description: 'A demo plugin.',
        topics: ['it-tools-plugin', 'demo'],
        language: 'TypeScript',
        license: { spdx_id: 'MIT' },
        stargazers_count: 4,
        forks_count: 1,
        open_issues_count: 0,
        updated_at: '2026-01-01T00:00:00Z',
        pushed_at: '2026-01-01T00:00:00Z',
        default_branch: 'main',
        archived: false,
        disabled: false,
      }, {
        id: 'invalid',
        full_name: 'missing/required-fields',
      }, {
        id: 2,
        full_name: 'example/untrusted-link',
        name: 'untrusted-link',
        owner: { login: 'example' },
        html_url: 'javascript:alert(1)',
      }, {
        id: 3,
        full_name: 'example/http-link',
        name: 'http-link',
        owner: { login: 'example' },
        html_url: 'http://example.test/plugin',
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchPluginRepositories({ page: 1, perPage: 24, sort: 'stars' });

    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]?.fullName).toBe('example/demo-plugin');
    expect(result.totalCount).toBe(30);
    expect(result.hasNextPage).toBe(true);
    const request = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL] | undefined;
    const requestUrl = new URL(String(request?.[0] ?? ''));
    expect(requestUrl.pathname).toBe('/search/repositories');
    expect(requestUrl.searchParams.get('sort')).toBe('stars');
    expect(requestUrl.searchParams.get('q')).toContain('topic:it-tools-plugin');
  });

  it('reads a source manifest without downloading a plugin package', async () => {
    const manifest = {
      formatVersion: 1,
      id: 'example/demo-plugin',
      name: 'Demo plugin',
      version: '1.0.0',
      apiVersion: { minInclusive: '1.4.0', maxExclusive: '2.0.0' },
      entrypoint: 'index.html',
      requestedCapabilities: ['runtime.info'],
      contributions: {
        tools: [{
          id: 'example/demo-plugin/demo',
          title: 'Demo',
          description: 'A demo contribution.',
          capabilities: ['runtime.info'],
        }],
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      type: 'file',
      encoding: 'base64',
      content: btoa(JSON.stringify(manifest)),
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPluginManifest(repository(), undefined);

    expect(result?.id).toBe('example/demo-plugin');
    expect(result?.requestedCapabilities).toEqual(['runtime.info']);
    expect(result?.toolContributions[0]?.title).toBe('Demo');
    const request = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL] | undefined;
    const requestUrl = new URL(String(request?.[0] ?? ''));
    expect(requestUrl.pathname).toBe('/repos/example/demo-plugin/contents/plugin.source.json');
    expect(requestUrl.searchParams.get('ref')).toBe('main');
  });

  it('treats a missing source manifest as a normal directory result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', {
      status: 404,
      statusText: 'Not Found',
    })));

    await expect(fetchPluginManifest(repository())).resolves.toBeNull();
  });

  it('falls back to the v2 source manifest when the legacy manifest is absent', async () => {
    const manifest = {
      formatVersion: 2,
      id: 'example/demo-plugin',
      name: 'Demo plugin',
      version: '2.0.0',
      apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
      requestedCapabilities: ['runtime.info'],
      contributions: { tools: [] },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('missing', { status: 404, statusText: 'Not Found' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        type: 'file',
        encoding: 'base64',
        content: btoa(JSON.stringify(manifest)),
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPluginManifest(repository())).resolves.toMatchObject({
      formatVersion: 2,
      id: 'example/demo-plugin',
      requestedCapabilities: ['runtime.info'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/contents/plugin.manifest.json');
  });

  it('preserves API status and rate-limit information for the UI', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 120);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'rate limit' }), {
      status: 403,
      statusText: 'Forbidden',
      headers: { 'x-ratelimit-reset': reset },
    })));

    await expect(searchPluginRepositories()).rejects.toMatchObject({
      status: 403,
      rateLimitResetAt: expect.any(Date),
    } satisfies Partial<PluginMarketplaceApiError>);
  });
});
