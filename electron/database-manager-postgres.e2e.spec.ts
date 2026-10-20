import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const postgresPort = Number(process.env.IT_TOOLS_TEST_POSTGRES_PORT);
let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test.describe('Database manager - PostgreSQL browsing', () => {
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

  test('connects over a trusted local socket and browses bounded keyset and offset pages', async () => {
    await page.getByRole('link', { name: 'Database manager', exact: true }).click();
    await expect(page.locator('[data-test-id="database-manager-workspace"]')).toBeVisible();
    await page.locator('[data-test-id="database-port-field"] input').fill(String(postgresPort));
    await page.locator('[data-test-id="database-tls-mode"] .n-base-selection').click();
    await page.getByText('Disable TLS for a trusted local connection', { exact: true }).click();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(page.getByText(/Connected to PostgreSQL/)).toBeVisible();
    await expect(page.getByText('s2a_structure_probe (table)', { exact: true })).toBeVisible();
    await expect(page.locator('.database-manager-browser .n-data-table').getByText('structure test', { exact: true })).toBeVisible();

    await page.locator('.database-manager-browser .n-base-selection').nth(1).click();
    await page.getByText('s2e_index_probe (table)', { exact: true }).click();
    await page.getByText('Structure', { exact: true }).click();
    const indexTable = page.locator('[data-test-id="database-index-table"]');
    await expect(indexTable).toContainText('s2e_index_probe_pkey');
    await expect(indexTable).toContainText('INCLUDE (include_value)');
    await expect(indexTable).toContainText('lower(key_value)');
    await expect(indexTable.locator('tbody tr').filter({ hasText: 's2e_index_probe_long_predicate_idx' }).locator('td').nth(5)).toContainText('…');

    await page.locator('.database-manager-browser .n-base-selection').nth(1).click();
    await page.getByText('s2e_many_index_probe (table)', { exact: true }).click();
    await page.getByText('Structure', { exact: true }).click();
    await expect(page.getByText('64+ indexes; showing 64.', { exact: true })).toBeVisible();
    await expect(page.locator('[data-test-id="database-index-table"] tbody tr')).toHaveCount(64);

    await page.locator('.database-manager-browser .n-base-selection').nth(1).click();
    await page.getByText('s2b_keyset_probe (table)', { exact: true }).click();
    await expect(page.getByText('Page 1 · 25 rows', { exact: true })).toBeVisible();
    const dataTable = page.locator('.database-manager-browser .n-data-table');
    await expect(dataTable.locator('tbody tr').first()).toContainText('1');
    const truncatedCell = await dataTable.locator('tbody tr').first().locator('td').nth(1).innerText();
    expect(Array.from(truncatedCell.replace(/…$/, '')).length).toBeLessThanOrEqual(256);

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Page 2 · 25 rows', { exact: true })).toBeVisible();
    await expect(dataTable.locator('tbody tr').first()).toContainText('26');
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(page.getByText('Page 1 · 25 rows', { exact: true })).toBeVisible();

    await page.locator('.database-manager-browser .n-base-selection').nth(1).click();
    await page.getByText('s2b_offset_probe (table)', { exact: true }).click();
    await expect(page.getByText(/no primary key/i)).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Page 2 · 5 rows', { exact: true })).toBeVisible();

    await page.locator('.database-manager-browser .n-base-selection').nth(1).click();
    await page.getByText('s2d_slow_view (view)', { exact: true }).click();
    const cancelPreview = page.locator('[data-test-id="database-cancel-page"]');
    await expect(cancelPreview).toBeVisible();
    await cancelPreview.click();
    await expect(page.getByText('Preview cancelled. The connection is still available.', { exact: true })).toBeVisible();

    await page.locator('.database-manager-browser .n-base-selection').nth(1).click();
    await page.getByText('s2b_keyset_probe (table)', { exact: true }).click();
    await expect(page.getByText('Page 1 · 25 rows', { exact: true })).toBeVisible();

    await page.locator('[data-test-id="database-sql-editor"] textarea').fill('SELECT 1 AS value');
    await page.getByRole('button', { name: 'Run SQL', exact: true }).click();
    await expect(page.locator('[data-test-id="database-sql-results"]')).toContainText('1');
    await expect(page.locator('[data-test-id="database-sql-page-summary"]')).toContainText('1 row');

    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  });
});
