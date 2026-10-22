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
    await expect(page.locator('[data-test-id="sqlite-access-notice"]')).toContainText('read-only');
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
    await expect(tableTabs.filter({ hasText: /^Data$/ })).toHaveCount(1);
    await expect(page.locator('[data-test-id="database-data-table"]')).toContainText('sqlite-user');
    const dataViewControls = page.locator('[data-test-id="database-data-view-controls"]');
    await dataViewControls.locator('[data-test-id="database-filter-column"] .n-base-selection').click();
    await page.locator('.n-base-select-option').filter({ hasText: 'username · TEXT' }).click();
    await dataViewControls.locator('[data-test-id="database-filter-operator"] .n-base-selection').click();
    await page.locator('.n-base-select-option').filter({ hasText: /^Equals$/ }).click();
    await dataViewControls.locator('[data-test-id="database-filter-value"] input').fill('sqlite-user');
    await dataViewControls.locator('[data-test-id="database-filter-add"]').click();
    await expect(dataViewControls.locator('[data-test-id="database-filter-tags"]')).toContainText('username Equals sqlite-user');
    await dataViewControls.locator('[data-test-id="database-sort-column"] .n-base-selection').click();
    await page.locator('.n-base-select-option').filter({ hasText: 'id · INTEGER' }).click();
    await dataViewControls.locator('[data-test-id="database-sort-direction"] .n-base-selection').click();
    await page.locator('.n-base-select-option').filter({ hasText: 'Descending' }).click();
    await dataViewControls.locator('[data-test-id="database-sort-apply"]').click();
    await expect(dataViewControls.locator('[data-test-id="database-filter-tags"]')).toContainText('id · Descending');
    const dataTools = page.locator('[data-test-id="database-data-tools"]');
    await expect(dataTools.locator('[data-test-id="database-export-csv"]')).toBeVisible();
    await expect(dataTools.locator('[data-test-id="database-export-jsonl"]')).toBeVisible();
    await expect(dataTools.locator('[data-test-id="database-data-columns"] summary')).toBeVisible();
    await dataTools.locator('[data-test-id="database-data-columns"] summary').click();
    const payloadColumnToggle = dataTools.locator('[data-test-id="database-data-columns"] .n-checkbox').filter({ hasText: 'payload · BLOB' });
    await expect(payloadColumnToggle).toBeVisible();
    await payloadColumnToggle.click();
    await expect(page.locator('[data-test-id="database-data-table"]')).not.toContainText('payload · BLOB');
    await payloadColumnToggle.click();
    await expect(page.locator('[data-test-id="database-data-table"]')).toContainText('payload · BLOB');
    await dataTools.locator('[data-test-id="database-export-csv"]').click();
    await expect(page.locator('[data-test-id="database-export-status"]')).toContainText('Export started.');
    await dataTools.locator('[data-test-id="database-data-columns"] summary').click();
    await page.getByText('Structure', { exact: true }).click();
    const indexTable = page.locator('[data-test-id="database-index-table"]');
    await expect(indexTable).toContainText('uq_s3_sqlite_username');
    await expect(page.locator('.database-manager-browser .n-data-table').first()).toContainText('username');

    await page.locator('[data-test-id="database-sql-editor"] textarea').fill('SELECT 1 AS value');
    await page.getByRole('button', { name: 'Run SQL', exact: true }).click();
    const queryResults = page.locator('[data-test-id="database-sql-results"]');
    await expect(queryResults).toContainText('1');
    await expect(page.locator('[data-test-id="database-sql-tools"] [data-test-id="database-sql-export-csv"]')).toBeVisible();
    await expect(page.locator('[data-test-id="database-sql-tools"] [data-test-id="database-sql-export-jsonl"]')).toBeVisible();
    await expect(page.locator('[data-test-id="database-sql-page-summary"]')).toContainText('1 row');

    await page.locator('[data-test-id="database-sql-editor"] textarea').fill(
      'WITH RECURSIVE valueset(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM valueset WHERE value < 26) SELECT value FROM valueset ORDER BY value',
    );
    await page.getByRole('button', { name: 'Run SQL', exact: true }).click();
    await expect(queryResults.locator('tbody tr')).toHaveCount(25);
    await expect(page.locator('[data-test-id="database-sql-page-summary"]')).toContainText('25 rows');
    await page.locator('[data-test-id="database-sql-next-page"]').click();
    await expect(queryResults).toContainText('26');
    await expect(page.locator('[data-test-id="database-sql-page-summary"]')).toContainText('Page 2 · 1 row');

    await page.locator('[data-test-id="database-sql-editor"] textarea').fill(
      "DELETE FROM s3_sqlite_probe WHERE id = 1 AND username = 'sqlite-user'",
    );
    await page.getByRole('button', { name: 'Run SQL', exact: true }).click();
    await expect(page.locator('[data-test-id="database-sql-error"]')).toContainText('read-only');

    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.locator('[data-test-id="database-write-access"]').click();
    await expect(page.locator('[data-test-id="database-write-access-warning"]')).toBeVisible();
    await setWriteConfirmation();
    await setFileDialogResult({ canceled: false, filePaths: [sqliteFilePath!] });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByText(/read-write/)).toBeVisible();

    await expect(page.locator('[data-test-id="database-table-edit-notice"]')).toBeVisible();
    await page.getByRole('button', { name: 'local', exact: true }).click();
    await page.locator('[data-test-id="database-cell-edit-input"] textarea').fill('table-edited');
    await page.getByRole('button', { name: 'Save change', exact: true }).click();
    await expect(page.locator('[data-test-id="database-data-table"]')).toContainText('table-edited');

    await page.locator('[data-test-id="database-sql-editor"] textarea').fill(
      "SELECT id, username, nickname FROM s3_sqlite_probe WHERE id = 1 AND username = 'sqlite-user'",
    );
    await page.getByRole('button', { name: 'Run SQL', exact: true }).click();
    await expect(page.locator('[data-test-id="database-query-edit-notice"]')).toBeVisible();
    await page.locator('[data-test-id="database-sql-results"]').getByRole('button', { name: 'table-edited', exact: true }).click();
    await page.locator('[data-test-id="database-cell-edit-input"] textarea').fill('query-edited');
    await page.getByRole('button', { name: 'Save change', exact: true }).click();
    await expect(page.locator('[data-test-id="database-sql-results"]')).toContainText('query-edited');

    await page.locator('[data-test-id="database-sql-editor"] textarea').fill(
      "INSERT INTO s3_sqlite_probe (id, username) VALUES (99, 'crud-user')",
    );
    await page.getByRole('button', { name: 'Run SQL', exact: true }).click();
    await expect(page.locator('[data-test-id="database-sql-write-result"]')).toContainText('INSERT affected 1 row');
    await page.locator('[data-test-id="database-sql-editor"] textarea').fill(
      "UPDATE s3_sqlite_probe SET nickname = 'changed' WHERE id = 99 AND username = 'crud-user'",
    );
    await page.getByRole('button', { name: 'Run SQL', exact: true }).click();
    await expect(page.locator('[data-test-id="database-sql-write-result"]')).toContainText('UPDATE affected 1 row');
    await page.locator('[data-test-id="database-sql-editor"] textarea').fill(
      "DELETE FROM s3_sqlite_probe WHERE id = 99 AND username = 'crud-user'",
    );
    await page.getByRole('button', { name: 'Run SQL', exact: true }).click();
    await expect(page.locator('[data-test-id="database-sql-write-result"]')).toContainText('DELETE affected 1 row');
    const writePromptDetails = await electronApp.evaluate(() => {
      const state = globalThis as typeof globalThis & { __itToolsWritePrompts?: string[] };
      return state.__itToolsWritePrompts ?? [];
    });
    expect(writePromptDetails).toHaveLength(5);
    expect(writePromptDetails[0]).toContain('local → table-edited');
    expect(writePromptDetails[1]).toContain('table-edited → query-edited');
    expect(writePromptDetails[2]).toContain("INSERT INTO s3_sqlite_probe");
    expect(writePromptDetails[3]).toContain("UPDATE s3_sqlite_probe");
    expect(writePromptDetails[4]).toContain("DELETE FROM s3_sqlite_probe");

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

async function setWriteConfirmation(): Promise<void> {
  await electronApp.evaluate(({ dialog }) => {
    const state = globalThis as typeof globalThis & { __itToolsWritePrompts?: string[] };
    state.__itToolsWritePrompts = [];
    Object.defineProperty(dialog, 'showMessageBox', {
      configurable: true,
      value: async (...args: unknown[]) => {
        const options = args.at(-1) as { detail?: string } | undefined;
        state.__itToolsWritePrompts?.push(options?.detail ?? '');
        return { response: 1, checkboxChecked: false };
      },
    });
  });
}
