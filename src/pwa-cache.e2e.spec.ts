import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type Page } from '@playwright/test';

type StaticSite = { url: string; disconnect: () => void; hideAsset: (file: string) => void };

// A real network cutoff avoids engine-specific setOffline behavior and HTTP-cache false positives.
const test = base.extend<{ staticSite: StaticSite }>({
  staticSite: async ({}, use) => {
    const directory = fileURLToPath(new URL('../dist/', import.meta.url));
    const deployment = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>
    };
    const headers = Object.fromEntries(deployment.headers.flatMap(rule => rule.headers.map(header => [header.key, header.value])));
    const mime: Record<string, string> = {
      '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
      '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
      '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
    };
    const missingAssets = new Set<string>();
    let online = true;
    const server = createServer(async (request, response) => {
      if (!online) {
        request.destroy();
        return;
      }
      if (request.method !== 'GET') {
        response.writeHead(405, { ...headers, 'Cache-Control': 'no-store' }).end();
        return;
      }
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      let file = resolve(directory, `.${path}`);
      if (!file.startsWith(`${directory.replace(/[\\/]$/, '')}${sep}`) || path.endsWith('/') || missingAssets.has(path.slice(1))) {
        file = resolve(directory, 'index.html');
      }
      let content: Buffer;
      try {
        content = await readFile(file);
      }
      catch {
        file = resolve(directory, 'index.html');
        content = await readFile(file);
      }
      response.writeHead(200, { ...headers, 'Content-Type': mime[extname(file)] ?? 'text/plain', 'Cache-Control': 'no-store' });
      response.end(content);
    });
    await new Promise<void>((resolveReady, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveReady);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('The PWA acceptance server did not bind a TCP port.');
    }
    try {
      await use({
        url: `http://127.0.0.1:${address.port}`,
        disconnect() {
          online = false;
          server.closeAllConnections();
        },
        hideAsset(file) {
          missingAssets.add(file);
        },
      });
    }
    finally {
      await new Promise<void>((resolveClosed) => {
        server.close(() => resolveClosed());
        server.closeAllConnections();
      });
    }
  },
  baseURL: async ({ staticSite }, use) => use(staticSite.url),
});

