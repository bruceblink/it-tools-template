import { expect, test } from '@playwright/test';

test.describe('Tool - IPv4 CIDR containment checker', () => {
  test('analyzes in a worker and bounds invalid, dense, and oversized input', async ({ page }) => {
    await page.goto('/ipv4-cidr-containment-checker');

    const rules = page.getByTestId('ipv4-cidr-rules-input');
    const targets = page.getByTestId('ipv4-cidr-targets-input');
    await expect(page.getByText('L1: 10.0.0.0/24', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('10.0.0.42/32', { exact: true }).first()).toBeVisible();

    await targets.fill('bad-ip');
    await expect(page.getByTestId('ipv4-cidr-containment-task-status')).toHaveText('Line 1: Invalid IPv4 address "bad-ip".');
    await expect(page.getByText('10.0.0.42/32', { exact: true })).toHaveCount(0);

    const duplicates = Array.from({ length: 23 }, () => '10.0.0.0/24').join('\n');
    await rules.fill(duplicates);
    await targets.fill(duplicates);
    await expect(page.getByTestId('ipv4-cidr-containment-task-status')).toHaveText('This input produces more than 500 rule matches. Reduce the input to view the full report.');

    await rules.fill('x'.repeat(256 * 1024 + 1));
    await targets.fill('10.0.0.1');
    await expect(page.getByTestId('ipv4-cidr-containment-task-status')).toHaveText('Task limits exceeded. Reduce the input.');
  });
});
