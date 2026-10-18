import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { BrowserWindow as BrowserWindowType, LoadURLOptions } from 'electron';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPluginPackageSigningPayload } from './plugin-package';

const pluginId = 'org.example.manager-e2e';
const keyId = 'manager-e2e-publisher';
const signingPair = generateKeyPairSync('ed25519');
let electronApp: ElectronApplication;
let page: Page;
let temporaryDirectory: string;
let userDataDirectory: string;
let archivePath: string;
let upgradeArchivePath: string;
let unresponsiveArchivePath: string;
let crashArchivePath: string;

test.beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-manager-e2e-'));
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-manager-profile-'));
  archivePath = join(temporaryDirectory, 'manager-e2e.itplugin');
  upgradeArchivePath = join(temporaryDirectory, 'manager-e2e-upgrade.itplugin');
  unresponsiveArchivePath = join(temporaryDirectory, 'manager-e2e-unresponsive.itplugin');
  crashArchivePath = join(temporaryDirectory, 'manager-e2e-crash.itplugin');
  await writeFile(archivePath, createSignedPackage());
  await writeFile(upgradeArchivePath, createSignedPackage('2.0.0'));
  await writeFile(unresponsiveArchivePath, createSignedPackage('3.0.0', true));
  await writeFile(crashArchivePath, createSignedPackage('4.0.0'));
  const fixtureDirectory = process.env.IT_TOOLS_PLUGIN_MANAGER_FIXTURE_DIR;
  if (fixtureDirectory) {
    await mkdir(fixtureDirectory, { recursive: true });
    await writeFile(join(fixtureDirectory, 'manager-e2e.itplugin'), createSignedPackage());
    await writeFile(join(fixtureDirectory, 'manager-e2e-public-key.pem'), getPackagePublicKey());
  }

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
    const directories = [temporaryDirectory, userDataDirectory].filter((directory): directory is string => Boolean(directory));
    const cleanupResults = await Promise.allSettled(directories.map(directory => rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 250,
    })));
    const cleanupFailure = cleanupResults.find(result => result.status === 'rejected');
    if (cleanupFailure?.status === 'rejected') {
      throw cleanupFailure.reason;
    }
  }
});

