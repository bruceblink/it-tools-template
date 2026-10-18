import { expect, test } from '@playwright/test';

test.describe('Tool - math evaluator', () => {
  test('evaluates expressions in a worker and reports resource limits', async ({ page }) => {
    await page.goto('/math-evaluator');

    const input = page.getByTestId('math-expression');
    const output = page.getByTestId('math-result');
    await input.fill('2 * sqrt(6)');
    await expect(output).toHaveText('4.898979485566356');

    await input.fill('sum(ones(1000, 1000))');
    await expect(page.getByText('This expression exceeds the calculation limits. Use a smaller matrix or range.')).toBeVisible();
    await expect(output).toHaveCount(0);
  });
});
