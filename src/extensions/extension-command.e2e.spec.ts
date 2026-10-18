import { expect, test } from '@playwright/test';

test('loads first-party commands when search opens and navigates to the selected tool', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('button', { name: /Search/ })).toBeVisible();
  await page.getByRole('button', { name: /Search/ }).click();
  const search = page.getByPlaceholder('Type to search a tool or a command...');
  await expect(search).toBeVisible();
  await search.fill('Open JSON Lines converter');

  const option = page.getByRole('option', { name: /Open JSON Lines converter/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/\/json-lines-converter$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
