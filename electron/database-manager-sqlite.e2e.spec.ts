import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sqliteFilePath = process.env.IT_TOOLS_TEST_SQLITE_FILE;
let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test.describe('Database manager - SQLite browsing', () => {
  test.skip(!sqliteFilePath, 'Requires an isolated local SQLite fixture file.');

  test.beforeAll(async () => {
    userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-sqlite-e2e-'));
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

  test('opens a user-selected file read-only and browses its structure', async () => {
    await page.getByRole('link', { name: 'Database manager', exact: true }).click();
    await expect(page.locator('[data-test-id="database-manager-workspace"]')).toBeVisible();
    await page.locator('[data-test-id="database-engine-select"] .n-base-selection').click();
    await page.locator('.n-base-select-option').filter({ hasText: 'SQLite' }).click();
    await expect(page.locator('[data-test-id="sqlite-read-only-notice"]')).toBeVisible();
    await expect(page.locator('[data-test-id="database-host-field"]')).toHaveCount(0);

    await setFileDialogResult({ canceled: true, filePaths: [] });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('[data-test-id="database-manager-workspace"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);

    await setFileDialogResult({ canceled: false, filePaths: [sqliteFilePath!] });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByText(/Connected to SQLite 3\./)).toBeVisible();
    await expect(page.locator('[data-test-id="database-table-select"]')).toContainText('s3_sqlite_probe (table)');
    await page.locator('[data-test-id="database-table-select"] .n-base-selection').click();
    await page.locator('.n-base-select-option').filter({ hasText: 's3_sqlite_probe (table)' }).click();
    const tableTabs = page.locator('.database-manager-browser .n-tabs-tab');
    await expect(tableTabs.filter({ hasText: /^Structure$/ })).toHaveCount(1);
    await expect(tableTabs.filter({ hasText: /^Data$/ })).toHaveCount(0);
    const indexTable = page.locator('[data-test-id="database-index-table"]');
    await expect(indexTable).toContainText('uq_s3_sqlite_username');
    await expect(page.locator('.database-manager-browser .n-data-table').first()).toContainText('username');

    await page.locator('[data-test-id="database-sql-editor"] textarea').fill('SELECT 1 AS value');
    await page.getByRole('button', { name: 'Run query', exact: true }).click();
    const queryResults = page.locator('[data-test-id="database-sql-results"]');
    await expect(queryResults).toContainText('1');
    await expect(page.locator('[data-test-id="database-sql-page-summary"]')).toContainText('1 row');

    await page.locator('[data-test-id="database-sql-editor"] textarea').fill(
      'WITH RECURSIVE valueset(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM valueset WHERE value < 26) SELECT value FROM valueset ORDER BY value',
    );
    await page.getByRole('button', { name: 'Run query', exact: true }).click();
    await expect(queryResults.locator('tbody tr')).toHaveCount(25);
    await expect(page.locator('[data-test-id="database-sql-page-summary"]')).toContainText('25 rows');
    await page.locator('[data-test-id="database-sql-next-page"]').click();
    await expect(queryResults).toContainText('26');
    await expect(page.locator('[data-test-id="database-sql-page-summary"]')).toContainText('Page 2 · 1 row');

    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  });
});

async function setFileDialogResult(result: { canceled: boolean; filePaths: string[] }): Promise<void> {
  await electronApp.evaluate(({ dialog }, nextResult) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => nextResult,
    });
  }, result);
}
