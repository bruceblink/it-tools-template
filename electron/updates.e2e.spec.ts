import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('shows update settings, keeps development offline, and persists the automatic check preference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'it-tools-update-e2e-'));
  const electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${root}`, '.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });
  try {
    const page = await electronApp.firstWindow();
    await page.waitForURL('app://bundle/**');
    await expect(page.locator('#app')).not.toBeEmpty();
    await page.goto('app://bundle/settings');
    const card = page.getByTestId('desktop-updates');
    await expect(card.getByText('Current version:', { exact: false })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Check for updates', exact: true })).toBeDisabled();
    const setting = card.getByRole('switch', { name: 'Automatically check for updates' });
    await expect(setting).toBeChecked();
    await setting.click();
    await expect(setting).not.toBeChecked();
    await expect.poll(async () => readFile(join(root, 'app-update-preferences.json'), 'utf8')
      .then(raw => JSON.parse(raw).autoCheck, () => undefined)).toBe(false);
    await page.reload();
    await expect(setting).not.toBeChecked();
    expect(await page.evaluate(() => window.itToolsDesktop!.updates!.getState())).toMatchObject({
      autoCheck: false, status: 'disabled', disabledReason: 'development',
    });
  }
  finally {
    await electronApp.close();
    await rm(root, { recursive: true, force: true });
  }
});
