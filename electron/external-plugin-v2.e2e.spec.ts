import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  getExternalPluginV2PackageSigningPayload,
  type ExternalPluginV2UnsignedPackageManifest,
} from './plugin-package-v2';
import { createStoredZip, createWasmModuleFixture } from './test-helpers/wasm-module-fixtures';

const wasmPluginId = 'org.it-tools.wasm-e2e';
const invalidImportPluginId = 'org.it-tools.wasm-import-e2e';
const signerKeyId = 'wasm-e2e-signer';
const toolId = `${wasmPluginId}/echo`;
const commandId = `${wasmPluginId}/run-echo`;
const toolRoute = `/extensions/${wasmPluginId}/1.0.0/echo`;
const signingPair = generateKeyPairSync('ed25519');
const signerPublicKey = signingPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

let electronApp: ElectronApplication | undefined;
let page: Page;
let temporaryDirectory = '';
let userDataDirectory = '';

test.beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-v2-e2e-'));
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-v2-profile-'));

  const successResult = new TextEncoder().encode(JSON.stringify({
    kind: 'json',
    value: { engine: 'wasm', status: 'complete' },
  }));
  const signedWasmBytes = createWasmModuleFixture({
    commandId,
    spinOnTrueField: 'spin',
    resultBytes: successResult,
  });
  await writeFile(join(temporaryDirectory, 'wasm-e2e.itxs'), createSignedV2Archive({
    id: wasmPluginId,
    name: 'WASM execution demo',
    version: '1.0.0',
    commandId,
    toolId,
    toolTitle: 'Signed WASM echo',
    commandTitle: 'Run signed WASM echo',
    toolInputs: [
      { id: 'spin', kind: 'boolean', label: 'Spin forever', description: 'Enable the timeout test.', defaultValue: false },
      { id: 'whole-number', kind: 'number', label: 'Whole number', integer: true, step: 1 },
    ],
    wasmBytes: signedWasmBytes,
  }));

  const invalidImportCommandId = `${invalidImportPluginId}/run-import-check`;
  const invalidImportToolId = `${invalidImportPluginId}/import-check`;
  await writeFile(join(temporaryDirectory, 'wasm-import.itxs'), createSignedV2Archive({
    id: invalidImportPluginId,
    name: 'WASM import rejection demo',
    version: '1.0.0',
    commandId: invalidImportCommandId,
    toolId: invalidImportToolId,
    toolTitle: 'Rejected WASM import',
    commandTitle: 'Run rejected WASM import',
    wasmBytes: createWasmModuleFixture({ extraFunctionImport: true }),
  }));

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
    const directories = [temporaryDirectory, userDataDirectory].filter(Boolean);
    await Promise.all(directories.map(directory => rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 250,
    })));
  }
});

