import { createHash } from 'node:crypto';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  encodeExternalExtensionWorkerLaunchArgument,
  parseExternalExtensionWorkerLaunchArguments,
  type ExternalExtensionWorkerLaunchConfig,
} from './external-extension-worker-launch';
import { ExternalExtensionWorkerRuntime } from './external-extension-worker';
import type { ExternalExtensionRpcRequest } from '../src/shared/desktop-services/external-extension-rpc';

const pluginId = 'org.example.wasm-demo';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('external extension worker launch configuration', () => {
  it('round-trips only a bounded, valid WASM launch configuration', () => {
    const config = createLaunchConfig('/tmp/plugin', 'a'.repeat(64));
    const argument = encodeExternalExtensionWorkerLaunchArgument(config);

    expect(parseExternalExtensionWorkerLaunchArguments(['--other=value', argument])).toEqual(config);
    expect(parseExternalExtensionWorkerLaunchArguments([argument, argument])).toBeUndefined();
    expect(parseExternalExtensionWorkerLaunchArguments([
      `--it-tools-v2-launch=${Buffer.from(JSON.stringify({ ...config, entrypoint: '../escape.wasm' }), 'utf8').toString('base64url')}`,
    ])).toBeUndefined();
  });
});

describe('ExternalExtensionWorkerRuntime', () => {
  it('loads the signed WASM bytes and executes a command result', async () => {
    const { config, runtime } = await createRuntime();
    await expect(runtime.handle(request('activate', config))).resolves.toMatchObject({
      ok: true,
      result: { ready: true, runtime: 'wasm' },
    });
    await expect(runtime.handle(request('executeCommand', config, {
      commandId: `${pluginId}/echo`,
      input: { text: 'hello' },
      requiredCapabilities: [],
    }))).resolves.toMatchObject({
      ok: true,
      result: { kind: 'text', value: 'ok' },
    });
  });

  it('rejects modified entry bytes before activation', async () => {
    const { config, runtime, packageRoot } = await createRuntime();
    await writeFile(join(packageRoot, 'extension.wasm'), Uint8Array.of(0, 97, 115, 109));

    await expect(runtime.handle(request('activate', config))).resolves.toMatchObject({
      ok: false,
      error: 'extension-failed',
    });
  });

  it('rejects paths outside the package root and capability requests', async () => {
    const { config } = await createRuntime();
    const unsafeRuntime = new ExternalExtensionWorkerRuntime({ ...config, entrypoint: '../outside.wasm' });
    await expect(unsafeRuntime.handle(request('activate', config))).resolves.toMatchObject({
      ok: false,
      error: 'extension-failed',
    });

    const runtime = new ExternalExtensionWorkerRuntime(config);
    await expect(runtime.handle(request('activate', config, {
      version: config.version,
      grantedCapabilities: ['clipboard.write'],
    }))).resolves.toMatchObject({ ok: false, error: 'permission-denied' });
    await expect(runtime.handle(request('activate', config))).resolves.toMatchObject({ ok: true });
    await expect(runtime.handle(request('executeCommand', config, {
      commandId: `${pluginId}/echo`,
      input: {},
      requiredCapabilities: ['clipboard.write'],
    }))).resolves.toMatchObject({ ok: false, error: 'permission-denied' });
  });

  // worker 只在当前命令进程内接受 runtime.info 授权，并要求执行请求带匹配上下文。
  it('accepts only a one-command runtime.info grant and its context', async () => {
    const { config, runtime } = await createRuntime();
    await expect(runtime.handle(request('activate', config, {
      version: config.version,
      grantedCapabilities: ['runtime.info'],
    }))).resolves.toMatchObject({ ok: true, result: { ready: true, runtime: 'wasm' } });

    await expect(runtime.handle({
      protocolVersion: 1,
      requestId: 'runtime-info-1',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/echo`,
        input: { text: 'hello' },
        requiredCapabilities: ['runtime.info'],
        capabilityContext: { runtimeInfo: { platform: 'darwin', appVersion: '1.0.0' } },
      },
    } satisfies ExternalExtensionRpcRequest)).resolves.toMatchObject({
      ok: true,
      result: { kind: 'text', value: 'ok' },
    });

    await expect(runtime.handle({
      protocolVersion: 1,
      requestId: 'runtime-info-2',
      pluginId,
      method: 'executeCommand',
      payload: {
        commandId: `${pluginId}/echo`,
        input: {},
        requiredCapabilities: ['runtime.info'],
      },
    } satisfies ExternalExtensionRpcRequest)).resolves.toBeUndefined();
  });

  it('rejects unsupported host APIs and clears loaded bytes on disposal', async () => {
    const { config, runtime } = await createRuntime();
    await runtime.handle(request('activate', config));
    await expect(runtime.handle({
      protocolVersion: 1,
      requestId: 'read-1',
      pluginId,
      method: 'readData',
      payload: { providerId: `${pluginId}/data` },
    } satisfies ExternalExtensionRpcRequest)).resolves.toMatchObject({ ok: false, error: 'unsupported-method' });
    await expect(runtime.handle(request('dispose', config))).resolves.toMatchObject({ ok: true, result: true });
    await expect(runtime.handle(request('executeCommand', config, {
      commandId: `${pluginId}/echo`,
      input: {},
      requiredCapabilities: [],
    }))).resolves.toMatchObject({ ok: false, error: 'disposed' });
  });
});

function createLaunchConfig(packageRoot: string, entrypointSha256: string): ExternalExtensionWorkerLaunchConfig {
  return {
    pluginId,
    version: '1.0.0',
    packageRoot,
    entrypoint: 'extension.wasm',
    entrypointSha256,
  };
}

async function createRuntime(): Promise<{
  config: ExternalExtensionWorkerLaunchConfig;
  runtime: ExternalExtensionWorkerRuntime;
  packageRoot: string;
}> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'it-tools-v2-worker-'));
  temporaryDirectories.push(temporaryRoot);
  const packageRoot = join(temporaryRoot, pluginId, '1.0.0');
  await mkdir(packageRoot, { recursive: true });
  const canonicalPackageRoot = await realpath(packageRoot);
  const moduleBytes = createTextResultModule();
  await writeFile(join(canonicalPackageRoot, 'extension.wasm'), moduleBytes);
  const config = createLaunchConfig(
    canonicalPackageRoot,
    createHash('sha256').update(moduleBytes).digest('hex'),
  );
  return { config, runtime: new ExternalExtensionWorkerRuntime(config), packageRoot: canonicalPackageRoot };
}

function request(
  method: 'activate' | 'executeCommand' | 'dispose',
  config: ExternalExtensionWorkerLaunchConfig,
  payload?: Extract<ExternalExtensionRpcRequest, { method: typeof method }>['payload'],
): ExternalExtensionRpcRequest {
  return {
    protocolVersion: 1,
    requestId: `${method}-1`,
    pluginId: config.pluginId,
    method,
    payload: payload ?? (method === 'activate'
      ? { version: config.version, grantedCapabilities: [] }
      : method === 'executeCommand'
        ? { commandId: `${config.pluginId}/echo`, input: {}, requiredCapabilities: [] }
        : {}),
  } as ExternalExtensionRpcRequest;
}

/** 构造一个导入受限内存并返回固定文本结果的真实 WASM 模块。 */
function createTextResultModule(): Uint8Array {
  const result = new TextEncoder().encode(JSON.stringify({ kind: 'text', value: 'ok' }));
  const resultPointer = 4096;
  const descriptor = (BigInt(resultPointer) << 32n) | BigInt(result.byteLength);
  const types = [
    [0x60, ...vector([[0x7f]]), ...vector([[0x7f]])],
    [0x60, ...vector([[0x7f], [0x7f]]), ...vector([[0x7e]])],
    [0x60, ...vector([[0x7f], [0x7f]]), ...vector([])],
  ];
  const imports = [[
    ...wasmString('env'),
    ...wasmString('memory'),
    0x02,
    0x01,
    ...unsignedLeb(16),
    ...unsignedLeb(256),
  ]];
  const exports = [
    [...wasmString('alloc'), 0x00, ...unsignedLeb(0)],
    [...wasmString('execute'), 0x00, ...unsignedLeb(1)],
    [...wasmString('free'), 0x00, ...unsignedLeb(2)],
  ];
  const code = [
    functionBody([0x41, ...signedLeb(1024n)]),
    functionBody([0x42, ...signedLeb(descriptor)]),
    functionBody([]),
  ];
  const data = [[
    0x00,
    0x41,
    ...signedLeb(BigInt(resultPointer)),
    0x0b,
    ...unsignedLeb(result.byteLength),
    ...result,
  ]];
  const sections = [
    wasmSection(1, vector(types)),
    wasmSection(2, vector(imports)),
    wasmSection(3, vector([[0x00], [0x01], [0x02]])),
    wasmSection(7, vector(exports)),
    wasmSection(10, vector(code)),
    wasmSection(11, vector(data)),
  ];
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...sections.flat(),
  ]);
}

function functionBody(instructions: readonly number[]): number[] {
  const body = [0x00, ...instructions, 0x0b];
  return [...unsignedLeb(body.length), ...body];
}

function wasmSection(id: number, payload: readonly number[]): number[] {
  return [id, ...unsignedLeb(payload.length), ...payload];
}

function vector(values: readonly (readonly number[])[]): number[] {
  return [...unsignedLeb(values.length), ...values.flat()];
}

function wasmString(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  return [...unsignedLeb(bytes.length), ...bytes];
}

function unsignedLeb(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining !== 0);
  return bytes;
}

function signedLeb(value: bigint): number[] {
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
