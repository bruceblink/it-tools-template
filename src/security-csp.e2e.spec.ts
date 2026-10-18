import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

type CspViolation = {
  blockedURI: string
  effectiveDirective: string
  violatedDirective: string
  disposition: string
};

declare global {
  interface Window {
    __securityCspViolations: CspViolation[]
    __securityWorkerScripts: string[]
    __securityWorkerReplies: number
  }
}

async function installSecurityAudit(page: Page) {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error' || /Could not create web worker|Falling back to loading web worker code in main thread/.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on('pageerror', error => errors.push(error.message));

  await page.addInitScript(() => {
    window.__securityCspViolations = [];
    window.__securityWorkerScripts = [];
    window.__securityWorkerReplies = 0;

    document.addEventListener('securitypolicyviolation', (event) => {
      window.__securityCspViolations.push({
        blockedURI: event.blockedURI,
        effectiveDirective: event.effectiveDirective,
        violatedDirective: event.violatedDirective,
        disposition: event.disposition,
      });
    });

    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        window.__securityWorkerScripts.push(String(args[0]));
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        // Count replies without retaining any message content from the editor model.
        worker.addEventListener('message', () => { window.__securityWorkerReplies += 1; });
        return worker;
      },
    });
  });

  return {
    async expectClean() {
      const violations = await page.evaluate(() => window.__securityCspViolations);
      expect(violations, 'the page should not report CSP violations').toEqual([]);
      expect(errors, 'the page should not report browser or runtime errors').toEqual([]);
    },
  };
}

