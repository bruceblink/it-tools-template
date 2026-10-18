import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let electronApp: ElectronApplication;
let hostPage: Page;
let userDataDirectory: string;

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-sandbox-e2e-'));
  electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      IT_TOOLS_PLUGIN_SANDBOX_TEST: '1',
    },
    timeout: 60_000,
  });
  hostPage = await electronApp.firstWindow();
});

test.afterAll(async () => {
  try {
    const windows = electronApp?.windows() ?? [];
    await Promise.all(windows.map(window => window.close({ runBeforeUnload: false }).catch(() => undefined)));
    await electronApp?.close();
  }
  finally {
    if (userDataDirectory) {
      await rm(userDataDirectory, { recursive: true, force: true });
    }
  }
});

test('runs a first-party proof in a sandboxed, network-denied plugin renderer', async () => {
  const pluginOrigin = 'it-plugin://org.it-tools.sandbox-proof/';
  await expect.poll(async () => (await electronApp.windows()).some(candidate => candidate.url().startsWith(pluginOrigin))).toBe(true);
  const pluginPage = (await electronApp.windows()).find(candidate => candidate.url().startsWith(pluginOrigin));
  if (!pluginPage) {
    throw new Error('The plugin sandbox proof window did not open.');
  }

  await expect(pluginPage.locator('#sandbox-proof')).toHaveText('Sandbox fixture loaded');
  const capabilityToast = pluginPage.getByRole('status');
  await expect(capabilityToast).toBeVisible();
  await expect(capabilityToast).toHaveCSS('position', 'fixed');
  await expect(capabilityToast).toHaveCSS('border-radius', '14px');
  await expect(pluginPage.locator('#runtime-capability-proof')).toHaveText('Available');
  await expect(pluginPage.locator('#clipboard-capability-proof')).toHaveText('Not authorized');
  await pluginPage.getByRole('button', { name: 'Dismiss capability status' }).click();
  await expect(capabilityToast).toBeHidden();
  const response = await pluginPage.reload();
  const rendererState = await pluginPage.evaluate(() => ({
    origin: location.origin,
    secureContext: window.isSecureContext,
    node: typeof process,
    require: typeof require,
    preloadBridge: typeof window.itToolsDesktop,
  }));

  expect(rendererState.origin).toBe('it-plugin://org.it-tools.sandbox-proof');
  expect(rendererState.secureContext).toBe(true);
  expect(rendererState.node).toBe('undefined');
  expect(rendererState.require).toBe('undefined');
  expect(rendererState.preloadBridge).toBe('undefined');
  expect(response?.headers()['content-security-policy']).toContain("connect-src 'self'");
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");

  await hostPage.evaluate(() => localStorage.setItem('sandbox-origin-isolation', 'host'));
  await pluginPage.evaluate(() => localStorage.setItem('sandbox-origin-isolation', 'plugin'));
  await expect.poll(async () => hostPage.evaluate(() => localStorage.getItem('sandbox-origin-isolation'))).toBe('host');
  expect(await pluginPage.evaluate(() => localStorage.getItem('sandbox-origin-isolation'))).toBe('plugin');
  expect(await pluginPage.evaluate(() => window.open('https://example.invalid'))).toBeNull();

  let localServerRequests = 0;
  const server = createServer((_request, response) => {
    localServerRequests += 1;
    response.end('unexpected network access');
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });

  try {
    const fetchResult = await pluginPage.evaluate(async (url) => {
      try {
        await fetch(url);
        return 'allowed';
      }
      catch {
        return 'blocked';
      }
    }, `http://127.0.0.1:${port}/probe`);
    expect(fetchResult).toBe('blocked');
    expect(localServerRequests).toBe(0);
  }
  finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
