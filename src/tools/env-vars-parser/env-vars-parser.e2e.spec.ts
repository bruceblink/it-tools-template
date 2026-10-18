import { expect, test } from '@playwright/test';

test.describe('Tool - environment variables parser', () => {
  test('parses in a worker, shows syntax diagnostics, and clears stale output', async ({ page }) => {
    await page.goto('/env-vars-parser');

    const input = page.getByTestId('env-input');
    const output = page.getByTestId('area-content');
    await input.fill('APP_ENV=production\nBAD-NAME=value\nEMPTY=');

    await expect(output).toContainText('"APP_ENV": "production"');
    await expect(page.getByText('Provided environment variables contain syntax errors.')).toBeVisible();
    await expect(page.getByText('Invalid environment variable name "BAD-NAME".')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Parsed environment variables' })).toBeVisible();

    await input.fill('');
    await expect(output).toBeEmpty();
  });
});
