import { expect, test } from '@playwright/test';

test.describe('Tool - CSV to Markdown table', () => {
  test('converts in a worker and reports invalid or oversized input', async ({ page }) => {
    await page.goto('/csv-to-markdown-table');

    const input = page.getByTestId('input');
    const output = page.getByTestId('area-content');
    await input.fill('name,age\nAlice,30');
    await expect(output).toContainText('| name | age |');
    await expect(output).toContainText('| Alice | 30 |');

    await input.fill('"unterminated');
    await expect(page.getByText('Provided CSV is not valid.', { exact: true })).toBeVisible();
    await expect(output).toHaveText('');

    await input.fill('x'.repeat(256 * 1024 + 1));
    await expect(page.getByText('Task limits exceeded. Reduce the input.', { exact: true })).toBeVisible();
    await expect(output).toHaveText('');
  });
});
