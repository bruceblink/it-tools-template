import { expect, test } from '@playwright/test';

test.describe('Tool - SQL prettify', () => {
  test('formats SQL in a dedicated worker and clears stale output', async ({ page }) => {
    await page.goto('/sql-prettify');

    const input = page.getByTestId('input');
    const output = page.getByTestId('area-content');
    await input.fill('select id,name from users;');
    await expect(output).toHaveText('SELECT\n  id,\n  name\nFROM\n  users;');

    await input.fill('');
    await expect(output).toBeEmpty();
  });
});
