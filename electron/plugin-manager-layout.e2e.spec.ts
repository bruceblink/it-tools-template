import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let page: Page;
let profile: string;

test.beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), 'it-tools-plugin-layout-'));
  app = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${profile}`, '.'],
    env: { ...process.env, IT_TOOLS_HEADLESS_E2E: 'true', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
  page = await app.firstWindow();
  await expect(page).toHaveURL('app://bundle/');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL('app://bundle/settings');
});

test.afterAll(async () => {
  try {
    await app?.close();
  }
  finally {
    if (profile) {
      await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
    }
  }
});

test('keeps plugin heading and actions aligned in English and Chinese', async () => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  for (const language of ['en', 'zh']) {
    await page.evaluate(value => localStorage.setItem('locale', value), language);
    await page.reload();
    const region = page.getByRole('region', {
      name: language === 'zh' ? '桌面插件包' : 'Desktop plugin packages',
      exact: true,
    });
    for (const width of [1280, 800, 560, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await region.scrollIntoViewIfNeeded();
      await expect(region.getByRole('heading', { level: 2 })).toBeVisible();
      const heading = region.locator('.plugin-section-heading');
      const description = await heading.locator('p').boundingBox();
      const actions = heading.locator('.plugin-section-actions');
      const actionBox = await actions.boundingBox();
      const buttons = await actions.locator('a, button').all();
      expect(buttons).toHaveLength(3);
      expect(actionBox!.y).toBeGreaterThanOrEqual(description!.y + description!.height);
      const bounds = await heading.boundingBox();
      const boxes = await Promise.all(buttons.map(button => button.boundingBox()));
      for (const box of boxes) {
        expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
      }
      for (let index = 1; index < boxes.length; index++) {
        expect(boxes[index]!.y).toBeGreaterThanOrEqual(boxes[index - 1]!.y);
        if (Math.abs(boxes[index]!.y - boxes[index - 1]!.y) < 1) {
          expect(boxes[index]!.x).toBeGreaterThanOrEqual(boxes[index - 1]!.x + boxes[index - 1]!.width - 1);
        }
      }
      if (width > 560 && boxes.reduce((total, box) => total + box!.width, 16) <= actionBox!.width) {
        expect(boxes[1]!.y).toBeCloseTo(boxes[0]!.y, 0);
        expect(boxes[2]!.y).toBeCloseTo(boxes[0]!.y, 0);
      }
      else if (width <= 560) {
        expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
        expect(boxes[2]!.y).toBeCloseTo(boxes[1]!.y, 0);
      }
      expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const refresh = region.getByRole('button', { name: language === 'zh' ? '刷新' : 'Refresh', exact: true });
      await refresh.click();
      await expect(refresh).toBeEnabled();
      await expect(region.getByRole('heading', { level: 2 })).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});
