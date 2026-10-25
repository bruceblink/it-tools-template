import { expect, test } from '@playwright/test';

test.describe('Tool - Text statistics', () => {
  test('updates counts for Unicode, whitespace, and line endings', async ({ page }) => {
    await page.goto('/text-statistics');

    await page.getByPlaceholder('Your text...').fill('😀 x\n');

    await expect(page.getByTestId('character-count')).toContainText('5');
    await expect(page.getByTestId('word-count')).toContainText('3');
    await expect(page.getByTestId('line-count')).toContainText('2');
    await expect(page.getByTestId('byte-size')).toContainText('7 Bytes');
  });
});
