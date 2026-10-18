import { expect, test } from '@playwright/test';

test.describe('Tool - JSON prettify', () => {
  test('formats JSON5 in a worker and keeps validation output current', async ({ page }) => {
    await page.goto('/json-prettify');

    const input = page.getByTestId('input');
    const output = page.getByTestId('area-content');
    await input.fill('{ z: 2, a: [3, 1,], }');
    await expect(output).toHaveText(`{
   "a": [
      3,
      1
   ],
   "z": 2
}`);

    await page.getByRole('switch').click();
    await expect(output).toHaveText(`{
   "z": 2,
   "a": [
      3,
      1
   ]
}`);

    await input.fill('{ invalid');
    await expect(page.getByText('Provided JSON is not valid.')).toBeVisible();
    await expect(output).toBeEmpty();
  });
});
