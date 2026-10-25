import { expect, test } from '@playwright/test';

test.describe('Tool - cURL Code Generator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/curl-code-generator');
  });

  test('formats only the selected output', async ({ page }) => {
    const output = page.getByTestId('curl-generated-output').getByTestId('area-content');
    await expect(output).toContainText('fetch(');

    await page.getByRole('button', { name: 'axios', exact: true }).click();
    await expect(output).toContainText('axios({');
    await expect(page.getByText('Method', { exact: true })).toBeVisible();
  });

  test('shows an input size error and removes the previous output', async ({ page }) => {
    const input = page.getByTestId('curl-command-input');
    const previousOutput = page.getByTestId('curl-generated-output');
    await expect(previousOutput).toBeVisible();

    await input.fill(`curl https://example.com/${'a'.repeat(256 * 1024)}`);

    await expect(page.getByRole('alert')).toContainText('cURL command exceeds 256 KiB.');
    await expect(previousOutput).toHaveCount(0);
  });

  test('limits rendered header rows while preserving all headers in generated code', async ({ page }) => {
    const headers = Array.from({ length: 7_000 }, (_ignored, index) => `-H 'X-Test-${index}: value'`).join(' ');
    await page.getByTestId('curl-command-input').fill(`curl https://example.com ${headers}`);

    const table = page.getByTestId('curl-header-table');
    await expect(page.getByRole('alert')).toContainText('Showing the first 500 of 7000 headers.');
    await expect(table.getByRole('row')).toHaveCount(501);
    await expect(page.getByTestId('curl-generated-output')).toContainText('X-Test-6999');
  });

  test('clears the previous result while generating edited input', async ({ page }) => {
    const output = page.getByTestId('curl-generated-output');
    await expect(output).toContainText('api.example.com/users');

    await page.getByTestId('curl-command-input').fill('curl https://example.com/latest');

    await expect(page.getByTestId('curl-generation-status')).toBeVisible();
    await expect(output).toHaveCount(0);
    await expect(page.getByTestId('curl-generated-output')).toContainText('https://example.com/latest');
  });
});
