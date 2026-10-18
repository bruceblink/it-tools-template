import { expect, test } from '@playwright/test';

test.describe('Tool - Text Diff', () => {
  test('replaces stale work with the latest text comparison', async ({ page }) => {
    await page.goto('/text-diff');
    const original = page.getByLabel('Original text');
    const modified = page.getByLabel('Modified text');

    await original.fill('older input');
    await modified.fill('older output');
    await original.fill('current input');
    await modified.fill('current output');

    const output = page.getByTestId('diff-output');
    await expect(output).toContainText('current output');
    await expect(output).not.toContainText('older output');
  });
});
