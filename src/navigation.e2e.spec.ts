import { expect, test } from '@playwright/test';

test('groups navigation actions and keeps back to top last on the right', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('isMenuCollapsed', 'true'));
  await page.goto('/settings');
  await expect(page).toHaveTitle(/Settings/);
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  const controls = navigation.locator('a, button');
  await expect(controls).toHaveCount(8);
  expect(await controls.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual([
    'Toggle menu', 'Home', 'Search', 'Plugin marketplace', 'Settings', 'Toggle dark/light mode', 'More', 'Back to top',
  ]);
  const search = await navigation.getByRole('button', { name: 'Search', exact: true }).boundingBox();
  const backToTop = navigation.getByRole('button', { name: 'Back to top', exact: true });
  const last = await backToTop.boundingBox();
  expect(last!.x).toBeGreaterThan(search!.x + search!.width);
  expect(Math.abs(last!.y - search!.y)).toBeLessThan(2);
  expect(await navigation.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await navigation.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByPlaceholder('Type to search a tool or a command...')).toBeVisible();
  await page.keyboard.press('Escape');

  const pane = page.locator('.content-scroll');
  await pane.evaluate(element => element.scrollTop = element.scrollHeight);
  await expect.poll(() => pane.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await backToTop.click();
  await expect.poll(() => pane.evaluate(element => element.scrollTop)).toBe(0);

  await navigation.getByRole('button', { name: 'More', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'About', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/about$/);
  await navigation.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test('keeps compact navigation usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  const backToTop = navigation.getByRole('button', { name: 'Back to top', exact: true });
  await expect(backToTop).toBeInViewport();
  await expect(navigation.locator('a, button').last()).toHaveAttribute('aria-label', 'Back to top');
  expect(await navigation.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(navigation.getByRole('link', { name: 'Plugin marketplace', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^(Light|Dark) mode$/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await navigation.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByPlaceholder('Type to search a tool or a command...')).toBeVisible();
});
