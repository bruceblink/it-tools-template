import { expect, test } from '@playwright/test';

test.describe('Tool - IPv4 CIDR merge', () => {
  test('merges in a worker and reports validation and input limits', async ({ page }) => {
    await page.goto('/ipv4-cidr-merge');

    const input = page.getByTestId('input');
    const output = page.getByTestId('area-content');
    await expect(output).toHaveText('10.0.0.1/32\n10.0.0.2/32\n192.168.1.0/24');

    await input.fill('10.0.0.1\nbad-ip');
    await expect(page.getByTestId('format-transformer-task-status')).toHaveText('Line 2: Invalid IPv4 address "bad-ip".');
    await expect(output).toHaveText('');

    await input.fill('x'.repeat(256 * 1024 + 1));
    await expect(page.getByTestId('format-transformer-task-status')).toHaveText('Task limits exceeded. Reduce the input.');
    await expect(output).toHaveText('');
  });
});
