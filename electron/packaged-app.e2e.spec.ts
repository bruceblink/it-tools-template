import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

async function firstExistingPath(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    }
    catch {
      // Continue until a platform package is found.
    }
  }
  return null;
}

async function packagedExecutable(): Promise<string | null> {
  if (process.platform === 'win32') {
    return firstExistingPath([resolve('release/win-unpacked/IT Tools.exe')]);
  }
  if (process.platform === 'darwin') {
    return firstExistingPath([resolve('release/mac/IT Tools.app/Contents/MacOS/IT Tools')]);
  }
  return firstExistingPath([
    resolve('release/linux-unpacked/it-tools'),
    resolve('release/linux-unpacked/IT Tools'),
  ]);
}

test('opens the database manager and system monitor in the packaged desktop app', async () => {
  const executablePath = await packagedExecutable();
  test.skip(!executablePath, 'No platform package is available in release/.');

  const userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-packaged-e2e-'));
  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await _electron.launch({
      executablePath: executablePath!,
      args: [`--user-data-dir=${userDataDirectory}`],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      timeout: 90_000,
    });
    const page: Page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('a[href="/database-manager"]').first()).toBeVisible({ timeout: 30_000 });

    await page.goto('app://bundle/database-manager');
    await expect(page.locator('[data-test-id="database-manager-workspace"]')).toBeVisible();

    await page.goto('app://bundle/system-monitor');
    await expect(page.locator('[data-test-id="system-monitor-workspace"]')).toBeVisible();
  }
  finally {
    await electronApp?.close().catch(() => {});
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});
