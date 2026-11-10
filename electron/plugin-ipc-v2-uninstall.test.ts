import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { ExternalExtensionRpcError } from './external-extension-rpc';
import {
  getExternalPluginV2PackageSigningPayload,
  type ExternalPluginV2UnsignedPackageManifest,
} from './plugin-package-v2';
import type { DesktopPluginOperationResult } from '../src/shared/desktop-services/plugins';
import type { PluginCapabilityId } from '../src/shared/plugin-capabilities';

// 由测试控制进程退出通知，验证 IPC 不会提前删除已安装包。
const control = vi.hoisted(() => {
  type StopWaiter = { resolve: () => void; reject: (error: unknown) => void };
  type RpcRequest = {
    protocolVersion: number;
    requestId: string;
    pluginId: string;
    method: string;
    payload?: Record<string, unknown>;
  };
  type RpcFailure = 'timeout' | 'cancelled' | 'extension-failed';
  const handlers = new Map<string, unknown>();
  const pendingStops = new Set<StopWaiter>();
  const heldExecutions = new Set<{ request: RpcRequest; resolve: (value: unknown) => void }>();
  let onStopped: (() => void) | undefined;
  let executeError: RpcFailure | undefined;
  let holdExecution = false;
  const messageBox = vi.fn(async () => ({ response: 0 }));
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
    messageBox,
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
      messageBox.mockReset();
      messageBox.mockResolvedValue({ response: 0 });
    },
  };
});

vi.mock('electron', () => ({
  app: { getAppPath: () => '/test/app', getVersion: () => '1.0.0' },
  BrowserWindow: class BrowserWindow {},
  clipboard: { writeText: vi.fn() },
  dialog: { showMessageBox: control.messageBox, showOpenDialog: vi.fn() },
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

  // 只有签名清单和对应工具都声明 runtime.info 时，主进程才请求本次授权并发送受限上下文。
  it('asks for runtime.info and sends only the approved platform and app version', async () => {
    await registerFixture({
      requestedCapabilities: ['runtime.info'],
      toolCapabilities: ['runtime.info'],
      withMainWindow: true,
    });

    const command = invoke('desktop:plugins:v2:execute', createCommandRequest('request-runtime-info'));
    await vi.waitFor(() => expect(control.dispose).toHaveBeenCalledOnce());

    expect(control.messageBox).toHaveBeenCalledOnce();
    expect(control.messageBox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      detail: expect.stringContaining('Approval applies only to this command.'),
      buttons: ['Allow once / 本次允许', 'Cancel / 取消'],
      cancelId: 1,
    }));
    const activateRequest = control.send.mock.calls.find(([request]) => request.method === 'activate')?.[0];
    const executeRequest = control.send.mock.calls.find(([request]) => request.method === 'executeCommand')?.[0];
    expect(activateRequest?.payload).toEqual({ version, grantedCapabilities: ['runtime.info'] });
    expect(executeRequest?.payload).toEqual({
      commandId,
      input: {},
      requiredCapabilities: ['runtime.info'],
      capabilityContext: { runtimeInfo: { platform: process.platform, appVersion: '1.0.0' } },
    });

    control.finishStop();
    await expect(command).resolves.toMatchObject({ ok: true, value: { kind: 'text', value: 'completed' } });
  });

  // Electron 对取消或关闭返回 cancelId；主进程不得启动 worker，也不得给出上下文。
  it('denies runtime.info when the native confirmation is cancelled or closed', async () => {
    await registerFixture({
      requestedCapabilities: ['runtime.info'],
      toolCapabilities: ['runtime.info'],
      withMainWindow: true,
    });
    control.messageBox.mockResolvedValue({ response: 1 });

    await expect(invoke('desktop:plugins:v2:execute', createCommandRequest('request-runtime-info-denied')))
      .resolves.toMatchObject({ ok: false, error: 'permission-denied' });
    expect(control.send).not.toHaveBeenCalled();
    expect(control.dispose).not.toHaveBeenCalled();
  });

  // 主进程取消 IPC 在授权窗口等待期间生效，用户随后点击允许也不能启动 worker。
  it('does not start a worker if the command is cancelled while the native prompt is open', async () => {
    let resolvePrompt: ((value: { response: number }) => void) | undefined;
    await registerFixture({
      requestedCapabilities: ['runtime.info'],
      toolCapabilities: ['runtime.info'],
      withMainWindow: true,
    });
    control.messageBox.mockImplementation(() => new Promise(resolve => { resolvePrompt = resolve; }));
    const requestId = 'request-runtime-info-cancel';
    const command = invoke('desktop:plugins:v2:execute', createCommandRequest(requestId));
    await vi.waitFor(() => expect(control.messageBox).toHaveBeenCalledOnce());

    await expect(invoke('desktop:plugins:v2:cancel', { requestId })).resolves.toEqual({ ok: true, value: true });
    resolvePrompt?.({ response: 0 });

    await expect(command).resolves.toMatchObject({ ok: false, error: 'cancelled' });
    expect(control.send).not.toHaveBeenCalled();
    expect(control.dispose).not.toHaveBeenCalled();
  });

  // renderer 的请求格式不含授权字段；额外传入上下文或授权列表时，入口直接拒绝。
  it('rejects renderer supplied grants and capability context', async () => {
    await registerFixture();

    await expect(invoke('desktop:plugins:v2:execute', {
      ...createCommandRequest('request-renderer-context'),
      grantedCapabilities: ['runtime.info'],
      capabilityContext: { runtimeInfo: { platform: 'darwin', appVersion: '1.0.0' } },
    })).resolves.toEqual({ ok: false, error: 'invalid-request' });
    expect(control.messageBox).not.toHaveBeenCalled();
    expect(control.send).not.toHaveBeenCalled();
  });

  // 清单请求能力不能替代工具声明；工具没有 runtime.info 时不提示，也不发送上下文。
  it('does not prompt when the signed tool does not declare runtime.info', async () => {
    await registerFixture({
      requestedCapabilities: ['runtime.info'],
      toolCapabilities: [],
    });
    const command = invoke('desktop:plugins:v2:execute', createCommandRequest('request-runtime-info-unused'));
    await vi.waitFor(() => expect(control.dispose).toHaveBeenCalledOnce());

    const activateRequest = control.send.mock.calls.find(([request]) => request.method === 'activate')?.[0];
    const executeRequest = control.send.mock.calls.find(([request]) => request.method === 'executeCommand')?.[0];
    expect(control.messageBox).not.toHaveBeenCalled();
    expect(activateRequest?.payload).toEqual({ version, grantedCapabilities: [] });
    expect(executeRequest?.payload).toEqual({ commandId, input: {}, requiredCapabilities: [] });

    control.finishStop();
    await expect(command).resolves.toMatchObject({ ok: true, value: { kind: 'text', value: 'completed' } });
  });

  // 首版策略不支持其他能力，必须在任何原生授权提示或 worker 启动前拒绝。
  it('keeps every capability except runtime.info denied', async () => {
    await registerFixture({
      requestedCapabilities: ['clipboard.write'],
      toolCapabilities: ['clipboard.write'],
      withMainWindow: true,
    });

    await expect(invoke('desktop:plugins:v2:execute', createCommandRequest('request-clipboard-denied')))
      .resolves.toEqual({ ok: false, error: 'unsupported-capability' });
    expect(control.messageBox).not.toHaveBeenCalled();
    expect(control.send).not.toHaveBeenCalled();
  });
});

