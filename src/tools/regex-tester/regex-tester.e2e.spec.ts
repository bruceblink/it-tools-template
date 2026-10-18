import { expect, test } from '@playwright/test';

test.describe('Tool - Regex Tester', () => {
  test('runs matching in a worker and updates with the newest input', async ({ page }) => {
    await page.goto('/regex-tester');
    await page.getByLabel('Regex to test:').fill('(?<word>ab)');
    await page.getByLabel('Text to match:').fill('ab xx ab');

    const matchRows = page.locator('table tbody tr');
    await expect(matchRows).toHaveCount(2);
    await expect(page.locator('table')).toContainText('word');
  });

  test('terminates a slow pattern and accepts a later task', async ({ page }) => {
    await page.goto('/regex-tester');
    const pattern = page.getByLabel('Regex to test:');
    const text = page.getByLabel('Text to match:');
    await pattern.fill('^(a+)+$');
    await text.fill(`${'a'.repeat(20_000)}!`);

    await expect(page.getByText('Task timed out. Simplify the input.'))
      .toBeVisible({ timeout: 10_000 });

    await pattern.fill('safe');
    await text.fill('safe');
    await expect(page.locator('table')).toContainText('safe');
  });
});