const report = JSON.parse(readFileSync(new URL('../dist/bundle-report.json', import.meta.url), 'utf8')) as {
  precache: { bytes: number; files: Array<{ file: string }> }
};
const manifest = JSON.parse(readFileSync(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')) as Record<string, { file: string; name?: string; isDynamicEntry?: boolean }>;
const shellFiles = new Set(report.precache.files.map(file => `/${file.file}`));
function toolEntry(name: string) {
  const entry = manifest[`src/tools/${name}/${name}.vue`] ?? Object.values(manifest).find(entry => entry.isDynamicEntry && entry.name === name);
  if (!entry) {
    throw new Error(`No built entry found for ${name}.`);
  }
  return entry.file;
}
const macEntry = toolEntry('mac-address-lookup');
const diffEntry = toolEntry('text-diff');
const jsonEntry = toolEntry('json-minify');

declare global {
  interface Window {
    __pwaWorkerAudit: { replies: number }
  }
}

test.describe('Production PWA caching', () => {
  test.setTimeout(60_000);

  async function startWithControlledHome(page: Page) {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'All the tools' })).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
      }
    });
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/sw\.js$/);
  }

  async function cacheContents(page: Page, runtimeOnly = false) {
    return page.evaluate(async (runtimeOnly) => {
      const names = (await caches.keys()).filter(name => !runtimeOnly || name.startsWith('it-tools-assets-'));
      return (await Promise.all(names.map(async (name) => {
        const cache = await caches.open(name);
        return (await cache.keys()).map(request => request.url);
      }))).flat().sort();
    }, runtimeOnly);
  }

  async function expectToolCached(page: Page, file: string) {
    await expect.poll(async () => (await cacheContents(page, true)).map(url => new URL(url).pathname))
      .toContain(`/${file}`);
  }

  test('first install caches only the shell; home reloads offline without downloading heavy tools', async ({ page, context, staticSite }) => {
    const requested: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    context.on('request', request => requested.push(new URL(request.url()).pathname));
    await startWithControlledHome(page);
    await page.waitForLoadState('load');

    expect(requested).not.toContain(`/${macEntry}`);
    expect(requested).not.toContain(`/${diffEntry}`);
    expect(requested.some(path => /(?:editor|ts)\.worker[^/]*\.js$/.test(path))).toBe(false);
    expect([...new Set((await cacheContents(page)).map(url => new URL(url).pathname))].sort())
      .toEqual([...shellFiles].sort());
    expect(report.precache.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);

    staticSite.disconnect();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'All the tools' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('an online visit makes JSON minify work after an offline deep-link reload', async ({ page, staticSite }) => {
    await startWithControlledHome(page);
    await page.goto('/json-minify');
    await page.getByLabel('Your raw JSON').fill('{ "online": true, "count": 42 }');
    await expect(page.getByTestId('area-content')).toHaveText('{"online":true,"count":42}');
    await expectToolCached(page, jsonEntry);

    staticSite.disconnect();
    await page.reload();
    await page.getByLabel('Your raw JSON').fill('{ "offline": [1, 2, 3] }');
    await expect(page.getByTestId('area-content')).toHaveText('{"offline":[1,2,3]}');
    expect((await cacheContents(page)).some(url => new URL(url).pathname === '/json-minify')).toBe(false);
  });

  test('MAC vendor data is available after online use and an offline reload', async ({ page, staticSite }) => {
    await startWithControlledHome(page);
    await page.goto('/mac-address-lookup');
    const input = page.getByLabel('MAC address:');
    await expect(input).toBeVisible();
    await input.fill('20:37:06:12:34:56');
    const tool = page.locator('.tool-content');
    await expect(tool).not.toContainText('Unknown vendor for this address');
    const onlineVendor = await tool.locator('.c-card').innerText();
    await expectToolCached(page, macEntry);

    staticSite.disconnect();
    await page.reload();
    await page.getByLabel('MAC address:').fill('20-37-06-AA-BB-CC');
    await expect(tool.locator('.c-card')).toHaveText(onlineVendor, { useInnerText: true });
    await page.getByLabel('MAC address:').fill('FF:FF:FF:FF:FF:FF');
    await expect(tool).toContainText('Unknown vendor for this address');
  });

  test('Text Diff loads its worker and computes changes again after an offline reload', async ({ page, staticSite }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => {
      const audit = { replies: 0 };
      Object.assign(window, { __pwaWorkerAudit: audit });
      window.Worker = new Proxy(window.Worker, {
        construct(target, args, newTarget) {
          const worker = Reflect.construct(target, args, newTarget) as Worker;
          worker.addEventListener('message', () => { audit.replies++; });
          return worker;
        },
      });
    });
    await startWithControlledHome(page);
    await page.goto('/text-diff');

    const original = page.locator('.monaco-editor.original-in-monaco-diff-editor');
    const modified = page.locator('.monaco-editor.modified-in-monaco-diff-editor');
    const workerReplies = () => page.evaluate(() => window.__pwaWorkerAudit.replies);
    await expect(original).toBeVisible();
    await expect(modified).toBeVisible();
    await expect.poll(workerReplies).toBeGreaterThan(0);
    await expectToolCached(page, diffEntry);
    await expect.poll(async () => (await cacheContents(page, true)).some(url => /editor\.worker[^/]*\.js$/.test(url))).toBe(true);

    staticSite.disconnect();
    await page.reload();
    await expect(original).toBeVisible();
    await expect(modified).toBeVisible();
    await expect.poll(workerReplies).toBeGreaterThan(0);
    const selectAll = await page.evaluate(() => navigator.userAgent.includes('Macintosh') ? 'Meta+A' : 'Control+A');
    await modified.getByText('modified text', { exact: true }).click();
    await page.keyboard.press(selectAll);
    await page.keyboard.insertText('offline diff result');
    await expect(modified.locator('.view-lines')).toContainText('offline diff result');
    await expect.poll(() => page.locator('.monaco-diff-editor .line-insert, .monaco-diff-editor .char-insert').count()).toBeGreaterThan(0);
  });

  test('runtime cache excludes query strings, page URLs and unknown assets; uncached offline requests fail', async ({ page, staticSite }) => {
    await startWithControlledHome(page);
    await page.evaluate(async (file) => {
      await fetch(`/${file}?private=pwa-test-fixture`);
      await fetch('/json-minify?input=pwa-test-fixture');
      await fetch('/api/private?token=pwa-test-fixture');
      await fetch('/assets/not-in-this-build-12345678.js');
      await fetch(`/${file}`, { method: 'POST', body: 'pwa-test-fixture' });
    }, jsonEntry);
    expect(await cacheContents(page, true)).toEqual([]);
    expect((await cacheContents(page)).some(url => url.includes('pwa-test-fixture'))).toBe(false);

    // A known build URL returning the host's HTML fallback must not poison the static cache.
    staticSite.hideAsset(jsonEntry);
    expect(await page.evaluate(async file => (await fetch(`/${file}`)).headers.get('content-type'), jsonEntry)).toBe('text/html');
    expect(await cacheContents(page, true)).toEqual([]);

    staticSite.disconnect();
    expect(await page.evaluate(async (file) => {
      try {
        await fetch(`/${file}`);
        return 'unexpected success';
      }
      catch {
        return 'network failure';
      }
    }, jsonEntry)).toBe('network failure');
    expect(await cacheContents(page, true)).toEqual([]);
  });

  test('activation removes previous build runtime caches and preserves unrelated caches', async ({ page }) => {
    await page.goto('/robots.txt');
    await page.evaluate(async () => {
      const old = await caches.open(`it-tools-assets-${encodeURIComponent(new URL('/', location.href).href)}-previous-build`);
      await old.put('/assets/old-build.js', new Response('old build'));
      // The previous generateSW build used Workbox's default precache name for this scope.
      const oldShell = await caches.open(`workbox-precache-v2-${new URL('/', location.href).href}`);
      await oldShell.put('/assets/old-precached-tool.js', new Response('old precached tool'));
      await caches.open('unrelated-cache');
      await caches.open('it-tools-assets-another-scope-previous-build');
    });
    await startWithControlledHome(page);
    const previousName = await page.evaluate(() => `it-tools-assets-${encodeURIComponent(new URL('/', location.href).href)}-previous-build`);
    await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain(previousName);
    expect(await page.evaluate(() => caches.keys())).toContain('unrelated-cache');
    expect(await page.evaluate(() => caches.keys())).toContain('it-tools-assets-another-scope-previous-build');
    expect((await cacheContents(page)).some(url => url.endsWith('/assets/old-precached-tool.js'))).toBe(false);
  });
});
