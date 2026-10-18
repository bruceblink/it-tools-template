import { expect, test } from '@playwright/test';

test.describe('Tool - JSON diff', () => {
  test('computes and filters JSON diffs in a worker', async ({ page }) => {
    await page.goto('/json-diff');

    const leftJson = page.getByTestId('leftJson');
    const rightJson = page.getByTestId('rightJson');
    await leftJson.fill('{ name: "Alice", count: 1 }');
    await rightJson.fill('{ name: "Bob", count: 1 }');

    const result = page.getByTestId('diff-result');
    await expect(result).toContainText('"Alice"');
    await expect(result).toContainText('"Bob"');
    await expect(result).toContainText('count:');

    await page.getByRole('switch').click();
    await expect(result).not.toContainText('count:');

    await leftJson.fill('{ invalid');
    await expect(page.getByText('Invalid JSON format').first()).toBeVisible();
    await expect(result).toHaveCount(0);
  });
});