test('trusts a signer, installs a package, applies a capability grant, revokes, and uninstalls', async ({}, testInfo) => {
  test.setTimeout(90_000);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('app://bundle/settings');
  await electronApp.evaluate(({ dialog }, selectedPackagePath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPackagePath] }),
    });
    Object.defineProperty(dialog, 'showMessageBox', {
      configurable: true,
      value: async () => ({ response: 0 }),
    });
  }, archivePath);

  await page.getByLabel('Signer key ID').fill(keyId);
  await page.getByLabel('Allowed plugin IDs, separated by commas').fill(pluginId);
  await page.getByLabel('Ed25519 public key (PEM)').fill(getPackagePublicKey());
  await page.getByRole('button', { name: 'Preview fingerprint' }).click();
  const fingerprint = page.locator('.signer-preview code');
  await expect(fingerprint).toContainText('SHA256:');
  await page.getByRole('button', { name: 'Trust this signer' }).click();
  await expect(page.getByText('Signer key added. Plugin capabilities still require separate approval.')).toBeVisible();

  await page.getByRole('button', { name: 'Install signed package' }).click();
  await expect(page.getByTestId(`plugin-package-${pluginId}-1.0.0`)).toBeVisible();
  await expect(page.getByText('Installed', { exact: true })).toBeVisible();

  const runtimeGrant = page.getByTestId(`plugin-package-${pluginId}-1.0.0`)
    .getByRole('checkbox', { name: 'Read platform and app version' });
  await runtimeGrant.check();
  await electronApp.evaluate(({ dialog }) => {
    Object.defineProperty(dialog, 'showMessageBox', {
      configurable: true,
      value: async () => ({ response: 1 }),
    });
  });
  await page.getByRole('button', { name: 'Run plugin' }).click();
  await expect(page.getByText('Plugin window started.')).toBeVisible();
  await expect.poll(async () => (
    await electronApp.windows()
  ).filter(window => window.url().startsWith(`it-plugin://${pluginId}/`)).length).toBe(1);
  const deniedWindow = (await electronApp.windows()).find(window => window.url().startsWith(`it-plugin://${pluginId}/`));
  expect(deniedWindow).toBeDefined();
  if (!deniedWindow) {
    throw new Error('The plugin window was not created after capability denial.');
  }
  await expect(deniedWindow.locator('#runtime-proof')).toHaveText('Unavailable');
  await expect(deniedWindow.locator('#clipboard-proof')).toHaveText('Not authorized');
  const deniedWindowClosed = deniedWindow.waitForEvent('close');
  await page.getByRole('button', { name: 'Stop plugin' }).click();
  await deniedWindowClosed;
  await expect(page.getByText('Installed', { exact: true })).toBeVisible();

  await electronApp.evaluate(({ dialog }) => {
    Object.defineProperty(dialog, 'showMessageBox', {
      configurable: true,
      value: async () => ({ response: 0 }),
    });
  });
  await runtimeGrant.check();
  await page.getByRole('button', { name: 'Run plugin' }).click();
  await expect(page.getByText('Plugin window started.')).toBeVisible();
  await expect.poll(async () => (
    await electronApp.windows()
  ).filter(window => window.url().startsWith(`it-plugin://${pluginId}/`)).length).toBe(1);
  const pluginWindow = (await electronApp.windows()).find(window => window.url().startsWith(`it-plugin://${pluginId}/`));
  expect(pluginWindow).toBeDefined();
  if (!pluginWindow) {
    throw new Error('The plugin window was not created.');
  }
  const capabilityToast = pluginWindow.getByRole('status');
  await expect(capabilityToast).toBeVisible();
  await expect(capabilityToast).toHaveCSS('position', 'fixed');
  await expect(capabilityToast).toHaveCSS('border-radius', '14px');
  await expect(pluginWindow.locator('#runtime-proof')).toHaveText('Available');
  await expect(pluginWindow.locator('#clipboard-proof')).toHaveText('Not authorized');
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await pluginWindow.evaluate(() => localStorage.setItem('rollback-proof', 'version-1'));
  await pluginWindow.getByRole('button', { name: 'Dismiss capability status' }).click();
  await expect(pluginWindow.getByRole('status')).toBeHidden();

  await electronApp.evaluate(({ dialog }, selectedPackagePath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPackagePath] }),
    });
  }, upgradeArchivePath);
  await page.getByRole('button', { name: 'Install signed package' }).click();
  await expect(page.getByTestId(`plugin-package-${pluginId}-2.0.0`)).toBeVisible();
  await electronApp.evaluate(({ BrowserWindow }) => {
    const originalLoadURL = BrowserWindow.prototype.loadURL as (
      this: BrowserWindowType,
      url: string,
      options?: LoadURLOptions,
    ) => Promise<void>;
    let failNextPluginLoad = true;
    Object.defineProperty(BrowserWindow.prototype, 'loadURL', {
      configurable: true,
      value: function (this: BrowserWindowType, url: string, options?: LoadURLOptions) {
        if (failNextPluginLoad && String(url).startsWith('it-plugin://org.example.manager-e2e/')) {
          failNextPluginLoad = false;
          return Promise.reject(new Error('Injected plugin upgrade failure.'));
        }
        return originalLoadURL.call(this, url, options);
      },
    });
  });
  const originalWindowClosed = pluginWindow.waitForEvent('close');
  await page.getByTestId(`plugin-package-${pluginId}-2.0.0`).getByRole('button', { name: 'Run plugin' }).click();
  await originalWindowClosed;
  const pluginManager = page.getByRole('region', { name: 'Electron plugin packages' });
  await expect(pluginManager.getByRole('alert')).toContainText('The package did not start. The previous version remains available.');
  await expect.poll(async () => (
    await electronApp.windows()
  ).filter(window => window.url().startsWith(`it-plugin://${pluginId}/`)).length).toBe(1);
  const rolledBackWindow = (await electronApp.windows()).find(window => window.url().startsWith(`it-plugin://${pluginId}/`));
  expect(rolledBackWindow).toBeDefined();
  if (!rolledBackWindow) {
    throw new Error('The previous plugin version was not restored.');
  }
  await expect(rolledBackWindow.locator('#runtime-proof')).toHaveText('Available');
  await expect.poll(async () => rolledBackWindow.evaluate(() => localStorage.getItem('rollback-proof'))).toBe('version-1');
  await expect(page.getByTestId(`plugin-package-${pluginId}-1.0.0`).getByText('Running')).toBeVisible();
  await expect(page.getByTestId(`plugin-package-${pluginId}-2.0.0`).getByText('Installed')).toBeVisible();

  const rollbackWindowClosed = rolledBackWindow.waitForEvent('close');
  await page.getByTestId(`plugin-package-${pluginId}-1.0.0`).getByRole('button', { name: 'Stop plugin' }).click();
  await rollbackWindowClosed;
  await expect(page.getByTestId(`plugin-package-${pluginId}-1.0.0`).getByText('Installed')).toBeVisible();

  await runtimeGrant.check();
  await page.getByTestId(`plugin-package-${pluginId}-1.0.0`).getByRole('button', { name: 'Run plugin' }).click();
  await expect(page.getByText('Plugin window started.')).toBeVisible();
  await expect.poll(async () => (
    await electronApp.windows()
  ).filter(window => window.url().startsWith(`it-plugin://${pluginId}/`)).length).toBe(1);
  const revokedWindow = (await electronApp.windows()).find(window => window.url().startsWith(`it-plugin://${pluginId}/`));
  expect(revokedWindow).toBeDefined();
  if (!revokedWindow) {
    throw new Error('The reactivated plugin window was not created.');
  }
  await expect(revokedWindow.getByRole('status')).toBeVisible();
  await expect(revokedWindow.locator('#runtime-proof')).toHaveText('Available');

  await electronApp.evaluate(({ dialog }, selectedPackagePath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPackagePath] }),
    });
  }, unresponsiveArchivePath);
  await page.getByRole('button', { name: 'Install signed package' }).click();
  await expect(page.getByTestId(`plugin-package-${pluginId}-3.0.0`)).toBeVisible();
  const replacedWindowClosed = revokedWindow.waitForEvent('close');
  await page.getByTestId(`plugin-package-${pluginId}-3.0.0`).getByRole('button', { name: 'Run plugin' }).click();
  await expect(page.getByText('Plugin window started.')).toBeVisible();
  await replacedWindowClosed;
  await expect.poll(async () => (
    await electronApp.windows()
  ).filter(window => window.url().startsWith(`it-plugin://${pluginId}/`)).length).toBe(1);
  const unresponsiveWindow = (await electronApp.windows()).find(window => window.url().startsWith(`it-plugin://${pluginId}/`));
  expect(unresponsiveWindow).toBeDefined();
  if (!unresponsiveWindow) {
    throw new Error('The unresponsive plugin window was not created.');
  }
  const unresponsiveWindowClosed = unresponsiveWindow.waitForEvent('close', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await unresponsiveWindowClosed;
  await page.reload();
  await expect(page).toHaveURL('app://bundle/settings');
  await expect(page.getByTestId(`plugin-package-${pluginId}-3.0.0`).getByText('Installed')).toBeVisible();

  await electronApp.evaluate(({ dialog }, selectedPackagePath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPackagePath] }),
    });
  }, crashArchivePath);
  await page.getByRole('button', { name: 'Install signed package' }).click();
  await expect(page.getByTestId(`plugin-package-${pluginId}-4.0.0`)).toBeVisible();
  await page.getByTestId(`plugin-package-${pluginId}-4.0.0`).getByRole('button', { name: 'Run plugin' }).click();
  await expect(page.getByText('Plugin window started.')).toBeVisible();
  await expect.poll(async () => (
    await electronApp.windows()
  ).filter(window => window.url().startsWith(`it-plugin://${pluginId}/`)).length).toBe(1);
  const crashedWindow = (await electronApp.windows()).find(window => window.url().startsWith(`it-plugin://${pluginId}/`));
  expect(crashedWindow).toBeDefined();
  if (!crashedWindow) {
    throw new Error('The plugin window for renderer crash recovery was not created.');
  }
  const readRendererResources = () => electronApp.evaluate(({ app, BrowserWindow }, targetPluginId) => {
    const hostWindow = BrowserWindow.getAllWindows().find(window => (
      window.webContents.getURL().startsWith('app://bundle/')
    ));
    const pluginWindow = BrowserWindow.getAllWindows().find(window => (
      window.webContents.getURL().startsWith(`it-plugin://${targetPluginId}/`)
    ));
    if (!hostWindow || !pluginWindow) {
      throw new Error('The host or plugin BrowserWindow disappeared before resource sampling.');
    }
    const hostRendererPid = hostWindow.webContents.getOSProcessId();
    const pluginRendererPid = pluginWindow.webContents.getOSProcessId();
    const appProcessMetrics = app.getAppMetrics();
    const hostProcessMetric = appProcessMetrics.find(metric => metric.pid === hostRendererPid);
    const pluginProcessMetric = appProcessMetrics.find(metric => metric.pid === pluginRendererPid);
    if (!hostProcessMetric || !pluginProcessMetric) {
      throw new Error('Electron did not return a process metric for the plugin renderer.');
    }
    return {
      sampledAt: new Date().toISOString(),
      platform: process.platform,
      architecture: process.arch,
      electronVersion: process.versions.electron,
      hostRendererPid,
      pluginRendererPid,
      hostRendererCpu: hostProcessMetric.cpu,
      hostRendererMemoryKiB: hostProcessMetric.memory,
      pluginRendererCpu: pluginProcessMetric.cpu,
      pluginRendererMemoryKiB: pluginProcessMetric.memory,
      appProcessCount: appProcessMetrics.length,
      appProcessMetrics: appProcessMetrics.map(metric => ({
        pid: metric.pid,
        type: metric.type,
        name: metric.name ?? null,
        cpu: metric.cpu,
        memoryKiB: metric.memory,
      })),
    };
  }, pluginId);
  const rendererResourceSamples = [await readRendererResources()];
  for (let sampleIndex = 1; sampleIndex < 5; sampleIndex += 1) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    rendererResourceSamples.push(await readRendererResources());
  }
  const initialResourceSample = rendererResourceSamples[0]!;
  const retainedBytes = 32 * 1024 * 1024;
  const retainedByteLength = await crashedWindow.evaluate((byteLength) => {
    // Touch and retain the buffer so Electron reports committed renderer pages.
    const retainedBuffer = new Uint8Array(byteLength);
    retainedBuffer.fill(0x5a);
    Reflect.set(window, '__itToolsResourceProbe', retainedBuffer);
    return retainedBuffer.byteLength;
  }, retainedBytes);
  expect(retainedByteLength).toBe(retainedBytes);
  const memoryPressureSamples = [];
  for (let sampleIndex = 0; sampleIndex < 3; sampleIndex += 1) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    memoryPressureSamples.push(await readRendererResources());
  }
  const baselineWorkingSetKiB = Math.min(...rendererResourceSamples.map(sample => (
    sample.pluginRendererMemoryKiB.workingSetSize
  )));
  const memoryPressureWorkingSetKiB = Math.max(...memoryPressureSamples.map(sample => (
    sample.pluginRendererMemoryKiB.workingSetSize
  )));
  expect(memoryPressureWorkingSetKiB).toBeGreaterThan(baselineWorkingSetKiB + 8_192);
  const rendererResources = {
    scenario: 'idle and retained-memory signed plugin renderer before forced termination',
    pluginArchiveBytes: (await stat(crashArchivePath)).size,
    sampleIntervalMs: 1_000,
    idleSamples: rendererResourceSamples,
    memoryPressure: {
      retainedBytes,
      samples: memoryPressureSamples,
      workingSetIncreaseKiB: memoryPressureWorkingSetKiB - baselineWorkingSetKiB,
    },
  };
  expect(initialResourceSample.pluginRendererPid).not.toBe(initialResourceSample.hostRendererPid);
  expect(rendererResourceSamples.every(sample => (
    sample.pluginRendererPid === initialResourceSample.pluginRendererPid
    && sample.hostRendererPid === initialResourceSample.hostRendererPid
  ))).toBe(true);
  expect(memoryPressureSamples.every(sample => (
    sample.pluginRendererPid === initialResourceSample.pluginRendererPid
    && sample.hostRendererPid === initialResourceSample.hostRendererPid
  ))).toBe(true);
  expect(rendererResourceSamples.every(sample => [
    sample.pluginRendererMemoryKiB.privateBytes ?? 0,
    sample.pluginRendererMemoryKiB.workingSetSize,
    sample.pluginRendererMemoryKiB.peakWorkingSetSize,
  ].some(value => value > 0))).toBe(true);
  await testInfo.attach('plugin-renderer-resource-sample.json', {
    body: JSON.stringify(rendererResources, null, 2),
    contentType: 'application/json',
  });
  const summarizeResourceSample = (sample: typeof initialResourceSample) => ({
    sampledAt: sample.sampledAt,
    pluginRendererCpuPercent: sample.pluginRendererCpu.percentCPUUsage,
    pluginRendererMemoryKiB: sample.pluginRendererMemoryKiB,
    appProcessCount: sample.appProcessCount,
    appProcessWorkingSetSumKiB: sample.appProcessMetrics.reduce(
      (total, metric) => total + metric.memoryKiB.workingSetSize,
      0,
    ),
    appProcessPrivateBytesSumKiB: sample.appProcessMetrics.reduce(
      (total, metric) => total + (metric.memoryKiB.privateBytes ?? 0),
      0,
    ),
  });
  console.log('Plugin renderer resource sample:', JSON.stringify({
    scenario: rendererResources.scenario,
    pluginArchiveBytes: rendererResources.pluginArchiveBytes,
    idleSamples: rendererResourceSamples.map(summarizeResourceSample),
    retainedBytes,
    memoryPressureWorkingSetIncreaseKiB: rendererResources.memoryPressure.workingSetIncreaseKiB,
    memoryPressureSamples: memoryPressureSamples.map(summarizeResourceSample),
  }));
  const rendererCrashed = crashedWindow.waitForEvent('crash', { timeout: 10_000 });
  await electronApp.evaluate(({ BrowserWindow }, targetPluginId) => {
    const pluginWindow = BrowserWindow.getAllWindows().find(window => (
      window.webContents.getURL().startsWith(`it-plugin://${targetPluginId}/`)
    ));
    if (!pluginWindow) {
      throw new Error('The plugin BrowserWindow disappeared before the renderer crash test.');
    }
    pluginWindow.webContents.forcefullyCrashRenderer();
  }, pluginId);
  await rendererCrashed;
  await expect.poll(async () => electronApp.evaluate(({ BrowserWindow }, targetPluginId) => (
    BrowserWindow.getAllWindows().some((window) => {
      if (window.isDestroyed()) {
        return false;
      }
      const webContents = window.webContents;
      return Boolean(
        webContents
        && !webContents.isDestroyed()
        && webContents.getURL().startsWith(`it-plugin://${targetPluginId}/`),
      );
    })
  ), pluginId)).toBe(false);
  await expect.poll(async () => electronApp.evaluate(({ app }, processId) => (
    app.getAppMetrics().some(metric => metric.pid === processId)
  ), initialResourceSample.pluginRendererPid)).toBe(false);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId(`plugin-package-${pluginId}-4.0.0`).getByText('Installed')).toBeVisible();

  await page.getByTestId(`plugin-package-${pluginId}-1.0.0`).getByRole('button', { name: 'Run plugin' }).click();
  await expect(page.getByText('Plugin window started.')).toBeVisible();
  await expect.poll(async () => (
    await electronApp.windows()
  ).filter(window => window.url().startsWith(`it-plugin://${pluginId}/`)).length).toBe(1);
  const windowForRevocation = (await electronApp.windows()).find(window => window.url().startsWith(`it-plugin://${pluginId}/`));
  expect(windowForRevocation).toBeDefined();
  if (!windowForRevocation) {
    throw new Error('The plugin window for signer revocation was not created.');
  }
  const revokedWindowClosed = windowForRevocation.waitForEvent('close');
  await page.getByRole('button', { name: 'Revoke signer' }).click();
  await revokedWindowClosed;
  await expect(page.getByTestId(`plugin-package-${pluginId}-1.0.0`).getByText('Invalid or untrusted', { exact: true })).toBeVisible();
  await expect(page.getByTestId(`plugin-package-${pluginId}-2.0.0`).getByText('Invalid or untrusted', { exact: true })).toBeVisible();
  await expect(page.getByTestId(`plugin-package-${pluginId}-3.0.0`).getByText('Invalid or untrusted', { exact: true })).toBeVisible();
  await expect(page.getByTestId(`plugin-package-${pluginId}-4.0.0`).getByText('Invalid or untrusted', { exact: true })).toBeVisible();

  await page.getByTestId(`plugin-package-${pluginId}-1.0.0`).getByRole('button', { name: 'Uninstall version' }).click();
  await expect(page.getByTestId(`plugin-package-${pluginId}-1.0.0`)).toBeHidden();
  await page.getByTestId(`plugin-package-${pluginId}-2.0.0`).getByRole('button', { name: 'Uninstall version' }).click();
  await page.getByTestId(`plugin-package-${pluginId}-3.0.0`).getByRole('button', { name: 'Uninstall version' }).click();
  await page.getByTestId(`plugin-package-${pluginId}-4.0.0`).getByRole('button', { name: 'Uninstall version' }).click();
  await expect(page.getByText('No external plugin packages are installed.')).toBeVisible();
  await expect(page.getByText('No signer keys are trusted. Add a publisher key before installing its packages.')).toBeVisible();
});

