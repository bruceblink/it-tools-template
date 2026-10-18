import { expect, test } from '@playwright/test';

test.describe('Tool - JSON key sorter', () => {
  test('sorts JSON5 input in a worker and reports invalid JSON', async ({ page }) => {
    await page.goto('/json-key-sorter');

    const input = page.getByTestId('input');
    const output = page.getByTestId('area-content');
    await input.fill('{ z: 2, a: { y: 4, b: 3 } }');
    await expect(output).toHaveText(`{
  "a": {
    "b": 3,
    "y": 4
  },
  "z": 2
}`);

    await page.getByRole('switch').nth(1).click();
    await expect(output).toHaveText(`{
  "z": 2,
  "a": {
    "y": 4,
    "b": 3
  }
}`);

    await page.getByRole('switch').nth(0).click();
    await expect(output).toHaveText(`{
  "z": 2,
  "a": {
    "y": 4,
    "b": 3
  }
}`);

    await input.fill('{ invalid');
    await expect(page.getByText('Provided JSON is not valid.')).toBeVisible();
    await expect(output).toBeEmpty();
  });
});
