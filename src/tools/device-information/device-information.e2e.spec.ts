import { expect, test } from '@playwright/test';

test('shows runtime details through the shared platform adapter', async ({ page }) => {
  await page.goto('/device-information');

  const runtimeRow = page.locator('.information').filter({ has: page.getByText('Runtime', { exact: true }) });
  const platformRow = page.locator('.information').filter({ has: page.getByText('Runtime platform', { exact: true }) });
  const versionRow = page.locator('.information').filter({ has: page.getByText('Runtime version', { exact: true }) });

  await expect(runtimeRow).toContainText('web');
  await expect(platformRow).not.toContainText('unknown');
  await expect(versionRow).toContainText('browser');
});