function getPackagePublicKey(): string {
  return signingPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

function createSignedPackage(version = '1.0.0', freezeRenderer = false): Buffer {
  const files = {
    'index.html': [
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
      '<link rel="stylesheet" href="/styles.css"></head><body>',
      '<section id="capability-toast" class="toast" role="status" aria-live="polite" aria-atomic="true" hidden>',
      '<header class="head"><h1 class="title">Capability check</h1><button class="dismiss" type="button" aria-label="Dismiss capability status">×</button></header>',
      '<p class="description">Results for this plugin session</p><dl class="list">',
      '<div class="row"><dt>Runtime information</dt><dd id="runtime-proof" class="result" data-state="pending">Checking</dd></div>',
      '<div class="row"><dt>Clipboard write</dt><dd id="clipboard-proof" class="result" data-state="pending">Checking</dd></div>',
      '</dl></section><script src="/plugin.js"></script></body></html>',
    ].join(''),
    'styles.css': [
      ':root{color-scheme:light;font-family:"Segoe UI",sans-serif;color:#1f2937;background:#f4f6f8}',
      'body{margin:0;min-height:100vh}',
      '.toast{position:fixed;top:24px;right:24px;width:min(380px,calc(100vw - 48px));padding:20px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;box-shadow:0 16px 40px #0f172324}',
      '.toast[hidden]{display:none}',
      '.head,.row{display:flex;align-items:center;justify-content:space-between;gap:16px}',
      '.title{margin:0;font-size:16px;font-weight:650}',
      '.description{margin:6px 0 16px;color:#64748b;font-size:13px;line-height:1.5}',
      '.dismiss{display:grid;width:32px;height:32px;place-items:center;border:0;border-radius:8px;background:transparent;color:#64748b;cursor:pointer;font-size:20px}',
      '.dismiss:hover{color:#111827;background:#f1f5f9}',
      '.list{display:grid;gap:10px;margin:0}',
      '.row{min-height:38px;padding:0 12px;border-radius:9px;background:#f8fafc;font-size:13px}',
      '.result{color:#166534;font-weight:600}',
      '.result[data-state="blocked"]{color:#9a3412}',
      '.result[data-state="unexpected"]{color:#a16207}',
      '@media(prefers-reduced-motion:no-preference){.toast:not([hidden]){animation:enter 180ms ease-out}@keyframes enter{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}}',
    ].join('\n'),
    'plugin.js': [
      'async function call(id, capability, operation, input) {',
      '  const response = await fetch("/__it_tools/v1/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, capability, operation, input }) });',
      '  return { status: response.status, body: await response.json() };',
      '}',
      'const toast = document.querySelector("#capability-toast"); let completed = 0;',
      'function finish(id, value, state) { const output = document.querySelector(id); output.textContent = value; output.dataset.state = state; completed += 1; if (completed === 2) toast.hidden = false; }',
      'document.querySelector(".dismiss").addEventListener("click", () => { toast.hidden = true; });',
      'void call("runtime", "runtime.info", "read", {}).then(({ status, body }) => { const granted = status === 200 && body.ok; finish("#runtime-proof", granted ? "Available" : "Unavailable", granted ? "granted" : "blocked"); }).catch(() => finish("#runtime-proof", "Unavailable", "blocked"));',
      'void call("clipboard", "clipboard.write", "writeText", { text: "test" }).then(({ status, body }) => { const denied = status === 403 && body.error === "permission-denied"; finish("#clipboard-proof", denied ? "Not authorized" : "Unexpected response", denied ? "blocked" : "unexpected"); }).catch(() => finish("#clipboard-proof", "Unavailable", "blocked"));',
      ...(freezeRenderer ? ['setTimeout(() => { while (true) {} }, 500);'] : []),
    ].join('\n'),
  };
  const manifestFiles = Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, contents]) => ({ path, sha256: createHash('sha256').update(contents).digest('hex') }));
  const unsignedManifest = {
    formatVersion: 1 as const,
    id: pluginId,
    name: 'Manager e2e plugin',
    version,
    apiVersion: { minInclusive: '1.0.0', maxExclusive: '2.0.0' },
    entrypoint: 'index.html',
    requestedCapabilities: ['runtime.info', 'clipboard.write'],
    files: manifestFiles,
  };
  const signature = sign(
    null,
    Buffer.from(getPluginPackageSigningPayload(unsignedManifest), 'utf8'),
    signingPair.privateKey,
  ).toString('base64');
  const manifest = {
    ...unsignedManifest,
    signature: { algorithm: 'Ed25519', keyId, value: signature },
  };
  return makeStoredZip([
    { path: 'plugin.json', contents: JSON.stringify(manifest) },
    ...Object.entries(files).map(([path, contents]) => ({ path, contents })),
  ]);
}

function makeStoredZip(entries: readonly { path: string; contents: string }[]): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const contents = Buffer.from(entry.contents, 'utf8');
    const checksum = crc32(contents);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(contents.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([localHeader, name, contents]);
    localRecords.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(contents.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralRecords.push(Buffer.concat([centralHeader, name]));
    localOffset += localRecord.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
