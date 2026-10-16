import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  electronApp = await _electron.launch({
    args: ['--no-sandbox', '.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });
  page = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp?.close();
});

test('starts the shared application on the secure local app origin', async () => {
  await expect(page).toHaveURL('app://bundle/');
  await expect(page).toHaveTitle(/IT Tools/i);

  const state = await page.evaluate(async () => ({
    secureContext: window.isSecureContext,
    node: typeof process,
    require: typeof require,
    workerControlled: Boolean(navigator.serviceWorker?.controller),
    runtime: await window.itToolsDesktop.getRuntimeInfo(),
    contentSecurityPolicy: (await fetch('/')).headers.get('content-security-policy'),
  }));

  expect(state.secureContext).toBe(true);
  expect(state.node).toBe('undefined');
  expect(state.require).toBe('undefined');
  expect(state.workerControlled).toBe(false);
  expect(state.runtime.platform).toBeTruthy();
  expect(state.runtime.version).toBeTruthy();
  expect(state.contentSecurityPolicy).toContain("script-src 'self'");
});

test('serves a shared tool route after a direct deep-link load', async () => {
  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder('Type to search a tool or a command...');
  await search.fill('json minify');
  await search.press('Enter');
  await expect(page).toHaveURL('app://bundle/json-minify');
  await page.reload();
  await expect(page).toHaveURL('app://bundle/json-minify');
  await expect(page.locator('#app')).not.toBeEmpty();
});

test('keeps the Markdown print window isolated with Node disabled', async () => {
  await page.getByRole('button', { name: /Search/ }).click();
  const search = page.getByPlaceholder('Type to search a tool or a command...');
  await search.fill('markdown to html');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/markdown-to-html$/);

  // Prevent Chromium's print dialog from blocking the renderer during this smoke test.
  await page.evaluate(() => {
    const originalOpen = window.open;
    window.open = ((...args: Parameters<typeof window.open>) => {
      const popup = originalOpen.apply(window, args);
      if (popup) {
        Object.defineProperty(popup, 'print', { value: () => {}, configurable: true });
      }
      return popup;
    }) as typeof window.open;
  });

  const popupPromise = electronApp.waitForEvent('window');
  await page.getByRole('button', { name: 'Print as PDF' }).click();
  const popup = await popupPromise;

  const popupState = await popup.evaluate(() => ({
    node: typeof process,
    require: typeof require,
    bridge: typeof window.itToolsDesktop,
  }));
  expect(popupState).toEqual({ node: 'undefined', require: 'undefined', bridge: 'object' });
  await popup.close();
});
