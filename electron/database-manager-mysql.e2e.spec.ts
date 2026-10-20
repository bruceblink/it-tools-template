import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mysqlPort = Number(process.env.IT_TOOLS_TEST_MYSQL_PORT);
const mysqlPassword = process.env.IT_TOOLS_TEST_MYSQL_PASSWORD ?? '';
let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test.describe('Database manager - MySQL browsing', () => {
  test.skip(!Number.isInteger(mysqlPort) || mysqlPort < 1 || mysqlPort > 65_535 || !mysqlPassword, 'Requires an isolated local MySQL test container.');

  test.beforeAll(async () => {
    userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-mysql-e2e-'));
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

  test('connects with an ephemeral password and browses MySQL structure only', async () => {
    await page.getByRole('link', { name: 'Database manager', exact: true }).click();
    await expect(page.locator('[data-test-id="database-manager-workspace"]')).toBeVisible();
    await page.locator('[data-test-id="database-engine-select"] .n-base-selection').click();
    await page.locator('.n-base-select-option').filter({ hasText: 'MySQL' }).click();
    await page.locator('[data-test-id="database-host-field"] input').fill('127.0.0.1');
    await page.locator('[data-test-id="database-port-field"] input').fill(String(mysqlPort));
    await page.locator('[data-test-id="database-database-field"] input').fill('it_tools_e2e');
    await page.locator('[data-test-id="database-username-field"] input').fill('it_tools_reader');
    await page.locator('[data-test-id="database-password-field"] input').fill(mysqlPassword);
    await page.locator('[data-test-id="database-tls-mode"] .n-base-selection').click();
    await page.getByText('Disable TLS for a trusted local connection', { exact: true }).click();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(page.getByText(/Connected to MySQL 8\./)).toBeVisible();
    await expect(page.locator('[data-test-id="database-password-field"]')).toHaveCount(0);
    await expect(page.locator('[data-test-id="database-table-select"]')).toContainText('s3_mysql_probe (table)');
    const tableTabs = page.locator('.database-manager-browser .n-tabs-tab');
    await expect(tableTabs.filter({ hasText: /^Data$/ })).toHaveCount(0);
    await expect(page.locator('.database-manager-browser .n-data-table').first()).toContainText('username');
    const indexTable = page.locator('[data-test-id="database-index-table"]');
    await expect(indexTable).toContainText('uq_s3_mysql_username');
    await expect(indexTable).toContainText('idx_s3_mysql_created_at');
    await expect(indexTable.locator('tbody tr').first()).toContainText('—');

    await page.locator('[data-test-id="database-sql-editor"] textarea').fill('SELECT 1 AS value');
    await page.getByRole('button', { name: 'Run query', exact: true }).click();
    const queryResults = page.locator('[data-test-id="database-sql-results"]');
    await expect(queryResults).toContainText('value');
    await expect(queryResults).toContainText('1');
    await expect(page.locator('[data-test-id="database-sql-page-summary"]')).toContainText('1 row');

    await page.locator('[data-test-id="database-sql-editor"] textarea').fill('DELETE FROM s3_mysql_probe');
    await page.getByRole('button', { name: 'Run query', exact: true }).click();
    await expect(page.locator('[data-test-id="database-sql-error"]')).toContainText('request is invalid');

    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
    await expect(page.locator('[data-test-id="database-password-field"] input')).toHaveValue('');
  });
});
