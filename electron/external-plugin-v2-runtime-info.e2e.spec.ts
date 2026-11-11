import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  getExternalPluginV2PackageSigningPayload,
  type ExternalPluginV2UnsignedPackageManifest,
} from './plugin-package-v2';
import { createStoredZip, createWasmModuleFixture } from './test-helpers/wasm-module-fixtures';

const pluginId = 'org.it-tools.runtime-info-e2e';
const pluginName = 'Runtime info E2E probe';
const signerKeyId = 'runtime-info-e2e-signer';
const toolId = `${pluginId}/runtime-info`;
const commandId = `${pluginId}/read-runtime-info`;
const toolTitle = 'Read runtime information';
const toolRoute = `/extensions/${pluginId}/1.0.0/runtime-info`;
const signingPair = generateKeyPairSync('ed25519');
const signerPublicKey = signingPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const resultPrefix = new TextEncoder().encode('{"kind":"json","value":');

let electronApp: ElectronApplication | undefined;
let page: Page;
let temporaryDirectory = '';
let userDataDirectory = '';

test.beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'it-tools-runtime-info-e2e-'));
  userDataDirectory = await mkdtemp(join(tmpdir(), 'it-tools-runtime-info-profile-'));

  const wasmBytes = createWasmModuleFixture({
    // 前缀位于 alloc 返回地址之前；执行器把输入写在其后，模块再补闭合括号并回显完整请求。
    resultPointer: 1024 - resultPrefix.byteLength,
    resultBytes: resultPrefix,
    executeBody: wrapRequestAsJsonResultBody(resultPrefix.byteLength),
  });
  await writeFile(join(temporaryDirectory, 'runtime-info.itxs'), createSignedArchive(wasmBytes));

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

test('requires a fresh native confirmation before exposing runtime.info to WASM', async () => {
  test.setTimeout(120_000);
  await page.evaluate(() => localStorage.setItem('locale', 'en'));
  await page.goto('app://bundle/settings');

  // 信任签名者的确认与 runtime.info 确认分开替换，后者才是本测试的授权对象。
  await setNativeMessageBoxResponses([0]);
  await page.getByLabel('Signer key ID').fill(signerKeyId);
  await page.getByLabel('Allowed plugin IDs, separated by commas').fill(pluginId);
  await page.getByLabel('Ed25519 public key (PEM)').fill(signerPublicKey);
  await page.getByRole('button', { name: 'Preview fingerprint' }).click();
  await page.getByRole('button', { name: 'Trust this signer' }).click();
  await expect(page.getByText('Signer key added.')).toBeVisible();

  const archivePath = join(temporaryDirectory, 'runtime-info.itxs');
  await installV2Package(archivePath);
  await page.reload();
  await page.goto('app://bundle/');
  const toolLink = page.locator(`a[href="${toolRoute}"]`).first();
  await expect(toolLink).toBeVisible();
  await toolLink.click();
  await expect(page).toHaveURL(`app://bundle${toolRoute}`);
  await expect(page.getByRole('heading', { name: toolTitle }).first()).toBeVisible();

  const expectedRuntimeInfo = await electronApp!.evaluate(({ app }) => ({
    platform: process.platform,
    appVersion: app.getVersion(),
  }));
  await setNativeMessageBoxResponses([1, 0, 1]);

  // 用户拒绝时，命令失败且工作台没有任何 WASM 返回结果。
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be completed.');
  await expect(page.locator('.plugin-tool-workbench-result')).toHaveCount(0);
  const afterReject = await readNativeMessageBoxCalls();
  expect(afterReject).toHaveLength(1);
  expect(afterReject[0]).toMatchObject({
    message: `${pluginName} (${pluginId}) requests read-only capabilities for ${toolTitle}.`,
    buttons: ['Allow once / 本次允许', 'Cancel / 取消'],
  });

  // 用户本次允许后，WASM 回显的输入 JSON 必须包含当前宿主提供的两个字段。
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const result = page.locator('.plugin-tool-workbench-result pre');
  await expect(result).toBeVisible();
  const echoedRequest = JSON.parse(await result.innerText()) as unknown;
  expect(echoedRequest).toMatchObject({
    commandId,
    input: {},
    capabilityContext: { runtimeInfo: expectedRuntimeInfo },
  });
  expect(await readNativeMessageBoxCalls()).toHaveLength(2);

  // 一次授权不能延续到下一条命令；第三次拒绝仍必须取消执行。
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be completed.');
  await expect(page.locator('.plugin-tool-workbench-result')).toHaveCount(0);
  const afterSecondReject = await readNativeMessageBoxCalls();
  expect(afterSecondReject).toHaveLength(3);
  expect(afterSecondReject.map(call => call.buttons)).toEqual([
    ['Allow once / 本次允许', 'Cancel / 取消'],
    ['Allow once / 本次允许', 'Cancel / 取消'],
    ['Allow once / 本次允许', 'Cancel / 取消'],
  ]);
});

