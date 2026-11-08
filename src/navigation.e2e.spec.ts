import { expect, test } from '@playwright/test';

test('keeps back to top beside search and sponsorship last', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('isMenuCollapsed', 'true'));
  await page.goto('/settings');
  await expect(page).toHaveTitle(/Settings/);
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  const menuToggle = navigation.getByRole('button', { name: 'Toggle menu', exact: true });
  await expect(menuToggle).toHaveAttribute('aria-controls', 'tool-navigation');
  await expect(page.locator('#tool-navigation')).toHaveCount(1);
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  await menuToggle.click();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
  await menuToggle.click();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
  const controls = navigation.locator('a, button');
  await expect(controls).toHaveCount(9);
  expect(await controls.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual([
    'Toggle menu', 'Home', 'Search', 'Back to top', 'Plugin marketplace', 'Settings', 'Toggle dark/light mode', 'More', 'Buy me a coffee',
  ]);
  const search = await navigation.getByRole('button', { name: 'Search', exact: true }).boundingBox();
  const backToTop = navigation.getByRole('button', { name: 'Back to top', exact: true });
  const backBounds = await backToTop.boundingBox();
  const marketplace = await navigation.getByRole('link', { name: 'Plugin marketplace', exact: true }).boundingBox();
  expect(backBounds!.x).toBeGreaterThanOrEqual(search!.x + search!.width);
  expect(backBounds!.x - search!.x - search!.width).toBeLessThanOrEqual(12);
  expect(backBounds!.x + backBounds!.width).toBeLessThanOrEqual(marketplace!.x);
  expect(Math.abs(backBounds!.y - search!.y)).toBeLessThan(2);
  expect(await navigation.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  const sponsorGroup = navigation.locator('.navbar-sponsor-group');
  await expect(sponsorGroup).toHaveCSS('border-left-width', '1px');
  await expect(navigation.locator('.navbar-preferences')).toHaveCSS('border-left-width', '0px');
  const moreBounds = await navigation.getByRole('button', { name: 'More', exact: true }).boundingBox();
  const sponsorGroupBounds = await sponsorGroup.boundingBox();
  const sponsorBounds = await navigation.getByRole('button', { name: 'Buy me a coffee', exact: true }).boundingBox();
  expect(sponsorGroupBounds!.x).toBeGreaterThanOrEqual(moreBounds!.x + moreBounds!.width);
  expect(sponsorBounds!.x).toBeGreaterThan(sponsorGroupBounds!.x);

  await page.evaluate(() => {
    window.open = ((...args: Parameters<typeof window.open>) => {
      (window as Window & { openedSponsor?: Parameters<typeof window.open> }).openedSponsor = args;
      return null;
    }) as typeof window.open;
  });
  await navigation.getByRole('button', { name: 'Buy me a coffee', exact: true }).click();
  expect(await page.evaluate(() => (window as Window & { openedSponsor?: Parameters<typeof window.open> }).openedSponsor))
    .toEqual(['https://buymeacoffee.com/bruceblink', '_blank', 'noopener,noreferrer']);

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
  await expect(navigation.locator('a, button').last()).toHaveAttribute('aria-label', 'Buy me a coffee');
  expect(await navigation.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(navigation.getByRole('link', { name: 'Plugin marketplace', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'More', exact: true }).click();
  const themeOption = page.getByRole('menuitem', { name: /^(Light|Dark) mode$/ });
  await expect(themeOption).toBeVisible();
  const wasDark = await page.locator('html').evaluate(element => element.classList.contains('dark'));
  await themeOption.click();
  await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(!wasDark);
  await navigation.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByPlaceholder('Type to search a tool or a command...')).toBeVisible();
});

test('closes More when keyboard focus moves to the next control', async ({ page }) => {
  await page.goto('/settings');
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  const more = navigation.getByRole('button', { name: 'More', exact: true });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('menuitem', { name: 'About', exact: true })).toBeHidden();
  await expect(navigation.getByRole('button', { name: 'Buy me a coffee', exact: true })).toBeFocused();
  await expect(page).toHaveURL(/\/settings$/);
});

for (const width of [320, 390, 701, 768, 1024]) {
  test(`keeps navigation controls separate at ${width}px with the sidebar ${width > 700 ? 'open' : 'closed'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(collapsed => localStorage.setItem('isMenuCollapsed', String(collapsed)), width <= 700);
    await page.goto('/settings');
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Back to top', exact: true })).toBeInViewport();
    await expect(navigation.getByRole('button', { name: 'Buy me a coffee', exact: true })).toBeInViewport();
    const search = navigation.getByRole('button', { name: 'Search', exact: true });
    await expect(search).toBeInViewport();
    expect((await search.boundingBox())!.width).toBeGreaterThanOrEqual(36);
    if (width <= 768) {
      await expect(search.locator('.navigation-search-text')).toBeHidden();
    }
    else {
      await expect(search.locator('.navigation-search-text')).toBeVisible();
      expect(await search.locator('.navigation-search-label').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    expect(await navigation.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = await navigation.locator('a, button, .c-select-input').evaluateAll(elements => elements
      .map(element => element.getBoundingClientRect())
      .filter(rect => rect.width > 0)
      .map(rect => ({ left: rect.left, right: rect.right })));
    for (let index = 1; index < bounds.length; index++) {
      expect(bounds[index]!.left).toBeGreaterThanOrEqual(bounds[index - 1]!.right);
    }
    await search.click();
    await expect(page.getByPlaceholder('Type to search a tool or a command...')).toBeVisible();
  });
}
