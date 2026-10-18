import { expect, test } from '@playwright/test';

test.describe('Tool - JSON path extractor', () => {
  test('extracts paths in a worker and keeps both validations current', async ({ page }) => {
    await page.goto('/json-path-extractor');

    const input = page.getByTestId('input');
    const path = page.getByTestId('path');
    const output = page.getByTestId('area-content');
    await expect(output).toHaveText('[\n  "Alice",\n  "Bob"\n]');

    await path.fill('$.users[-1].name');
    await expect(output).toHaveText('"Bob"');

    await path.fill('$.users[');
    await expect(page.getByText('Provided JSON path is not valid.')).toBeVisible();
    await expect(output).toBeEmpty();

    await path.fill('$.users[*].name');
    await input.fill('{ invalid');
    await expect(page.getByText('Provided JSON is not valid.')).toBeVisible();
    await expect(output).toBeEmpty();
  });
});