async function installV2Package(archivePath: string): Promise<void> {
  await electronApp!.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath] }),
    });
  }, archivePath);
  await page.getByRole('button', { name: 'Install v2 package' }).click();
  await expect(page.getByTestId(`plugin-v2-package-${pluginId}-1.0.0`)).toBeVisible();
}

async function setNativeMessageBoxResponses(responses: readonly number[]): Promise<void> {
  await electronApp!.evaluate(({ dialog }, responseQueue) => {
    const state = {
      responses: [...responseQueue],
      calls: [] as RuntimeInfoDialogCall[],
    };
    Object.defineProperty(globalThis, '__runtimeInfoE2eDialogState', {
      configurable: true,
      value: state,
    });
    Object.defineProperty(dialog, 'showMessageBox', {
      configurable: true,
      value: async (_window: unknown, options: RuntimeInfoDialogOptions) => {
        state.calls.push({
          title: options.title ?? '',
          message: options.message ?? '',
          detail: options.detail ?? '',
          buttons: [...(options.buttons ?? [])],
        });
        return { response: state.responses.shift() ?? 1 };
      },
    });
  }, [...responses]);
}

async function readNativeMessageBoxCalls(): Promise<RuntimeInfoDialogCall[]> {
  return electronApp!.evaluate(() => {
    const state = (globalThis as typeof globalThis & {
      __runtimeInfoE2eDialogState?: { calls: RuntimeInfoDialogCall[] };
    }).__runtimeInfoE2eDialogState;
    return state?.calls ?? [];
  });
}

function createSignedArchive(wasmBytes: Uint8Array): Buffer {
  const manifest: ExternalPluginV2UnsignedPackageManifest = {
    formatVersion: 2,
    id: pluginId,
    name: pluginName,
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    runtime: 'wasm',
    entrypoint: 'extension.wasm',
    requestedCapabilities: ['runtime.info'],
    activationEvents: [`onTool:${toolId}`, `onCommand:${commandId}`],
    contributions: {
      tools: [{
        id: toolId,
        title: toolTitle,
        description: 'Echo the command request to verify one-time runtime information approval.',
        keywords: ['runtime', 'info', 'wasm'],
        categoryId: 'development',
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: ['runtime.info'],
        inputs: [],
        output: { kind: 'json' },
      }],
      commands: [{
        id: commandId,
        title: 'Run runtime info probe',
        description: 'Read runtime information after one-time approval.',
        keywords: ['runtime', 'info', 'wasm'],
        toolId,
      }],
    },
    files: [{
      path: 'extension.wasm',
      sha256: createHash('sha256').update(wasmBytes).digest('hex'),
    }],
  };
  const payload = Buffer.from(getExternalPluginV2PackageSigningPayload(manifest), 'utf8');
  const signedManifest = {
    ...manifest,
    signature: {
      algorithm: 'Ed25519' as const,
      keyId: signerKeyId,
      value: sign(null, payload, signingPair.privateKey).toString('base64'),
    },
  };
  return createStoredZip([
    { path: 'plugin.json', contents: JSON.stringify(signedManifest) },
    { path: 'extension.wasm', contents: wasmBytes },
  ]);
}

/** 把 WASM 收到的请求原样包成工具 JSON 结果，使测试能检查 capabilityContext。 */
function wrapRequestAsJsonResultBody(prefixLength: number): number[] {
  return [
    0x20, 0x00, // local.get 0: 宿主分配的输入指针
    0x20, 0x01, // local.get 1: 输入字节数
    0x6a, // i32.add
    0x41, ...encodeSignedLeb(BigInt('}'.charCodeAt(0))),
    0x3a, 0x00, 0x00, // i32.store8: 在输入末尾追加结果对象的闭合括号
    0x20, 0x00,
    0x41, ...encodeSignedLeb(BigInt(prefixLength)),
    0x6b, // i32.sub: 结果指针落在已写入的 JSON 前缀
    0xad, // i64.extend_i32_u
    0x42, 0x20, // i64.const 32
    0x86, // i64.shl: 指针放入结果描述符高 32 位
    0x20, 0x01,
    0x41, ...encodeSignedLeb(BigInt(prefixLength + 1)),
    0x6a,
    0xad, // i64.extend_i32_u
    0x84, // i64.or: 结果长度放入低 32 位
  ];
}

function encodeSignedLeb(value: bigint): number[] {
  const bytes: number[] = [];
  let remaining = value;
  let more = true;
  while (more) {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    const signBit = (byte & 0x40) !== 0;
    more = !((remaining === 0n && !signBit) || (remaining === -1n && signBit));
    if (more) {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

interface RuntimeInfoDialogOptions {
  readonly title?: string;
  readonly message?: string;
  readonly detail?: string;
  readonly buttons?: readonly string[];
}

interface RuntimeInfoDialogCall {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
}
