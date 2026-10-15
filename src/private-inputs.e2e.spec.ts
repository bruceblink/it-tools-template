import { expect, test, type Page } from '@playwright/test';

// Enter the tool through its home-page RouterLink to exercise the app's route lifecycle.
async function openToolFromHome(page: Page, path: string) {
  await page.goto('/');
  const link = page.locator(`.grid-wrapper a[href="${path}"]`).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByTestId('tool-input-memory-note')).toBeVisible();
}

async function capturePersistence(page: Page) {
  return page.evaluate(() => {
    const readStorage = (storage: Storage) => Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? '';
      return `${key}=${storage.getItem(key) ?? ''}`;
    }).join('\n');

    return {
      localStorage: readStorage(localStorage),
      sessionStorage: readStorage(sessionStorage),
      url: location.href,
    };
  });
}

async function expectInputNotPersisted(page: Page, marker: string) {
  const persisted = await capturePersistence(page);
  expect(persisted.localStorage).not.toContain(marker);
  expect(persisted.sessionStorage).not.toContain(marker);
  expect(persisted.url).not.toContain(marker);
}

test.describe('private tool inputs', () => {
  test('keeps credentials in memory while Basic authentication parsing works', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('basic-auth-parser:input', 'legacy-credential-e2e-marker');
      localStorage.setItem('curl-code-generator:curl', 'unrelated-request-e2e-marker');
    });

    await openToolFromHome(page, '/basic-auth-parser');
    const input = page.getByPlaceholder('Authorization: Basic dXNlcjpwYXNz');
    await expect(input).toHaveValue('Authorization: Basic YWxpY2U6czNjcmV0');
    await input.fill('Authorization: Basic dXNlcjpwYXNz');

    const content = page.locator('.tool-content');
    await expect(content).toContainText('user');
    await expect(content).toContainText('pass');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('basic-auth-parser:input'))).toBeNull();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('curl-code-generator:curl')))
      .toBe('unrelated-request-e2e-marker');
    await expectInputNotPersisted(page, 'dXNlcjpwYXNz');

    // Keep the document alive so this checks component teardown rather than a full reload.
    await page.evaluate(() => { document.documentElement.dataset.navigationMarker = 'same-document'; });
    await page.locator('a.hero-wrapper').click();
    await page.locator('.grid-wrapper a[href="/basic-auth-parser"]').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-navigation-marker', 'same-document');
    await expect(input).toHaveValue('Authorization: Basic YWxpY2U6czNjcmV0');
    await expectInputNotPersisted(page, 'dXNlcjpwYXNz');
  });

  test('keeps request data in memory while cURL generation still works', async ({ page }) => {
    const requestMarker = 'request-input-e2e-marker-7f2c';
    await page.addInitScript(() => {
      localStorage.setItem('curl-code-generator:curl', 'legacy-request-e2e-marker');
    });

    await openToolFromHome(page, '/curl-code-generator');
    const request = `curl 'https://api.example.test/items' -X POST -H 'X-Api-Key: ${requestMarker}' --data-raw '{"name":"Ada"}'`;
    await page.getByPlaceholder('Paste a cURL command...').fill(request);

    await expect(page.locator('.tool-content')).toContainText('POST');
    await expect(page.getByTestId('area-content').first()).toContainText(requestMarker);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('curl-code-generator:curl'))).toBeNull();
    await expectInputNotPersisted(page, requestMarker);
  });

  test('clears only this tool legacy content, keeps preferences, and resets on reload', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('yaml-prettify:raw-yaml', 'legacy-document-e2e-marker');
      localStorage.setItem('yaml-prettify:indent-size', '3');
      localStorage.setItem('yaml-prettify:sort-keys', 'true');
      localStorage.setItem('basic-auth-parser:input', 'unrelated-credential-e2e-marker');
    });

    await openToolFromHome(page, '/yaml-prettify');
    const state = await page.evaluate(() => ({
      input: localStorage.getItem('yaml-prettify:raw-yaml'),
      indentSize: localStorage.getItem('yaml-prettify:indent-size'),
      sortKeys: localStorage.getItem('yaml-prettify:sort-keys'),
      unrelatedInput: localStorage.getItem('basic-auth-parser:input'),
    }));
    expect(state).toEqual({
      input: null,
      indentSize: '3',
      sortKeys: 'true',
      unrelatedInput: 'unrelated-credential-e2e-marker',
    });

    const documentMarker = 'document-input-e2e-marker-7f2c';
    const input = page.getByPlaceholder('Paste your raw YAML here...');
    await input.fill(`documentId: ${documentMarker}\ncount: 2`);
    await expect(page.getByTestId('area-content').first()).toContainText(`documentId: ${documentMarker}`);
    await expectInputNotPersisted(page, documentMarker);

    await page.reload();
    await expect(input).toHaveValue('');
    await expect(page.getByTestId('area-content').first()).toHaveText('null');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('yaml-prettify:raw-yaml'))).toBeNull();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('yaml-prettify:indent-size'))).toBe('3');
  });

  test('keeps network headers in memory while parsing them', async ({ page }) => {
    const networkMarker = 'network-input-e2e-marker-7f2c';
    await page.addInitScript(() => {
      localStorage.setItem('http-headers-parser:headers', 'legacy-network-e2e-marker');
    });

    await openToolFromHome(page, '/http-headers-parser');
    const headers = `HTTP/2 200\nAuthorization: Bearer ${networkMarker}\nX-Request-Id: request-42`;
    await page.getByPlaceholder('Paste request or response headers...').fill(headers);

    await expect(page.locator('.tool-content')).toContainText('Sensitive headers detected');
    await expect(page.getByTestId('area-content').nth(1)).toContainText(`Authorization: Bearer ${networkMarker}`);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('http-headers-parser:headers'))).toBeNull();
    await expectInputNotPersisted(page, networkMarker);
  });

  test('continues processing when clearing an old content key fails', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('robots-txt-tester:robots', 'User-agent: *\nDisallow: /legacy/');
      localStorage.setItem('robots-txt-tester:url', 'https://example.test/legacy/path');
      localStorage.setItem('robots-txt-tester:user-agent', 'LegacyBot');
      const removeItem = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (this: Storage, key: string) {
        if (key === 'robots-txt-tester:robots') {
          throw new DOMException('Storage is unavailable', 'SecurityError');
        }
        removeItem.call(this, key);
      };
    });

    await openToolFromHome(page, '/robots-txt-tester');
    await expect(page.getByTestId('tool-input-storage-warning')).toBeVisible();
    const inputMarker = 'robots-input-e2e-marker-7f2c';
    await page.getByPlaceholder('https://example.com/admin/settings').fill(`https://example.test/private/${inputMarker}`);
    await page.getByPlaceholder('Googlebot').fill('TestBot');
    await page.getByPlaceholder('Paste robots.txt content...').fill('User-agent: *\nDisallow: /private/');

    await expect(page.locator('.tool-content')).toContainText('Blocked');
    const keys = await page.evaluate(() => ({
      robots: localStorage.getItem('robots-txt-tester:robots'),
      url: localStorage.getItem('robots-txt-tester:url'),
      userAgent: localStorage.getItem('robots-txt-tester:user-agent'),
    }));
    expect(keys).toEqual({
      robots: 'User-agent: *\nDisallow: /legacy/',
      url: null,
      userAgent: null,
    });
    await expectInputNotPersisted(page, inputMarker);
  });

  test('reads a regex query once without writing later edits to the URL or storage', async ({ page }) => {
    await page.goto('/regex-tester?regex=%5Cd%2B');
    await expect(page.getByTestId('tool-input-memory-note')).toBeVisible();
    const regex = page.getByPlaceholder('Put the regex to test');
    await expect(regex).toHaveValue('\\d+');

    await page.getByPlaceholder('Put the text to match').fill('request 123');
    await expect(page.locator('.tool-content')).toContainText('123');
    await regex.fill('^edited-pattern$');

    await expect.poll(() => new URL(page.url()).searchParams.get('regex')).toBe('\\d+');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('regex-tester:regex'))).toBeNull();
    await expectInputNotPersisted(page, '^edited-pattern$');
  });

  test('ignores repeated regex query values', async ({ page }) => {
    await page.goto('/regex-tester?regex=first&regex=second');
    const regex = page.getByPlaceholder('Put the regex to test');
    await expect(regex).toHaveValue('');
    await regex.fill('^memory-only$');

    await expect.poll(() => new URL(page.url()).searchParams.getAll('regex')).toEqual(['first', 'second']);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('regex-tester:regex'))).toBeNull();
    await expectInputNotPersisted(page, '^memory-only$');
  });
});
