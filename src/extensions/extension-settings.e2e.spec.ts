import { expect, test } from '@playwright/test';

test('manages tool settings from the global settings page', async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'it-tools.extension-setting.v1:org.it-tools.data-conversion:org.it-tools.data-conversion%2Fmax-records';
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify(24.8));
    }
  });

  await page.goto('/');
  const settingsLink = page.getByRole('link', { name: 'Settings', exact: true });
  await expect(settingsLink).toBeVisible();
  await settingsLink.click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'General' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tool settings' })).toBeVisible();

  await page.getByRole('link', { name: 'About', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(1);
  await expect(page).toHaveURL(/\/about$/);

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText('External plugin packages are available only in the Electron desktop app. The web version continues to use built-in and first-party extensions.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install signed package' })).toHaveCount(0);

  const maxRecords = page.getByRole('textbox', { name: 'Maximum JSON Lines records' });
  await expect(maxRecords).toHaveValue('24');
  await expect(page.getByText('This saved value was upgraded to the current setting version.')).toBeVisible();

  await maxRecords.fill('120');
  await expect(maxRecords).toHaveValue('120');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByText('Setting saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Maximum JSON Lines records' })).toHaveValue('120');
  await expect(page.getByText('This saved value was upgraded to the current setting version.')).toHaveCount(0);

  await page.goto('/settings/extensions');
  await expect(page).toHaveURL(/\/settings$/);
});
