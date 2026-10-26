import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { BrowserWindow as BrowserWindowType, LoadURLOptions } from 'electron';
import { generateKeyPairSync } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildPluginPackage } from '../scripts/plugin-pack.mjs';

const pluginId = 'org.it-tools.capability-demo';
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
  await writeFile(archivePath, await createSignedPackage('1.0.0'));
  await writeFile(upgradeArchivePath, await createSignedPackage('2.0.0'));
  await writeFile(unresponsiveArchivePath, await createSignedPackage('3.0.0', true));
  await writeFile(crashArchivePath, await createSignedPackage('4.0.0'));
  const fixtureDirectory = process.env.IT_TOOLS_PLUGIN_MANAGER_FIXTURE_DIR;
  if (fixtureDirectory) {
    await mkdir(fixtureDirectory, { recursive: true });
    await writeFile(join(fixtureDirectory, 'manager-e2e.itplugin'), await createSignedPackage('1.0.0'));
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
  await electronApp.evaluate(({ clipboard }) => {
    let writeCount = 0;
    Object.defineProperty(clipboard, 'writeText', {
      configurable: true,
      value: (text: string) => {
        writeCount += 1;
        Object.assign(globalThis, { __testClipboardText: text, __testClipboardWrites: writeCount });
      },
    });
  });
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
  const installedPluginCard = page.getByTestId(`plugin-package-${pluginId}-1.0.0`);
  await expect(installedPluginCard.getByText('Contributed tools', { exact: true })).toBeVisible();
  await expect(installedPluginCard.getByText('Review the capabilities and persistent settings granted to this plugin.', { exact: true })).toBeVisible();
  const contributionLink = installedPluginCard.getByRole('link', { name: 'Capability demo', exact: true });
  await expect(contributionLink).toHaveAttribute(
    'href',
    '/extensions/org.it-tools.capability-demo/1.0.0/capability-demo',
  );
  await contributionLink.click();
  await expect(page).toHaveURL('app://bundle/extensions/org.it-tools.capability-demo/1.0.0/capability-demo');
  await expect(page.getByText('This page displays signed metadata only.', { exact: false })).toBeVisible();
  await electronApp.evaluate(({ dialog }) => {
    Object.defineProperty(dialog, 'showMessageBox', {
      configurable: true,
      value: async () => ({ response: 1 }),
    });
  });
  await page.getByRole('button', { name: 'Run plugin' }).click();
  await expect(page.getByText('Plugin window started.', { exact: true })).toBeVisible();
  await expect.poll(async () => (
    await electronApp.windows()
  ).filter(window => window.url().startsWith(`it-plugin://${pluginId}/`)).length).toBe(1);
  const routePluginWindow = (await electronApp.windows()).find(window => window.url().startsWith(`it-plugin://${pluginId}/`));
  expect(routePluginWindow).toBeDefined();
  if (!routePluginWindow) {
    throw new Error('The plugin window was not created from the contribution route.');
  }
  await expect.poll(async () => routePluginWindow.evaluate(() => (
    (globalThis as unknown as { itTools?: { toolId?: string } }).itTools?.toolId
  ))).toBe('org.it-tools.capability-demo/capability-demo');
  const routePluginWindowClosed = routePluginWindow.waitForEvent('close');
  await page.getByRole('button', { name: 'Stop plugin' }).click();
  await routePluginWindowClosed;
  await expect(page.getByText('Plugin window stopped.', { exact: true })).toBeVisible();
  await page.goto('app://bundle/settings');
  await expect(page.getByText('Installed', { exact: true })).toBeVisible();

  const runtimeGrant = page.getByTestId(`plugin-package-${pluginId}-1.0.0`)
    .getByRole('checkbox', { name: 'Read platform and app version' });
  const clipboardGrant = page.getByTestId(`plugin-package-${pluginId}-1.0.0`)
    .getByRole('checkbox', { name: 'Write to the system clipboard' });
  const settingsReadGrant = page.getByTestId(`plugin-package-${pluginId}-1.0.0`)
    .getByRole('checkbox', { name: "Read this plugin's saved settings" });
  const settingsWriteGrant = page.getByTestId(`plugin-package-${pluginId}-1.0.0`)
    .getByRole('checkbox', { name: "Save this plugin's settings" });
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
  await expect(deniedWindow.locator('#runtime-proof')).toHaveText('Not authorized');
  await deniedWindow.locator('#clipboard-text').fill('denied clipboard test');
  await deniedWindow.getByRole('button', { name: 'Copy to clipboard' }).click();
  await expect(deniedWindow.locator('#clipboard-proof')).toHaveText('Not authorized');
  await expect(deniedWindow.locator('#copy-result')).toHaveText('Enable clipboard access in the plugin settings to copy text.');
  await expect(deniedWindow.locator('#settings-proof')).toHaveText('Not authorized');
  expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __testClipboardWrites?: number }).__testClipboardWrites ?? 0)).toBe(0);
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
  await clipboardGrant.check();
  await settingsReadGrant.check();
  await settingsWriteGrant.check();
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
  await expect.poll(async () => pluginWindow.evaluate(() => {
    const api = (globalThis as unknown as { itTools?: { apiVersion?: string; hostApiVersion?: string; toolId?: string } }).itTools;
    return { apiVersion: api?.apiVersion, hostApiVersion: api?.hostApiVersion, toolId: api?.toolId };
  })).toEqual({ apiVersion: '1.2.0', hostApiVersion: '1.3.0', toolId: undefined });
  await expect(pluginWindow.locator('#runtime-proof')).toHaveText('Available');
  await pluginWindow.locator('#clipboard-text').fill('signed plugin clipboard sample');
  await pluginWindow.getByRole('button', { name: 'Copy to clipboard' }).click();
  await expect(pluginWindow.locator('#clipboard-proof')).toHaveText('Available');
  await expect(pluginWindow.locator('#copy-result')).toHaveText('Text copied.');
  expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __testClipboardText?: string }).__testClipboardText)).toBe('signed plugin clipboard sample');
  await expect(pluginWindow.locator('#settings-proof')).toHaveText('Available');
  await pluginWindow.locator('#settings-value').fill('version-one');
  await pluginWindow.getByRole('button', { name: 'Save setting' }).click();
  await expect(pluginWindow.locator('#settings-result')).toHaveText('Setting saved.');
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await pluginWindow.evaluate(() => localStorage.setItem('rollback-proof', 'version-1'));

  await electronApp.evaluate(({ dialog }, selectedPackagePath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPackagePath] }),
    });
  }, upgradeArchivePath);
  await page.getByRole('button', { name: 'Install signed package' }).click();
  await expect(page.getByTestId(`plugin-package-${pluginId}-2.0.0`)).toBeVisible();
  await electronApp.evaluate(({ BrowserWindow }, targetPluginId) => {
    const originalLoadURL = BrowserWindow.prototype.loadURL as (
      this: BrowserWindowType,
      url: string,
      options?: LoadURLOptions,
    ) => Promise<void>;
    let failNextPluginLoad = true;
    Object.defineProperty(BrowserWindow.prototype, 'loadURL', {
      configurable: true,
      value: function (this: BrowserWindowType, url: string, options?: LoadURLOptions) {
        if (failNextPluginLoad && String(url).startsWith(`it-plugin://${targetPluginId}/`)) {
          failNextPluginLoad = false;
          return Promise.reject(new Error('Injected plugin upgrade failure.'));
        }
        return originalLoadURL.call(this, url, options);
      },
    });
  }, pluginId);
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
  await expect(rolledBackWindow.locator('#settings-proof')).toHaveText('Available');
  await expect(rolledBackWindow.locator('#settings-value')).toHaveValue('version-one');
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

async function createSignedPackage(version = '1.0.0', freezeRenderer = false): Promise<Buffer> {
  const sourceDirectory = join(temporaryDirectory, `capability-demo-${version}-${freezeRenderer ? 'frozen' : 'normal'}`);
  await cp(resolve('plugins/capability-demo'), sourceDirectory, { recursive: true });
  const sourceManifestPath = join(sourceDirectory, 'plugin.source.json');
  const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8')) as { version: string };
  sourceManifest.version = version;
  await writeFile(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);
  if (freezeRenderer) {
    const pluginScriptPath = join(sourceDirectory, 'plugin.js');
    const pluginScript = await readFile(pluginScriptPath, 'utf8');
    await writeFile(pluginScriptPath, `${pluginScript}\nsetTimeout(() => { while (true) {} }, 500);\n`);
  }
  return (await buildPluginPackage({
    sourceDirectory,
    signingKey: signingPair.privateKey,
    keyId,
  })).archive;
}
