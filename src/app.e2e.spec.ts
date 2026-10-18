import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('keyboard search handles an empty result and opens a matching tool', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Search/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder('Type to search a tool or a command...');
  await search.fill('zzzzzzzzzzzzzzzzzzzzzzzz');
  await expect(page.locator('.palette-modal').getByRole('option')).toHaveCount(0);
  await search.press('Enter');
  await expect(search).toBeVisible();
  await search.press('Escape');
  await expect(search).not.toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(search).toBeVisible();
  await search.fill('roman numeral');
  await expect(page.getByText('Roman numeral converter', { exact: true }).last()).toBeVisible();
  await search.press('Enter');
  await expect(page).toHaveURL(/\/roman-numeral-converter$/);
  expect(errors).toEqual([]);
});

test('language selection updates a tool title and survives reload', async ({ page }) => {
  await page.goto('/regex-tester');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Regex Tester');
  const language = page.locator('.c-select').first();
  await language.locator('.c-select-input').click();
  await language.getByText('中文', { exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Regex Tester');
  const translatedTitle = await page.getByRole('heading', { level: 1 }).innerText();
  expect(translatedTitle).not.toContain('tools.');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(translatedTitle);
  await expect(language.locator('.c-select-input')).toContainText('中文');
});

test.describe('locale loading failures', () => {
  test.use({ serviceWorkers: 'block' });

  test('keeps the active language when a selected locale chunk fails to load', async ({ page }) => {
    await page.route('**/assets/zh-*.js', route => route.abort());
    await page.goto('/regex-tester');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('Regex Tester');

    const language = page.locator('.c-select').first();
    await language.locator('.c-select-input').click();
    await language.getByText('中文', { exact: true }).click();

    await expect(page.getByText('The language could not be loaded. The current language is unchanged.')).toBeVisible();
    await expect(heading).toHaveText('Regex Tester');
    await expect(language.locator('.c-select-input')).toContainText('English');
  });
});

test('roman conversion preserves terminal symbols and rejects invalid input', async ({ page }) => {
  await page.goto('/roman-numeral-converter');
  // The numeric field is also type=text; identify the Roman field itself before interacting.
  const input = page.locator('.tool-content').getByPlaceholder('Input text', { exact: true });
  await expect(input).toHaveValue('XLII');
  await input.fill('MCMXCIV');
  await expect(page.locator('.result').last()).toHaveText('1994');
  await input.fill('I');
  await expect(page.locator('.result').last()).toHaveText('1');
  await input.fill('IIII');
  await expect(page.getByText('The input you entered is not a valid roman number')).toBeVisible();
});

test('an unsupported stored language falls back to English', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('locale', 'unknown-language'));
  await page.goto('/regex-tester');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Regex Tester');
  await expect(page.locator('.c-select-input').first()).toContainText('English');
});

test('a searchable select preserves its value when no option matches', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Serve the installed font locally so this component test needs no CDN request.
  const font = readFileSync(new URL('../node_modules/figlet/fonts/Standard.flf', import.meta.url), 'utf8');
  await page.route('**/fonts/*.flf', route => route.fulfill({
    body: font,
    contentType: 'text/plain',
    headers: { 'access-control-allow-origin': '*' },
  }));
  await page.goto('/ascii-text-drawer');
  const select = page.locator('.tool-content .c-select');
  await expect(select.locator('.c-select-input')).toContainText('Standard');
  await select.locator('.c-select-input').click();
  const search = select.getByPlaceholder('Search...');
  await search.fill('zzzzzzzzzzzzzzzzzzzzzzzz');
  await expect(select.getByText('No results found')).toBeVisible();
  await search.press('Enter');
  await expect(search).toBeVisible();
  await search.fill('Standard');
  await select.locator('.c-select-dropdown-option').getByText('Standard', { exact: true }).click();
  await expect(select.locator('.c-select-input')).toContainText('Standard');
  await expect(search).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('meta tag page types expose grouped leaf values', async ({ page }) => {
  await page.goto('/og-meta-generator');
  const pageType = page.locator('.tool-content .c-select').first();
  await pageType.locator('.c-select-input').click();
  await pageType.locator('.c-select-dropdown-option').getByText('Song', { exact: true }).click();
  await expect(page.getByTestId('area-content')).toContainText('music.song');
  await expect(page.getByTestId('area-content')).not.toContainText('"undefined"');
});
