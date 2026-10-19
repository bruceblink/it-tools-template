import { expect, test } from '@playwright/test';

test('keeps shared tools on web and hides Electron-only tool routes', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Token generator' }).first()).toBeVisible();
  await expect(page.locator('a[href="/database-manager"]')).toHaveCount(0);
  await expect(page.locator('a[href="/system-monitor"]')).toHaveCount(0);

  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder('Type to search a tool or a command...');
  await search.fill('Database manager');
  await expect(page.locator('a[href="/database-manager"]')).toHaveCount(0);
  await expect(page.getByText('Database manager', { exact: true })).toHaveCount(0);
  await search.fill('System monitor');
  await expect(page.locator('a[href="/system-monitor"]')).toHaveCount(0);
  await expect(page.getByText('System monitor', { exact: true })).toHaveCount(0);

  await page.goto('/database-manager');
  await expect(page.getByRole('heading', { name: '404 Not Found' })).toBeVisible();
  await page.goto('/system-monitor');
  await expect(page.getByRole('heading', { name: '404 Not Found' })).toBeVisible();
});
