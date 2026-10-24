import { expect, test } from '@playwright/test';

test.describe('Tool - List converter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/list-converter');
  });

  test('Has correct title', async ({ page }) => {
    await expect(page).toHaveTitle('List converter - IT Tools');
  });

  test('Simple list should be converted with default settings', async ({ page }) => {
    await page.getByTestId('input').fill(`1
    2
    3
    4
    5`);

    await expect(page.getByTestId('area-content')).toHaveText('1, 2, 3, 4, 5');
  });

  test('Duplicates should be removed and list items wrapped with a prefix and suffix', async ({ page }) => {
    await page.getByTestId('input').fill(`1
    2
    2
    4
    4
    3
    5`);
    await page.getByTestId('removeDuplicates').check();
    await page.getByTestId('itemPrefix').fill('\'');
    await page.getByTestId('itemSuffix').fill('\'');

    // Formatting updates after the input event; wait for the expected output instead of reading once.
    await expect(page.getByTestId('area-content')).toHaveText('\'1\', \'2\', \'4\', \'3\', \'5\'');
  });

  test('reports inputs above the Worker byte limit', async ({ page }) => {
    await page.getByTestId('input').fill('x'.repeat(1024 * 1024 + 1));

    await expect(page.getByTestId('format-transformer-task-status')).toHaveText('Task limits exceeded. Reduce the input.');
    await expect(page.getByTestId('area-content')).toHaveText('');
  });
});
