import { expect, test } from '@playwright/test';

test('reads a user-selected file through the shared platform adapter', async ({ page }) => {
  await page.goto('/base64-file-converter');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'selected.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('local file content'),
  });

  await expect(page.getByPlaceholder('File in base64 will be here')).toHaveValue('data:text/plain;base64,bG9jYWwgZmlsZSBjb250ZW50');
});
