import { _electron, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('tool cards do not flash borders when returning home', async () => {
  test.setTimeout(120_000);
  // Use a temporary profile so this UI regression cannot change the developer's settings.
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-home-card-hover-e2e-'));
  const electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('load');

    const allToolsHeading = page.getByRole('heading', { name: 'All the tools' });
    await expect(allToolsHeading).toBeVisible();
    const allToolsGrid = allToolsHeading.locator('xpath=following-sibling::div[1]');
    const tokenCardLink = allToolsGrid.locator('a[href="/token-generator"]');
    const tokenCard = tokenCardLink.locator('.c-card');
    const getTokenCardBorderColor = () => tokenCard.evaluate(card => getComputedStyle(card).borderColor);
    const allToolCards = allToolsGrid.locator('a.decoration-none .c-card');
    const getAllCardBorders = () => allToolCards.evaluateAll(cards => cards.map(card => getComputedStyle(card).borderColor));
    const getAllCardHoverClasses = () => allToolCards.evaluateAll(cards => cards.map(card => card.classList.contains('!hover:border-primary')));
    const getHomeGridTransition = () => page.locator('.grid-wrapper').evaluate(grid => getComputedStyle(grid).transitionProperty);

    await page.mouse.move(0, 0);
    const restingBorderColors = await getAllCardBorders();

    for (let cycle = 0; cycle < 20; cycle += 1) {
      await tokenCardLink.click();
      await expect(page).toHaveURL('app://bundle/token-generator');
      await expect(page.getByRole('heading', { name: 'Token generator' })).toBeVisible();
      await page.getByRole('link', { name: 'Home' }).click();
      await expect(page).toHaveURL('app://bundle/');
      await expect(allToolsHeading).toBeVisible();

      expect(await getAllCardHoverClasses()).not.toContain(true);
      expect(await getAllCardBorders()).toEqual(restingBorderColors);
      const homeGridTransition = await getHomeGridTransition();
      expect(homeGridTransition).toContain('opacity');
      expect(homeGridTransition).toContain('transform');
      expect(homeGridTransition).not.toContain('border-color');
    }

    await tokenCard.hover();
    await expect(tokenCard).toHaveClass(/hover:border-primary/);
    await expect.poll(getTokenCardBorderColor).not.toBe(restingBorderColors[0]);
  }
  finally {
    try {
      await electronApp.close();
    }
    finally {
      await rm(userDataDirectory, { recursive: true, force: true });
    }
  }
});
