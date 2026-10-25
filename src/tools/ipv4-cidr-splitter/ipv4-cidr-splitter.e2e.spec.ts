import { expect, test } from '@playwright/test';

test.describe('Tool - IPv4 CIDR splitter', () => {
  test('updates the subnet summary and output for the current inputs', async ({ page }) => {
    await page.goto('/ipv4-cidr-splitter');

    const output = page.getByTestId('area-content');
    await expect(output).toContainText('192.168.0.0/26');
    await expect(output).toContainText('192.168.0.192/26');

    await page.getByLabel('Source CIDR').fill('10.0.0.0/24');
    await page.getByPlaceholder('Please Input').fill('25');

    const subnetCountRow = page.locator('tr').filter({ hasText: 'Subnet count' });
    await expect(subnetCountRow).toContainText('2');
    await expect(output).toContainText('10.0.0.0/25');
    await expect(output).toContainText('10.0.0.128/25');
  });
});
