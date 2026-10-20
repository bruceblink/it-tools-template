import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test.describe('Database manager - saved PostgreSQL profiles', () => {
  test.beforeAll(async () => {
    userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-postgres-profiles-e2e-'));
    await launchApp();
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

  test('saves only connection metadata and reloads it without a password', async () => {
    await openDatabaseManager();
    await page.locator('[data-test-id="database-host-field"] input').fill('db.example.test');
    await page.locator('[data-test-id="postgres-profile-name-field"] input').fill('E2E Local');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.getByText('Connection profile saved.', { exact: true })).toBeVisible();

    const profilePath = join(userDataDirectory, 'database-manager', 'postgres-profiles.json');
    const stored = JSON.parse(await readFile(profilePath, 'utf8')) as {
      version: number;
      profiles: Array<Record<string, unknown>>;
    };
    expect(stored.version).toBe(1);
    expect(stored.profiles).toHaveLength(1);
    expect(stored.profiles[0]).toMatchObject({
      name: 'E2E Local',
      host: 'db.example.test',
      port: 5432,
      database: 'postgres',
      username: 'postgres',
      tlsMode: 'verify',
    });
    expect(stored.profiles[0]).not.toHaveProperty('password');

    await electronApp.close();
    await launchApp();
    await openDatabaseManager();
    await page.locator('.saved-profile-section .n-base-selection').click();
    await page.getByText('E2E Local · db.example.test/postgres', { exact: true }).click();
    await expect(page.locator('[data-test-id="database-host-field"] input')).toHaveValue('db.example.test');
    await expect(page.locator('[data-test-id="database-password-field"] input')).toHaveValue('');

    await page.getByRole('button', { name: 'Delete profile', exact: true }).click();
    await expect(page.getByText('Connection profile deleted.', { exact: true })).toBeVisible();
    const afterDelete = JSON.parse(await readFile(profilePath, 'utf8')) as { profiles: unknown[] };
    expect(afterDelete.profiles).toHaveLength(0);
  });
});

async function launchApp(): Promise<void> {
  electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('load');
}

async function openDatabaseManager(): Promise<void> {
  await page.getByRole('link', { name: 'Database manager', exact: true }).click();
  await expect(page.locator('[data-test-id="database-manager-workspace"]')).toBeVisible();
  await expect(page.locator('[data-test-id="postgres-profile-section"]')).toBeVisible();
}