test.describe('CSP-compatible tool behavior', () => {
  test('math evaluator computes an expression', async ({ page }) => {
    const securityAudit = await installSecurityAudit(page);
    await page.goto('/math-evaluator');

    await page.getByPlaceholder('Your math expression (ex: 2*sqrt(6) )...').fill('2 * (3 + sqrt(16))');
    await expect(page.locator('.tool-content')).toContainText('14');

    await securityAudit.expectClean();
  });

  test('hash text produces a deterministic SHA-256 digest', async ({ page }) => {
    const securityAudit = await installSecurityAudit(page);
    const message = 'CSP-compatible SHA-256 input';
    const expectedDigest = createHash('sha256').update(message).digest('hex');
    await page.goto('/hash-text');

    const input = page.getByLabel('Your text to hash:');
    const sha256Output = page
      .locator('.n-input-group')
      .filter({ hasText: 'SHA256 (256 bits / 32 bytes)' })
      .locator('input')
      .last();

    await input.fill(message);
    await expect(sha256Output).toHaveValue(expectedDigest);
    await input.fill(message);
    await expect(sha256Output).toHaveValue(expectedDigest);

    await securityAudit.expectClean();
  });

  test('TOML parses into JSON without CSP errors', async ({ page }) => {
    const securityAudit = await installSecurityAudit(page);
    await page.goto('/toml-to-json');

    await page.getByTestId('input').fill('message = "CSP-compatible TOML"\n[worker]\nname = "Monaco"');
    await expect(page.getByTestId('area-content')).toContainText('"message": "CSP-compatible TOML"');
    await expect(page.getByTestId('area-content')).toContainText('"name": "Monaco"');

    await securityAudit.expectClean();
  });

  test('text diff edits both inputs and renders changes without CSP errors', async ({ page }) => {
    const securityAudit = await installSecurityAudit(page);
    await page.goto('/text-diff');

    const original = page.getByLabel('Original text');
    const modified = page.getByLabel('Modified text');
    await expect(original).toBeVisible();
    await expect(modified).toBeVisible();
    await original.fill('same line\noriginal CSP text');
    await modified.fill('same line\nmodified CSP text');

    await expect(page.locator('.diff-removed')).toContainText('original CSP text');
    await expect(page.locator('.diff-added')).toContainText('modified CSP text');

    await securityAudit.expectClean();
  });

  test('home renders and updates its draggable favorites list', async ({ page }) => {
    const securityAudit = await installSecurityAudit(page);
    await page.goto('/');

    const allToolsHeading = page.getByRole('heading', { name: 'All the tools' });
    await expect(allToolsHeading).toBeVisible();
    const allToolsGrid = allToolsHeading.locator('xpath=following-sibling::div[1]');
    const mathToolCard = allToolsGrid.locator('a[href="/math-evaluator"]');
    await expect(mathToolCard).toHaveCount(1);
    await mathToolCard.getByRole('button').click();

    const favoritesHeading = page.getByRole('heading', { name: 'Your favorite tools' });
    await expect(favoritesHeading).toBeVisible();
    const favoritesSection = favoritesHeading.locator('xpath=..');
    const favoriteMathToolCard = favoritesSection.locator('a[href="/math-evaluator"]');
    await expect(favoriteMathToolCard).toBeVisible();
    await favoriteMathToolCard.getByRole('button').click();
    await expect(favoritesHeading).toHaveCount(0);
    await expect(favoriteMathToolCard).toHaveCount(0);

    await securityAudit.expectClean();
  });

  test('RSA key generation returns public and private PEM values', async ({ page }) => {
    const securityAudit = await installSecurityAudit(page);
    await page.goto('/rsa-key-pair-generator');

    const pemValues = page.getByTestId('area-content');
    await expect(pemValues.nth(0)).toContainText('-----BEGIN PUBLIC KEY-----', { timeout: 20_000 });
    await expect(pemValues.nth(1)).toContainText('-----BEGIN RSA PRIVATE KEY-----', { timeout: 20_000 });

    await securityAudit.expectClean();
  });

  test('QR code renders as a data image', async ({ page }) => {
    const securityAudit = await installSecurityAudit(page);
    await page.goto('/qrcode-generator');

    await page.getByLabel('Text:').fill('https://example.test/csp-qr');
    const image = page.locator('.n-image img');
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth), { timeout: 5_000 })
      .toBeGreaterThan(0);

    await securityAudit.expectClean();
  });

  test('ASCII text drawer loads its font over HTTPS under CSP', async ({ page }) => {
    const securityAudit = await installSecurityAudit(page);
    const fontUrl = 'https://unpkg.com/figlet@1.6.0/fonts/Standard.flf';
    const httpFontUrl = fontUrl.replace('https://', 'http://');
    const httpsFontRequests: string[] = [];
    const httpFontRequests: string[] = [];
    // This real local font is browser test data; the test never contacts the third-party font service.
    const font = readFileSync(new URL('../node_modules/figlet/fonts/Standard.flf', import.meta.url), 'utf8');

    await page.route(httpFontUrl, async (route) => {
      httpFontRequests.push(route.request().url());
      await route.abort('blockedbyclient');
    });
    await page.route(fontUrl, async (route) => {
      httpsFontRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        body: font,
        contentType: 'text/plain; charset=utf-8',
        headers: { 'access-control-allow-origin': '*' },
      });
    });

    await page.goto('/ascii-text-drawer');
    const input = page.getByLabel('Your text:');
    const output = page.getByTestId('area-content');
    await expect(output).toBeVisible();
    await input.fill('CSP');
    await expect(input).toHaveValue('CSP');
    await expect.poll(() => httpsFontRequests.length + httpFontRequests.length).toBeGreaterThan(0);

    expect(httpsFontRequests).toContain(fontUrl);
    expect(httpFontRequests).toEqual([]);
    const expectedArt = '   ____ ____  ____  \n  / ___/ ___||  _ \\ \n | |   \\___ \\| |_) |\n | |___ ___) |  __/ \n  \\____|____/|_|    \n                    ';
    await expect(output).toHaveText(expectedArt);

    await securityAudit.expectClean();
  });

  test('PWA registers an active same-origin service worker in a secure context', async ({ page }) => {
    const securityAudit = await installSecurityAudit(page);
    await page.goto('/');

    const environment = await page.evaluate(() => ({
      secure: window.isSecureContext,
      supportsServiceWorkers: 'serviceWorker' in navigator,
    }));
    expect(environment.secure).toBe(true);
    expect(environment.supportsServiceWorkers).toBe(true);

    await expect.poll(
      () => page.evaluate(async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        return registrations.map((registration) => {
          const workers = [registration.installing, registration.waiting, registration.active]
            .filter((worker): worker is ServiceWorker => worker !== null);
          return {
            sameOrigin: new URL(registration.scope).origin === location.origin
              && workers.some(worker => new URL(worker.scriptURL).origin === location.origin),
            installing: registration.installing?.state ?? null,
            waiting: registration.waiting?.state ?? null,
            active: registration.active?.state ?? null,
          };
        });
      }),
      { timeout: 15_000 },
    ).toContainEqual(expect.objectContaining({ sameOrigin: true, active: 'activated' }));

    await securityAudit.expectClean();
  });
});
