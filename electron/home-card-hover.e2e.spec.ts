import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('tool cards do not retain hover styling when returning home', async () => {
  // Use a temporary profile so this UI regression cannot change the developer's settings.
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-home-card-hover-e2e-'));
  const electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('load');
    await expect(page.getByRole('heading', { name: 'All the tools' })).toBeVisible();

    await page.getByRole('link', { name: 'Token generator' }).first().click();
    await expect(page).toHaveURL('app://bundle/token-generator');
    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByRole('heading', { name: 'All the tools' })).toBeVisible();

    const tokenCard = page.locator('.grid-wrapper .decoration-none[href="/token-generator"] .c-card').last();
    await expect(tokenCard).not.toHaveClass(/hover:border-primary/);

    await tokenCard.hover();
    await expect(tokenCard).toHaveClass(/hover:border-primary/);
  }
  finally {
    try {
      await electronApp.close();
    }
    finally {
      await rm(userDataDirectory, { recursive: true, force: true });
    }
  }
});
