import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalExtensionRpcError } from './external-extension-rpc';
import {
  getExternalPluginV2PackageSigningPayload,
  type ExternalPluginV2UnsignedPackageManifest,
} from './plugin-package-v2';
import type { DesktopPluginOperationResult } from '../src/shared/desktop-services/plugins';

// 由测试控制进程退出通知，验证 IPC 不会提前删除已安装包。
const control = vi.hoisted(() => {
  type StopWaiter = { resolve: () => void; reject: (error: unknown) => void };
  type RpcRequest = { protocolVersion: number; requestId: string; pluginId: string; method: string };
  type RpcFailure = 'timeout' | 'cancelled' | 'extension-failed';
  const handlers = new Map<string, unknown>();
  const pendingStops = new Set<StopWaiter>();
  const heldExecutions = new Set<{ request: RpcRequest; resolve: (value: unknown) => void }>();
  let onStopped: (() => void) | undefined;
  let executeError: RpcFailure | undefined;
  let holdExecution = false;
  const responseFor = (request: RpcRequest) => {
    if (request.method === 'executeCommand' && executeError) {
      return {
        protocolVersion: request.protocolVersion,
        requestId: request.requestId,
        pluginId: request.pluginId,
        ok: false as const,
        error: executeError,
      };
    }
    return {
      protocolVersion: request.protocolVersion,
      requestId: request.requestId,
      pluginId: request.pluginId,
      ok: true as const,
      result: request.method === 'activate'
        ? { ready: true, runtime: 'wasm' }
        : request.method === 'executeCommand'
          ? { kind: 'text', value: 'completed' }
          : true,
    };
  };
  const send = vi.fn((request: RpcRequest) => {
    if (request.method === 'executeCommand' && holdExecution) {
      return new Promise(resolve => heldExecutions.add({ request, resolve }));
    }
    return Promise.resolve(responseFor(request));
  });
  const dispose = vi.fn(() => new Promise<void>((resolve, reject) => {
    pendingStops.add({ resolve, reject });
  }));
  return {
    handlers,
    send,
    dispose,
    setExecuteError: (code: RpcFailure | undefined) => { executeError = code; },
    holdExecuteCommand: () => { holdExecution = true; },
    setStoppedCallback: (callback: (() => void) | undefined) => { onStopped = callback; },
    finishStop: () => {
      for (const pending of [...heldExecutions]) {
        heldExecutions.delete(pending);
        pending.resolve(responseFor(pending.request));
      }
      holdExecution = false;
      const callback = onStopped;
      onStopped = undefined;
      callback?.();
      for (const waiter of [...pendingStops]) {
        pendingStops.delete(waiter);
        waiter.resolve();
      }
    },
    rejectStop: (error: unknown) => {
      for (const waiter of [...pendingStops]) {
        pendingStops.delete(waiter);
        waiter.reject(error);
      }
    },
    reset: () => {
      handlers.clear();
      onStopped = undefined;
      pendingStops.clear();
      heldExecutions.clear();
      executeError = undefined;
      holdExecution = false;
      send.mockClear();
      dispose.mockClear();
    },
  };
});

vi.mock('electron', () => ({
  app: { getAppPath: () => '/test/app', getVersion: () => '1.0.0' },
  BrowserWindow: class BrowserWindow {},
  clipboard: { writeText: vi.fn() },
  dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: unknown) => control.handlers.set(channel, handler),
    removeHandler: (channel: string) => control.handlers.delete(channel),
  },
  net: { fetch: vi.fn(), request: vi.fn() },
  session: { fromPartition: vi.fn() },
}));

vi.mock('./external-extension-process', () => ({
  createExternalExtensionProcessTransport: (options: { onStopped?: () => void }) => {
    control.setStoppedCallback(options.onStopped);
    return { send: control.send, dispose: control.dispose };
  },
}));

import { registerPluginLifecycleIpc } from './plugin-ipc';

const pluginId = 'org.example.ipc-uninstall-demo';
const version = '1.0.0';
const commandId = `${pluginId}/run`;
const signingPair = generateKeyPairSync('ed25519');
const temporaryDirectories: string[] = [];
let lifecycle: Awaited<ReturnType<typeof registerPluginLifecycleIpc>> | undefined;

afterEach(async () => {
  control.finishStop();
  await lifecycle?.shutdown();
  lifecycle = undefined;
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
  control.reset();
  vi.restoreAllMocks();
});

