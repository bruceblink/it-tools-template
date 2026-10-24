import { expect, test } from '@playwright/test';

test.describe('Tool - Docker Run to Compose', () => {
  test('converts in a worker and reports diagnostics and limits', async ({ page }) => {
    await page.goto('/docker-run-to-docker-compose-converter');

    const input = page.getByTestId('docker-run-command');
    const output = page.getByTestId('area-content');
    await input.fill('docker run --name web -p 8080:80 --restart always nginx');
    await expect(output).toHaveText("version: '3.9'\nservices:\n    nginx:\n        image: nginx\n        restart: always\n        ports:\n            - '8080:80'\n        container_name: web\n");

    await input.fill('docker run --rm --gpus all --name worker image:tag');
    await expect(page.getByText('The option "--rm" could not be translated to docker-compose.yml.', { exact: true })).toBeVisible();
    await expect(page.getByText('The option "--gpus" is not yet implemented.', { exact: true })).toBeVisible();
    await expect(output).toContainText("image: 'image:tag'");

    await input.fill('x'.repeat(256 * 1024 + 1));
    await expect(page.getByTestId('docker-compose-task-status')).toHaveText('Task limits exceeded. Reduce the input.');
    await expect(output).toHaveText('');
  });
});
