import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const fixtureName = process.env.IT_TOOLS_TEST_CONTAINER_NAME ?? '';
const fixtureImageId = process.env.IT_TOOLS_TEST_CONTAINER_IMAGE ?? '';
let electronApp: ElectronApplication | undefined;
let userDataDirectory = '';

test.skip(!fixtureName || !fixtureImageId, 'requires a temporary container in the local Docker daemon');

test('lists bounded local container metadata and fits a narrow viewport', async () => {
  test.setTimeout(120_000);
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-container-workbench-e2e-'));
  const bootstrap = join(userDataDirectory, 'bootstrap.cjs');
  await writeFile(
    bootstrap,
    [
      "const { app } = require('electron');",
      `app.setName(${JSON.stringify(basename(userDataDirectory))});`,
      `app.setPath('userData', ${JSON.stringify(userDataDirectory)});`,
      `app.setAppPath(${JSON.stringify(process.cwd())});`,
      `require(${JSON.stringify(resolve('out/main/main.cjs'))});`,
    ].join('\n'),
    'utf8',
  );
  electronApp = await _electron.launch({
    args: ['--no-sandbox', bootstrap],
    env: {
      ...process.env,
      APPDATA: userDataDirectory,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      IT_TOOLS_HEADLESS_E2E: 'true',
    },
    timeout: 60_000,
  });
  const page = await electronApp.firstWindow();
  expect(await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(window => window.isVisible()),
  )).toBe(false);
  await page.waitForLoadState('load');
  await expect(page.getByRole('button', { name: /Search/i })).toBeVisible({ timeout: 60_000 });
  await page.goto('app://bundle/container-workbench');
  await expect(page.getByTestId('container-workspace')).toBeVisible();
  await page.getByTestId('container-refresh').click();

  const row = page.getByTestId('container-row').filter({ hasText: fixtureName });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('running');
  await expect(row).toContainText(fixtureImageId);
  const visibleData = await row.innerText();
  expect(visibleData).toContain(fixtureName);
  expect(visibleData).not.toContain('RUSTFS_SECRET_KEY');

  await page.getByTestId('container-filter').locator('input').fill('not-a-container-name');
  await expect(page.getByTestId('container-empty')).toBeVisible();
  await page.getByTestId('container-filter').locator('input').fill(fixtureName);
  await expect(page.getByTestId('container-row')).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await page.screenshot({ path: test.info().outputPath('container-workbench-narrow.png'), animations: 'disabled' });
});

test.afterEach(async () => {
  await electronApp?.close().catch(() => {});
  electronApp = undefined;
  if (userDataDirectory) {
    await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    userDataDirectory = '';
  }
});
