import { expect, test } from '@playwright/test';

test.describe('Tool - bcrypt', () => {
  test('hashes and compares values in workers', async ({ page }) => {
    await page.goto('/bcrypt');

    const input = page.getByTestId('bcrypt-input');
    const hashField = page.getByTestId('bcrypt-hash');
    await input.fill('synthetic password');
    await expect.poll(() => hashField.inputValue()).toMatch(/^\$2[aby]\$10\$/);
    const hash = await hashField.inputValue();

    await page.getByTestId('bcrypt-compare-input').fill('synthetic password');
    await page.getByTestId('bcrypt-compare-hash').fill(hash);
    await expect(page.getByTestId('bcrypt-compare-result')).toHaveText('Yes');

    await page.getByTestId('bcrypt-compare-input').fill('different password');
    await expect(page.getByTestId('bcrypt-compare-result')).toHaveText('No');
  });
});
