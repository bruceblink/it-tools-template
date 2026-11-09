import { expect, test } from '@playwright/test';

test('plugin marketplace lists repositories and opens manifest reference details', async ({ page }) => {
  const apiRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('request', request => {
    if (request.url().includes('api.github.com')) {
      apiRequests.push(request.url());
    }
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('https://api.github.com/search/repositories**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total_count: 1,
        incomplete_results: false,
        items: [{
          id: 42,
          full_name: 'example/demo-plugin',
          name: 'demo-plugin',
          owner: { login: 'example' },
          html_url: 'https://github.com/example/demo-plugin',
          description: 'A demo plugin',
          topics: ['it-tools-plugin', 'demo'],
          language: 'TypeScript',
          license: { spdx_id: 'MIT' },
          stargazers_count: 7,
          forks_count: 2,
          open_issues_count: 0,
          updated_at: '2026-01-01T00:00:00Z',
          pushed_at: '2026-01-01T00:00:00Z',
          default_branch: 'main',
          archived: false,
          disabled: false,
        }],
      }),
    });
  });

  await page.route('https://api.github.com/repos/example/demo-plugin/contents/plugin.source.json**', async route => {
    const manifest = {
      formatVersion: 1,
      id: 'example/demo-plugin',
      name: 'Demo plugin',
      version: '1.0.0',
      apiVersion: { minInclusive: '1.4.0', maxExclusive: '2.0.0' },
      entrypoint: 'index.html',
      requestedCapabilities: ['runtime.info'],
      contributions: { tools: [] },
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(JSON.stringify(manifest)).toString('base64'),
      }),
    });
  });

  await page.goto('/plugin-marketplace');
  await expect(page.getByRole('heading', { name: 'Plugin marketplace' })).toBeVisible();
  await expect(page.getByText('demo-plugin', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByText('Demo plugin · 1.0.0', { exact: true })).toBeVisible();
  await expect(page.getByText('runtime.info', { exact: true })).toBeVisible();

  expect(apiRequests).toHaveLength(2);
  expect(apiRequests.every(url => !url.includes('.itxs'))).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('desktop marketplace can install a repository release through the host bridge', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      itToolsDesktop: {
        buildPluginSource: async () => ({ ok: false, error: { code: 'source-build-cancelled' } }),
        installPluginFromMarketplace: async () => ({
          ok: true,
          value: {
            snapshot: {
              pluginId: 'org.example.demo',
              name: 'Demo plugin',
              version: '1.0.0',
            },
            source: {
              repository: 'example/demo-plugin',
              tagName: 'v1.0.0',
              commitSha: 'a'.repeat(40),
              assetName: 'demo.itxs',
              assetUrl: 'https://github.com/example/demo-plugin/releases/download/v1.0.0/demo.itxs',
              archiveBytes: 128,
              sha256: 'b'.repeat(64),
            },
          },
        }),
      },
    });
  });
  await page.route('https://api.github.com/search/repositories**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total_count: 1,
        incomplete_results: false,
        items: [{
          id: 42,
          full_name: 'example/demo-plugin',
          name: 'demo-plugin',
          owner: { login: 'example' },
          html_url: 'https://github.com/example/demo-plugin',
          description: 'A demo plugin',
          topics: ['it-tools-plugin'],
          language: 'TypeScript',
          license: { spdx_id: 'MIT' },
          stargazers_count: 7,
          forks_count: 2,
          open_issues_count: 0,
          updated_at: '2026-01-01T00:00:00Z',
          pushed_at: '2026-01-01T00:00:00Z',
          default_branch: 'main',
          archived: false,
          disabled: false,
        }],
      }),
    });
  });

  await page.goto('/plugin-marketplace');
  const repositoryCard = page.getByTestId('plugin-repository-42');
  await expect(repositoryCard.getByRole('button', { name: 'Install latest release' })).toBeVisible();
  await repositoryCard.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByRole('link', { name: 'Build from a fixed commit' })).toHaveAttribute(
    'href',
    '/settings?pluginOwner=example&pluginName=demo-plugin',
  );
  await page.getByRole('button', { name: 'Close plugin details' }).click();
  await repositoryCard.getByRole('button', { name: 'Install latest release' }).click();
  await expect(page.getByText('Installed Demo plugin 1.0.0 from release v1.0.0.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open plugin settings' })).toHaveAttribute('href', '/settings');
});
