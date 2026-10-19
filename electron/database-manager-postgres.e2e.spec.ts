import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const postgresPort = Number(process.env.IT_TOOLS_TEST_POSTGRES_PORT);
let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test.describe('Database manager - PostgreSQL metadata browsing', () => {
  test.skip(!Number.isInteger(postgresPort) || postgresPort < 1 || postgresPort > 65_535, 'Requires an isolated local PostgreSQL test container.');

  test.beforeAll(async () => {
    userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-postgres-e2e-'));
    electronApp = await _electron.launch({
      args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      timeout: 60_000,
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('load');
  });

  test.afterAll(async () => {
    try {
      await electronApp?.close();
    }
    finally {
      if (userDataDirectory) {
        await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      }
    }
  });

  test('connects over an explicitly unencrypted local socket and reads table structure', async () => {
    await page.getByRole('link', { name: 'Database manager', exact: true }).click();
    await expect(page.locator('[data-test-id="database-manager-workspace"]')).toBeVisible();
    await page.locator('[data-test-id="postgres-port-field"] input').fill(String(postgresPort));
    await page.locator('[data-test-id="postgres-tls-mode"] .n-base-selection').click();
    await page.getByText('Disable TLS for a trusted local connection', { exact: true }).click();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(page.getByText(/Connected to PostgreSQL/)).toBeVisible();
    await expect(page.getByText('s2a_structure_probe (table)', { exact: true })).toBeVisible();
    await expect(page.getByText('probe_id', { exact: true })).toBeVisible();
    await expect(page.getByText('probe_value', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  });
});