/** 创建真实签名 v2 WASM 包，并注册 Electron IPC 处理器。 */
async function registerFixture(options: {
  requestedCapabilities?: readonly PluginCapabilityId[];
  toolCapabilities?: readonly PluginCapabilityId[];
  withMainWindow?: boolean;
} = {}): Promise<{ packageRoot: string }> {
  control.reset();
  const root = await mkdtemp(join(tmpdir(), 'it-tools-v2-ipc-'));
  temporaryDirectories.push(root);
  const publicKey = signingPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const wasmBytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const toolId = `${pluginId}/runtime-info`;
  const toolCapabilities = options.toolCapabilities;
  const tool = toolCapabilities === undefined ? undefined : {
    id: toolId,
    title: 'Runtime info tool',
    description: 'Read the host runtime information.',
    keywords: ['runtime'],
    categoryId: 'development',
    dataProcessing: 'memory-only' as const,
    offline: 'available' as const,
    capabilities: toolCapabilities,
    inputs: [],
    output: { kind: 'text' as const },
  };
  const unsignedManifest: ExternalPluginV2UnsignedPackageManifest = {
    formatVersion: 2,
    id: pluginId,
    name: 'IPC uninstall test',
    version,
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    runtime: 'wasm',
    entrypoint: 'extension.wasm',
    requestedCapabilities: options.requestedCapabilities ?? [],
    activationEvents: [
      `onCommand:${commandId}` as const,
      ...(tool ? [`onTool:${toolId}` as const] : []),
    ],
    contributions: {
      tools: tool ? [tool] : [],
      commands: [{
        id: commandId,
        title: 'Run',
        description: 'Run the test command.',
        keywords: ['test'],
        ...(tool ? { toolId } : {}),
      }],
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
    getMainWindow: () => options.withMainWindow
      ? ({ isDestroyed: () => false } as unknown as BrowserWindow)
      : null,
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