describe('v2 plugin uninstall IPC', () => {
  // 使用真实注册流程和包管理器；只有模拟的 utility process 退出事件由测试控制。
  it('waits for the worker exit event before deleting the installed package', async () => {
    const state = await registerFixture();
    const command = invoke('desktop:plugins:v2:execute', createCommandRequest('request-uninstall-waits'));
    await vi.waitFor(() => expect(control.dispose).toHaveBeenCalledOnce());

    const uninstall = invoke('desktop:plugins:v2:uninstall', { pluginId, version });
    await Promise.resolve();
    expect(await exists(state.packageRoot)).toBe(true);

    control.finishStop();
    await expect(uninstall).resolves.toEqual({ ok: true, value: true });
    await expect(command).resolves.toMatchObject({ ok: true, value: { kind: 'text', value: 'completed' } });
    expect(await exists(state.packageRoot)).toBe(false);
  });

  // 停止失败时包必须保留，且命令请求记录必须释放，允许复用 requestId。
  it('keeps the package after a stop timeout and releases the command request ID', async () => {
    const state = await registerFixture();
    const commandRequest = createCommandRequest('request-uninstall-timeout');
    const command = invoke('desktop:plugins:v2:execute', commandRequest);
    await vi.waitFor(() => expect(control.dispose).toHaveBeenCalledOnce());
    const uninstall = invoke('desktop:plugins:v2:uninstall', { pluginId, version });

    control.rejectStop(new ExternalExtensionRpcError('timeout'));
    await expect(uninstall).resolves.toMatchObject({ ok: false, error: 'timeout' });
    await expect(command).resolves.toMatchObject({ ok: false, error: 'timeout' });
    expect(await exists(state.packageRoot)).toBe(true);

    const reusedRequest = await invoke('desktop:plugins:v2:execute', commandRequest) as DesktopPluginOperationResult<unknown>;
    expect(reusedRequest).toEqual({ ok: false, error: 'active-limit' });
    control.finishStop();
  });

  // RPC 超时和取消保留稳定错误码；其他扩展错误只返回通用失败码。
  it.each([
    { rpcError: 'timeout', ipcError: 'timeout' },
    { rpcError: 'cancelled', ipcError: 'cancelled' },
    { rpcError: 'extension-failed', ipcError: 'operation-failed' },
  ] as const)('maps RPC $rpcError to the safe IPC code $ipcError', async ({ rpcError, ipcError }) => {
    await registerFixture();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    control.setExecuteError(rpcError);
    const command = invoke('desktop:plugins:v2:execute', createCommandRequest(`request-${rpcError}`));
    await vi.waitFor(() => expect(control.dispose).toHaveBeenCalledOnce());

    control.finishStop();
    await expect(command).resolves.toMatchObject({ ok: false, error: ipcError });
    expect(warning).toHaveBeenCalledWith('V2 plugin command failed.', expect.objectContaining({ code: rpcError }));
  });

  it('returns cancelled when the v2 cancel IPC aborts an active command', async () => {
    await registerFixture();
    control.holdExecuteCommand();
    const requestId = 'request-ipc-cancel';
    const command = invoke('desktop:plugins:v2:execute', createCommandRequest(requestId));
    await vi.waitFor(() => expect(
      control.send.mock.calls.some(([request]) => request.method === 'executeCommand'),
    ).toBe(true));

    await expect(invoke('desktop:plugins:v2:cancel', { requestId })).resolves.toEqual({ ok: true, value: true });
    await vi.waitFor(() => expect(control.dispose).toHaveBeenCalledOnce());
    control.finishStop();
    await expect(command).resolves.toMatchObject({ ok: false, error: 'cancelled' });
  });
});

/** 创建真实签名 v2 WASM 包，并注册 Electron IPC 处理器。 */
async function registerFixture(): Promise<{ packageRoot: string }> {
  control.reset();
  const root = await mkdtemp(join(tmpdir(), 'it-tools-v2-ipc-'));
  temporaryDirectories.push(root);
  const publicKey = signingPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const wasmBytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const unsignedManifest: ExternalPluginV2UnsignedPackageManifest = {
    formatVersion: 2,
    id: pluginId,
    name: 'IPC uninstall test',
    version,
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    runtime: 'wasm',
    entrypoint: 'extension.wasm',
    requestedCapabilities: [],
    activationEvents: [`onCommand:${commandId}`],
    contributions: {
      tools: [],
      commands: [{ id: commandId, title: 'Run', description: 'Run the test command.', keywords: ['test'] }],
    },
    files: [{ path: 'extension.wasm', sha256: createHash('sha256').update(wasmBytes).digest('hex') }],
  };
  const signedManifest = {
    ...unsignedManifest,
    signature: {
      algorithm: 'Ed25519' as const,
      keyId: 'ipc-test-key',
      value: sign(
        null,
        Buffer.from(getExternalPluginV2PackageSigningPayload(unsignedManifest), 'utf8'),
        signingPair.privateKey,
      ).toString('base64'),
    },
  };
  const packageRoot = join(root, 'plugins', 'v2-packages', pluginId, version);
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(root, 'plugins', 'trusted-keys.json'), JSON.stringify({
    schemaVersion: 1,
    keys: [{ keyId: 'ipc-test-key', publicKey, allowedPluginIds: [pluginId] }],
  }));
  await writeFile(join(packageRoot, 'plugin.json'), JSON.stringify(signedManifest));
  await writeFile(join(packageRoot, 'extension.wasm'), wasmBytes);
  lifecycle = await registerPluginLifecycleIpc({
    userDataRoot: root,
    getMainWindow: () => null,
    getTrustedRendererUrl: () => 'app://bundle/',
    onPluginWebContentsCreated: () => undefined,
  });
  return { packageRoot };
}

/** 构造通过 IPC 入口校验的命令请求。 */
function createCommandRequest(requestId: string): Record<string, unknown> {
  return { requestId, pluginId, version, commandId, input: {} };
}

/** 以可信主窗口事件调用已注册的 Electron IPC 处理器。 */
function invoke(channel: string, value: unknown): Promise<unknown> {
  const handler = control.handlers.get(channel);
  if (typeof handler !== 'function') {
    throw new Error(`The IPC handler ${channel} was not registered.`);
  }
  const mainFrame = { url: 'app://bundle/settings' };
  return (handler as (event: unknown, value: unknown) => Promise<unknown>)(
    { senderFrame: mainFrame, sender: { mainFrame } },
    value,
  );
}

/** 检查测试包路径是否仍然存在。 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  }
  catch {
    return false;
  }
}
