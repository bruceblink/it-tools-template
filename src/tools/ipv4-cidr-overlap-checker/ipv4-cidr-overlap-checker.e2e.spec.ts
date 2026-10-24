import { expect, test } from '@playwright/test';

test.describe('Tool - IPv4 CIDR overlap checker', () => {
  test('analyzes in a worker and bounds invalid, dense, and oversized input', async ({ page }) => {
    await page.goto('/ipv4-cidr-overlap-checker');

    const input = page.getByTestId('input');
    await expect(page.getByText('L1: 10.0.0.0/24', { exact: true })).toBeVisible();
    await expect(page.getByText('L2: 10.0.0.128/25', { exact: true })).toBeVisible();

    await input.fill('10.0.0.0/24\nbad-ip');
    await expect(page.getByTestId('ipv4-cidr-overlap-task-status')).toHaveText('Line 2: Enter CIDR notation like 192.168.0.0/24.');
    await expect(page.getByText('L1: 10.0.0.0/24', { exact: true })).toHaveCount(0);

    await input.fill(Array.from({ length: 33 }, () => '10.0.0.0/24').join('\n'));
    await expect(page.getByTestId('ipv4-cidr-overlap-task-status')).toHaveText('This input produces more than 500 overlapping pairs. Reduce the input to view the full report.');

    await input.fill(Array.from({ length: 1_001 }, () => '10.0.0.0/24').join('\n'));
    await expect(page.getByTestId('ipv4-cidr-overlap-task-status')).toHaveText('Task limits exceeded. Reduce the input.');
  });
});
