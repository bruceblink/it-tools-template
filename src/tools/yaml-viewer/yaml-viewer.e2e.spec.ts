import { expect, test } from '@playwright/test';

test.describe('Tool - YAML prettify', () => {
  test('formats YAML in a worker and reports invalid input', async ({ page }) => {
    await page.goto('/yaml-prettify');

    const input = page.getByTestId('input');
    const output = page.getByTestId('area-content');
    await input.fill('z: 1\na:\n  y: 3\n  b: 2\n');
    await expect(output).toHaveText('z: 1\na:\n  y: 3\n  b: 2');

    await page.getByRole('switch').click();
    await expect(output).toHaveText('a:\n  b: 2\n  y: 3\nz: 1');

    await input.fill('a: [');
    await expect(page.getByText('Provided YAML is not valid.')).toBeVisible();
    await expect(output).toBeEmpty();
  });
});
