import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('shared Markdown links keep safe targets and explicit opener protections', async ({ page }) => {
  await page.goto('/about');

  const authorLink = page.locator('.n-layout.content').getByRole('link', { name: 'likanug' });
  await expect(authorLink).toHaveCount(1);
  await expect(authorLink).toHaveAttribute('target', '_blank');
  await expect(authorLink).toHaveAttribute('rel', 'noopener noreferrer');
});

test('Markdown print isolates its popup and renders sanitized output without changing copied HTML', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalOpen = window.open;
    window.open = ((...args: Parameters<typeof window.open>) => {
      const popup = originalOpen.apply(window, args);
      if (popup) {
        Object.defineProperty(popup, 'print', { value: () => {}, configurable: true });
      }
      return popup;
    }) as typeof window.open;
  });

  await page.goto('/markdown-to-html');
  await page
    .getByLabel('Your Markdown to convert:')
    .fill(
      '# Safe heading\n\n**preserved bold**\n\n<script>alert(1)</script>' +
        '\n\n<img src=x onerror=alert(2)>\n\n[bad](javascript:alert(3))' +
        '\n\n[safe](https://example.test)',
    );

  const copiedHtmlBeforePrint = await page.getByTestId('area-content').innerText();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Print as PDF' }).click();
  const popup = await popupPromise;

  await expect(popup).toHaveURL('about:blank');
  await expect(popup.locator('h1')).toHaveText('Safe heading');
  await expect(popup.locator('strong')).toHaveText('preserved bold');
  await expect(popup.locator('script, img, [onerror]')).toHaveCount(0);
  await expect(popup.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(popup.locator('a[href="https://example.test"]')).toHaveText('safe');
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await expect(page.getByTestId('area-content')).toHaveText(copiedHtmlBeforePrint);
});

test('SVG placeholder download keeps hostile-looking input as text', async ({ page }) => {
  const text = '</text><script>alert(1)</script><text>& "quoted"';
  await page.goto('/svg-placeholder-generator');
  await page.getByLabel('Custom text').fill(text);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download svg' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('file.svg');

  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error('The SVG download was not saved by the browser test runner.');
  }
  const svg = await readFile(downloadPath, 'utf8');
  const parsed = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    return {
      hasParserError: document.querySelector('parsererror') !== null,
      activeNodes: document.querySelectorAll('script, foreignObject').length,
      text: document.documentElement.textContent ?? '',
    };
  }, svg);

  expect(parsed.hasParserError).toBe(false);
  expect(parsed.activeNodes).toBe(0);
  expect(parsed.text).toContain(text);
});

test('Base64 image preview keeps SVG in image context without executing its script', async ({ page }) => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
    '<script>alert(1)</script><rect width="16" height="16" fill="#000"/></svg>';
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  let dialogCount = 0;
  page.on('dialog', async (dialog) => {
    dialogCount++;
    await dialog.dismiss();
  });

  await page.goto('/base64-file-converter');
  await page.getByPlaceholder('Put your base64 file string here...').fill(dataUri);
  await page.getByRole('button', { name: 'Preview image' }).click();

  const image = page.locator('#previewContainer img');
  await expect(image).toHaveAttribute('src', dataUri);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(16);
  await expect(page.locator('#previewContainer script')).toHaveCount(0);
  expect(dialogCount).toBe(0);
});

test('Base64 HTML download preserves the exact requested file bytes', async ({ page }) => {
  const html = '<!doctype html><script>document.title="downloaded"</script><p>source bytes</p>';
  const dataUri = `data:text/html;base64,${Buffer.from(html).toString('base64')}`;

  await page.goto('/base64-file-converter');
  await page.getByPlaceholder('Put your base64 file string here...').fill(dataUri);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download file' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('file.html');

  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error('The HTML download was not saved by the browser test runner.');
  }
  expect(await readFile(downloadPath, 'utf8')).toBe(html);
});
