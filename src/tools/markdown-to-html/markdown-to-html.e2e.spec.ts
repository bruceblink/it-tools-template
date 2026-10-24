import { expect, test } from '@playwright/test';

test.describe('Tool - Markdown to HTML', () => {
  test('renders in a worker, clears stale output and enforces the input limit', async ({ page }) => {
    await page.goto('/markdown-to-html');

    const input = page.getByTestId('markdown-input');
    const output = page.getByTestId('area-content');
    await input.fill('# Preview\n\n**safe** <script>alert(1)</script>');
    await expect(output).toContainText('<h1>Preview</h1>');
    await expect(output).toContainText('&lt;script&gt;alert(1)&lt;/script&gt;');

    await input.fill('latest **result**');
    await expect(output).toHaveText('<p>latest <strong>result</strong></p>\n');

    await input.fill('x'.repeat(256 * 1024 + 1));
    await expect(page.getByRole('alert')).toHaveText('Task limits exceeded. Reduce the input.');
    await expect(output).toHaveText('');

    await input.fill('');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(output).toHaveText('');
  });
});
