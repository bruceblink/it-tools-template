import { expect, test } from '@playwright/test';

test.describe('Tool - CSV to JSON', () => {
  test('converts CSV rows in a worker', async ({ page }) => {
    await page.goto('/csv-to-json');
    await page.getByLabel('Your CSV').fill('name,age,active\nAlice,30,true');

    const output = page.getByTestId('area-content');
    await expect(output).toContainText('"name": "Alice"');
    await expect(output).toContainText('"age": "30"');
  });
});