test('installs and runs signed WASM tools through navigation, search, failure, and recovery', async () => {
  test.setTimeout(120_000);
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.goto('app://bundle/settings');
  await electronApp!.evaluate(({ dialog }) => {
    Object.defineProperty(dialog, 'showMessageBox', {
      configurable: true,
      value: async () => ({ response: 0 }),
    });
  });

  await page.getByLabel('Signer key ID').fill(signerKeyId);
  await page.getByLabel('Allowed plugin IDs, separated by commas').fill(`${wasmPluginId}, ${invalidImportPluginId}`);
  await page.getByLabel('Ed25519 public key (PEM)').fill(signerPublicKey);
  await page.getByRole('button', { name: 'Preview fingerprint' }).click();
  await expect(page.locator('.signer-preview code')).toContainText('SHA256:');
  await page.getByRole('button', { name: 'Trust this signer' }).click();
  await expect(page.getByText('Signer key added. Plugin capabilities still require separate approval.')).toBeVisible();

  await installV2Package(join(temporaryDirectory, 'wasm-e2e.itxs'), `plugin-v2-package-${wasmPluginId}-1.0.0`);
  await page.reload();
  const installed = await page.evaluate(() => window.itToolsDesktop!.listPluginV2Packages!());
  expect(installed).toMatchObject({ ok: true, value: [{ pluginId: wasmPluginId, status: 'installed' }] });

  await page.goto('app://bundle/');
  const toolLink = page.locator(`a[href="${toolRoute}"]`).first();
  await expect(toolLink).toBeVisible();
  await toolLink.click();
  await expect(page).toHaveURL(`app://bundle${toolRoute}`);

  await page.goto('app://bundle/');
  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder('Type to search a tool or a command...');
  await search.fill('Run signed WASM echo');
  const searchCommand = page.getByRole('option').filter({ hasText: 'Run signed WASM echo' }).first();
  await expect(searchCommand).toBeVisible();
  await searchCommand.click();
  await expect(page).toHaveURL(`app://bundle${toolRoute}`);

  // 直接刷新插件链接时，等待注册完成后仍应显示宿主工作台。
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Signed WASM echo' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'External plugin tool', exact: true })).toHaveCount(0);

  // 字段说明应位于控件下方，不能与控件挤在同一行。
  const fieldControl = await page.getByRole('switch', { name: 'Spin forever' }).boundingBox();
  const fieldDescription = await page.getByText('Enable the timeout test.').boundingBox();
  expect(fieldControl).not.toBeNull();
  expect(fieldDescription).not.toBeNull();
  expect(fieldDescription!.y).toBeGreaterThanOrEqual(fieldControl!.y + fieldControl!.height);

  await electronApp!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(820, 700));
  const narrowControl = await page.getByRole('switch', { name: 'Spin forever' }).boundingBox();
  const narrowDescription = await page.getByText('Enable the timeout test.').boundingBox();
  expect(narrowControl).not.toBeNull();
  expect(narrowDescription).not.toBeNull();
  expect(narrowDescription!.y).toBeGreaterThanOrEqual(narrowControl!.y + narrowControl!.height);
  expect(await page.locator('.plugin-tool-workbench').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await electronApp!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 850));

  await page.getByLabel('Whole number').locator('input').fill('1.5');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('alert')).toContainText('Whole number must be a safe integer.');
  await page.getByLabel('Whole number').locator('input').fill('21');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('.plugin-tool-workbench-result pre')).toContainText('"engine": "wasm"');
  await expect(page.locator('.plugin-tool-workbench-result pre')).toContainText('"status": "complete"');

  await page.getByRole('switch', { name: 'Spin forever' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('alert')).toContainText('The plugin command timed out.');

  await page.getByRole('switch', { name: 'Spin forever' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.locator('.plugin-tool-workbench-result pre')).toContainText('"status": "complete"');

  await page.goto('app://bundle/settings');
  await installV2Package(join(temporaryDirectory, 'wasm-import.itxs'), `plugin-v2-package-${invalidImportPluginId}-1.0.0`);
  await page.reload();
  const invalidImportRoute = `/extensions/${invalidImportPluginId}/1.0.0/import-check`;
  await page.goto('app://bundle/');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Type to search a tool or a command...').fill('Run rejected WASM import');
  const invalidImportOption = page.getByRole('option').filter({ hasText: 'Run rejected WASM import' }).first();
  await expect(invalidImportOption).toBeVisible();
  await invalidImportOption.click();
  await expect(page).toHaveURL(`app://bundle${invalidImportRoute}`);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('alert')).toContainText('The plugin command could not be completed.');

  await page.goto(`app://bundle${toolRoute}`);
  const normalResult = await executeCommandThroughBridge({
    pluginId: wasmPluginId,
    version: '1.0.0',
    commandId,
    input: { spin: false },
  });
  expect(normalResult).toMatchObject({
    ok: true,
    value: { kind: 'json', value: { engine: 'wasm', status: 'complete' } },
  });

  const installedModulePath = join(
    userDataDirectory,
    'plugins',
    'v2-packages',
    wasmPluginId,
    '1.0.0',
    'extension.wasm',
  );
  const installedModuleBytes = await readFile(installedModulePath);
  try {
    await writeFile(installedModulePath, createWasmModuleFixture({ resultBytes: new TextEncoder().encode('{"kind":"json","value":{"tampered":true}}') }));
    const tamperedResult = await executeCommandThroughBridge({
      pluginId: wasmPluginId,
      version: '1.0.0',
      commandId,
      input: { spin: false },
    });
    expect(tamperedResult).toMatchObject({ ok: false, error: 'file-hash-mismatch' });
  }
  finally {
    await writeFile(installedModulePath, installedModuleBytes);
  }
  await expect(page.locator('#app')).not.toBeEmpty();
});

async function installV2Package(archivePath: string, packageTestId: string): Promise<void> {
  await electronApp!.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath] }),
    });
  }, archivePath);
  await page.getByRole('button', { name: 'Install v2 package' }).click();
  await expect(page.getByTestId(packageTestId)).toBeVisible();
}

async function executeCommandThroughBridge(input: {
  pluginId: string;
  version: string;
  commandId: string;
  input: Readonly<Record<string, string | number | boolean | null>>;
}): Promise<unknown> {
  return page.evaluate(async request => window.itToolsDesktop!.executePluginV2Command!({
    requestId: crypto.randomUUID(),
    ...request,
  }), input);
}

function createSignedV2Archive(options: {
  id: string;
  name: string;
  version: string;
  commandId: string;
  toolId: string;
  toolTitle: string;
  commandTitle: string;
  wasmBytes: Uint8Array;
  toolInputs?: ExternalPluginV2UnsignedPackageManifest['contributions']['tools'][number]['inputs'];
}): Buffer {
  const manifest: ExternalPluginV2UnsignedPackageManifest = {
    formatVersion: 2,
    id: options.id,
    name: options.name,
    version: options.version,
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    runtime: 'wasm',
    entrypoint: 'extension.wasm',
    requestedCapabilities: [],
    activationEvents: [
      `onTool:${options.toolId}`,
      `onCommand:${options.commandId}`,
    ],
    contributions: {
      tools: [{
        id: options.toolId,
        title: options.toolTitle,
        description: 'Run a signed WASM command with the host-rendered workspace.',
        keywords: ['wasm', 'signed', 'extension'],
        categoryId: 'development',
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: [],
        inputs: options.toolInputs ?? [],
        output: { kind: 'json' },
      }],
      commands: [{
        id: options.commandId,
        title: options.commandTitle,
        description: 'Run a signed WASM extension command.',
        keywords: ['wasm', 'signed', 'extension'],
        toolId: options.toolId,
      }],
    },
    files: [{
      path: 'extension.wasm',
      sha256: createHash('sha256').update(options.wasmBytes).digest('hex'),
    }],
  };
  const unsignedBytes = Buffer.from(getExternalPluginV2PackageSigningPayload(manifest), 'utf8');
  const signedManifest = {
    ...manifest,
    signature: {
      algorithm: 'Ed25519' as const,
      keyId: signerKeyId,
      value: sign(null, unsignedBytes, signingPair.privateKey).toString('base64'),
    },
  };
  return createStoredZip([
    { path: 'plugin.json', contents: JSON.stringify(signedManifest) },
    { path: 'extension.wasm', contents: options.wasmBytes },
  ]);
}
