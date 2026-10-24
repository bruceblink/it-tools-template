import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;

test.beforeAll(async () => {
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-system-monitor-e2e-'));
  electronApp = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${userDataDirectory}`, '.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 60_000,
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('load');
  await expect(page).toHaveURL('app://bundle/', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: /Search/i })).toBeVisible({ timeout: 60_000 });
});

test.afterAll(async () => {
  try {
    await electronApp?.close();
  }
  finally {
    if (userDataDirectory) {
      await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }
});

test.beforeEach(async () => {
  await gotoApp('app://bundle/system-monitor');
  await expect(page.locator('[data-test-id="system-monitor-workspace"]')).toBeVisible();
});

test('renders live CPU and memory cards and pauses/resumes with a gap marker', async () => {
  await expect(page.locator('[data-test-id="system-monitor-status"]')).toContainText(/Warming up|Sampling/, { timeout: 6_000 });
  await expect(page.locator('[data-test-id="system-monitor-cpu-trend"] span').first()).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('[data-test-id="system-monitor-memory-card"]')).toBeVisible();
  await expect(page.locator('[data-test-id="system-monitor-disk-card"]')).toBeVisible();
  await expect(page.locator('[data-test-id="system-monitor-network-card"]')).toBeVisible();
  await expect(page.locator('[data-test-id="system-monitor-process-list-card"]')).toBeVisible();
  await expect(page.locator('[data-test-id="system-monitor-process-search"]')).toBeVisible();

  await page.getByTestId('system-monitor-pause').click();
  await expect(page.getByTestId('system-monitor-status')).toContainText('Sampling paused');
  await page.waitForTimeout(1_300);
  await page.getByTestId('system-monitor-pause').click();
  await expect(page.getByTestId('system-monitor-status')).toContainText(/Warming up|Sampling/);
  await expect(page.getByTestId('system-monitor-gap')).toBeVisible({ timeout: 6_000 });
});

test('delivers bounded samples through the trusted bridge and releases the subscription', async () => {
  await gotoApp('app://bundle/');
  const result = await page.evaluate(async () => {
    const bridge = window.itToolsDesktop;
    if (!bridge?.startSystemMonitor || !bridge.onSystemMonitorSample) {
      return { supported: false } as const;
    }
    const samples: Array<{ sequence: number; gapBefore: boolean; cpu: number | null }> = [];
    const unsubscribe = bridge.onSystemMonitorSample(sample => {
      samples.push({ sequence: sample.sequence, gapBefore: sample.gapBefore, cpu: sample.cpu.system.value });
    });
    const wait = (duration: number) => new Promise(resolve => setTimeout(resolve, duration));
    const started = await bridge.startSystemMonitor(1_000);
    if (!started.ok) {
      unsubscribe();
      return { supported: true, started: false, error: started.error } as const;
    }
    await wait(2_300);
    const beforePause = samples.length;
    const paused = await bridge.setSystemMonitorPaused?.(started.value.subscriptionId, true);
    await wait(1_300);
    const afterPause = samples.length;
    const resumed = await bridge.setSystemMonitorPaused?.(started.value.subscriptionId, false);
    const gapDeadline = Date.now() + 4_000;
    while (Date.now() < gapDeadline && !samples.some(sample => sample.gapBefore)) {
      await wait(100);
    }
    const stopped = await bridge.stopSystemMonitor?.(started.value.subscriptionId);
    const beforeStopWait = samples.length;
    await wait(1_200);
    unsubscribe();
    return {
      supported: true,
      started: true,
      paused: paused?.ok === true,
      resumed: resumed?.ok === true,
      stopped: stopped?.ok === true,
      beforePause,
      afterPause,
      sampleCount: samples.length,
      beforeStopWait,
      hasGap: samples.some(sample => sample.gapBefore),
      hasCpuValue: samples.some(sample => sample.cpu !== null),
    } as const;
  });

  expect(result).toMatchObject({
    supported: true,
    started: true,
    paused: true,
    resumed: true,
    stopped: true,
    hasGap: true,
    hasCpuValue: true,
  });
  if ('beforePause' in result && 'afterPause' in result && 'beforeStopWait' in result && 'sampleCount' in result) {
    expect(result.afterPause).toBe(result.beforePause);
    expect(result.sampleCount).toBe(result.beforeStopWait);
  }
});

test('cleans subscriptions across repeated route switches', async () => {
  test.setTimeout(60_000);
  for (let index = 0; index < 20; index += 1) {
    await gotoApp('app://bundle/');
    await gotoApp('app://bundle/system-monitor');
    await expect(page.locator('[data-test-id="system-monitor-workspace"]')).toBeVisible();
  }
  await gotoApp('app://bundle/');
  await expect(page.locator('[data-test-id="system-monitor-workspace"]')).toHaveCount(0);
});

async function gotoApp(url: string): Promise<void> {
  try {
    await page.goto(url);
  }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes('ERR_ABORTED')) {
      throw error;
    }
  }
  await expect(page).toHaveURL(url);
}
