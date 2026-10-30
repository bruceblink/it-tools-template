import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type CdpSession = Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>;

let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-document-listener-e2e-'));
  electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('load');
});

test.afterAll(async () => {
  try {
    await electronApp?.close();
  }
  finally {
    if (userDataDirectory) {
      await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
    }
  }
});

test('releases the Keycode Info document listener after repeated route changes', async () => {
  test.setTimeout(90_000);
  const cdp = await page.context().newCDPSession(page);
  const initialCount = await readDocumentKeydownListenerCount(cdp);
  let maximumCount = initialCount;

  for (let cycle = 0; cycle < 20; cycle += 1) {
    await openKeycodeInfo(page);
    // Tool routes intentionally commit their lightweight shell before the lazy
    // tool component is mounted. Wait for the Keycode Info component to attach
    // its listener instead of racing the async route component resolution.
    await expect
      .poll(() => readDocumentKeydownListenerCount(cdp), {
        timeout: 10_000,
        message: 'Keycode Info did not attach its document keydown listener',
      })
      .toBe(initialCount + 1);
    const activeCount = await readDocumentKeydownListenerCount(cdp);
    maximumCount = Math.max(maximumCount, activeCount);
    expect(activeCount).toBe(initialCount + 1);

    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL('app://bundle/');
    await expect.poll(() => readDocumentKeydownListenerCount(cdp)).toBe(initialCount);
  }

  console.info(`[document-listener-resource] cycles=20; keydown listeners=${initialCount} -> ${maximumCount} -> ${await readDocumentKeydownListenerCount(cdp)}`);
  await cdp.detach();
});

async function openKeycodeInfo(targetPage: Page): Promise<void> {
  await targetPage.keyboard.press('Control+k');
  const search = targetPage.getByPlaceholder('Type to search a tool or a command...');
  await search.fill('keycode info');
  await search.press('Enter');
  await expect(targetPage).toHaveURL('app://bundle/keycode-info');
}

async function readDocumentKeydownListenerCount(cdp: CdpSession): Promise<number> {
  const evaluation = await cdp.send('Runtime.evaluate', { expression: 'document', returnByValue: false });
  const objectId = evaluation.result.objectId;
  if (!objectId) {
    throw new Error('Could not observe the document event target.');
  }
  try {
    const result = await cdp.send('DOMDebugger.getEventListeners', { objectId });
    return result.listeners.filter(listener => listener.type === 'keydown').length;
  }
  finally {
    await cdp.send('Runtime.releaseObject', { objectId });
  }
}
