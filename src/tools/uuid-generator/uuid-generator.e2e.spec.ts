import { expect, test } from '@playwright/test';

test.describe('Tool - UUID generator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/uuid-generator');
  });

  test('generates a version 7 UUID with an encoded current timestamp', async ({ page }) => {
    await page.getByRole('button', { name: 'v7', exact: true }).click();

    const value = await page.getByTestId('uuid-output').inputValue();
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const timestamp = Number(BigInt(`0x${value.replaceAll('-', '').slice(0, 12)}`));
    expect(timestamp).toBeLessThanOrEqual(Date.now());
    expect(timestamp).toBeGreaterThan(Date.now() - 60_000);
  });
});
