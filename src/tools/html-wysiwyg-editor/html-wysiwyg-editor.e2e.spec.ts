import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.describe('Tool - HTML WYSIWYG editor', () => {
  test('renders the editor and applies toolbar formatting', async ({ page }) => {
    await page.goto('/html-wysiwyg-editor');

    const editor = page.locator('.ProseMirror');
    const toolbarButtons = page.locator('.editor-header button.c-button');
    await expect(editor).toContainText('Hey!');
    await expect(toolbarButtons).toHaveCount(16);
    await expect(page.getByRole('button', { name: 'Download .html' })).toBeVisible();

    await editor.locator('h1').click();
    await page.keyboard.press('Control+A');
    await toolbarButtons.first().click();

    await expect(editor.locator('strong').first()).toHaveText('Hey!');
  });

  test('downloads the formatted document through the shared platform adapter', async ({ page }) => {
    await page.goto('/html-wysiwyg-editor');
    await expect(page.getByTestId('area-content')).toContainText('Welcome to this html wysiwyg editor');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .html' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('document.html');

    const downloadPath = await download.path();
    if (!downloadPath) {
      throw new Error('The formatted HTML was not saved by the browser test runner.');
    }
    expect(await readFile(downloadPath, 'utf8')).toContain('<h1>Hey!</h1>');
    expect(await readFile(downloadPath, 'utf8')).toContain('Welcome to this html wysiwyg editor');
  });

  test('writes copied HTML through the shared clipboard adapter', async ({ page }, testInfo) => {
    await page.goto('/html-wysiwyg-editor');
    if (testInfo.project.name === 'webkit') {
      await page.context().grantPermissions(['clipboard-read'], { origin: new URL(page.url()).origin });
    }
    else {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    }

    await page.getByRole('button', { name: 'Copy to clipboard' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('<h1>Hey!</h1>');
  });
});
