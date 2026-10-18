import { expect, test } from '@playwright/test';

test.describe('Tool - JSON Lines Converter', () => {
  test('converts JSON Lines in a worker and shows conversion statistics', async ({ page }) => {
    await page.goto('/json-lines-converter');
    await page.getByLabel('Your JSON Lines').fill('{"id":1}\n{"id":2}');

    await expect(page.getByTestId('area-content')).toHaveText('[\n  {\n    "id": 1\n  },\n  {\n    "id": 2\n  }\n]');
    await expect(page.locator('.n-statistic').nth(1)).toContainText('2');
  });

  test('shows a conversion error for invalid JSON Lines', async ({ page }) => {
    await page.goto('/json-lines-converter');
    await page.getByLabel('Your JSON Lines').fill('{ invalid json }');

    await expect(page.getByText(/Line 1 is not valid JSON/)).toBeVisible();
  });
});
