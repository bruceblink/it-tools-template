import { describe, expect, it, vi } from 'vitest';
import { ExternalExtensionProcessTransport, type ExternalExtensionProcessFork, type ExternalExtensionProcessLike } from './external-extension-process';
import { ExternalExtensionRpcError, ExternalExtensionRpcHost } from './external-extension-rpc';
import { parseExternalExtensionWorkerLaunchArguments } from './external-extension-worker-launch';
import type { ExternalExtensionRpcRequest } from '../src/shared/desktop-services/external-extension-rpc';

const pluginId = 'org.it-tools.process-demo';

class FakeProcess implements ExternalExtensionProcessLike {
  readonly messages: unknown[] = [];
  readonly pid = 42;
  killed = false;
  killCalls = 0;
  killResults: Array<boolean | Error> = [];
  private messageListener?: (message: unknown) => void;
  private exitListener?: (code: number) => void;

  postMessage(message: unknown): void { this.messages.push(message); }

  kill(): boolean {
    this.killCalls += 1;
    const result = this.killResults.shift() ?? true;
    if (result instanceof Error) {
      throw result;
    }
    this.killed ||= result;
    return result;
  }

  on(event: 'message' | 'exit', listener: ((message: unknown) => void) | ((code: number) => void)): this {
    if (event === 'message') {
      this.messageListener = listener as (message: unknown) => void;
    }
    else {
      this.exitListener = listener as (code: number) => void;
    }
    return this;
  }

  removeListener(event: 'message' | 'exit'): this {
    if (event === 'message') {
      this.messageListener = undefined;
    }
    else {
      this.exitListener = undefined;
    }
    return this;
  }

  respond(message: unknown): void { this.messageListener?.(message); }
  exit(code = 1): void { this.exitListener?.(code); }
}

function request(requestId: string): ExternalExtensionRpcRequest {
  return {
    protocolVersion: 1,
    requestId,
    pluginId,
    method: 'activate',
    payload: { version: '1.0.0', grantedCapabilities: [] },
  };
}

describe('ExternalExtensionProcessTransport', () => {
  it('starts one isolated process and filters response identity', async () => {
    const child = new FakeProcess();
    const fork = vi.fn<ExternalExtensionProcessFork>(() => child);
    const transport = new ExternalExtensionProcessTransport({
      pluginId,
      workerPath: '/safe/worker.cjs',
      environment: { PATH: '/safe', SECRET: 'must-not-pass' },
      fork,
    });

    const pending = transport.send(request('request-1'), new AbortController().signal);
    expect(fork).toHaveBeenCalledWith('/safe/worker.cjs', [], expect.objectContaining({
      env: { PATH: '/safe' },
      stdio: 'ignore',
    }));
    child.respond({ protocolVersion: 1, requestId: 'request-1', pluginId: 'other.plugin', ok: true, result: true });
    child.respond({ protocolVersion: 1, requestId: 'request-1', pluginId, ok: true, result: { ready: true } });
    await expect(pending).resolves.toMatchObject({ ok: true, result: { ready: true } });
    expect(fork).toHaveBeenCalledTimes(1);
    const stopping = transport.dispose();
    expect(child.killed).toBe(true);
    child.exit(0);
    await stopping;
  });

  it('passes verified WASM launch metadata to its matching worker', async () => {
    const child = new FakeProcess();
    const fork = vi.fn<ExternalExtensionProcessFork>(() => child);
    const launchConfig = {
      pluginId,
      version: '1.0.0',
      packageRoot: '/safe/plugin/1.0.0',
      entrypoint: 'extension.wasm',
      entrypointSha256: 'a'.repeat(64),
    };
    const transport = new ExternalExtensionProcessTransport({ pluginId, workerPath: '/safe/worker.cjs', launchConfig, fork });
    const pending = transport.send(request('request-launch'), new AbortController().signal);
    const args = fork.mock.calls[0]![1] as string[];
    expect(parseExternalExtensionWorkerLaunchArguments(args)).toEqual(launchConfig);
    child.respond({ protocolVersion: 1, requestId: 'request-launch', pluginId, ok: true, result: true });
    await expect(pending).resolves.toMatchObject({ ok: true });
    const stopping = transport.dispose();
    child.exit(0);
    await stopping;
  });

  it('sends a cancel message and rejects the pending request', async () => {
    const child = new FakeProcess();
    const transport = new ExternalExtensionProcessTransport({ pluginId, workerPath: '/safe/worker.cjs', fork: () => child });
    const pending = transport.send(request('request-2'), new AbortController().signal);

    transport.cancel('request-2');
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(child.messages.at(-1)).toMatchObject({
      method: 'cancel',
      pluginId,
      payload: { targetRequestId: 'request-2' },
    });
    const stopping = transport.dispose();
    child.exit(0);
    await stopping;
  });

  it('turns an AbortSignal into a protocol cancel request', async () => {
    const child = new FakeProcess();
    const transport = new ExternalExtensionProcessTransport({ pluginId, workerPath: '/safe/worker.cjs', fork: () => child });
    const controller = new AbortController();
    const pending = transport.send(request('request-abort'), controller.signal);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(child.messages.at(-1)).toMatchObject({
      method: 'cancel',
      payload: { targetRequestId: 'request-abort' },
    });
    const stopping = transport.dispose();
    child.exit(0);
    await stopping;
  });

  it('preserves timeout classification when the process transport rejects cancellation first', async () => {
    const child = new FakeProcess();
    const transport = new ExternalExtensionProcessTransport({
      pluginId,
      workerPath: '/safe/worker.cjs',
      terminateOnCancel: true,
      fork: () => child,
    });
    const host = new ExternalExtensionRpcHost({ pluginId, version: '1.0.0', transport, timeoutMs: 10 });

    const activation = host.activate();
    const activationRequest = child.messages[0] as ExternalExtensionRpcRequest;
    child.respond({
      protocolVersion: 1,
      requestId: activationRequest.requestId,
      pluginId,
      ok: true,
      result: { ready: true },
    });
    await activation;

    await expect(host.executeCommand(`${pluginId}/slow`, null)).rejects.toMatchObject({ code: 'timeout' });
    expect(child.killed).toBe(true);
    const disposal = host.dispose();
    child.exit(0);
    await disposal;
  });

  it('keeps explicit process request cancellation classified as cancelled', async () => {
    const child = new FakeProcess();
    const transport = new ExternalExtensionProcessTransport({
      pluginId,
      workerPath: '/safe/worker.cjs',
      terminateOnCancel: true,
      fork: () => child,
    });
    const host = new ExternalExtensionRpcHost({ pluginId, version: '1.0.0', transport, timeoutMs: 1_000 });
    const activation = host.activate();
    const activationRequest = child.messages[0] as ExternalExtensionRpcRequest;
    child.respond({
      protocolVersion: 1,
      requestId: activationRequest.requestId,
      pluginId,
      ok: true,
      result: { ready: true },
    });
    await activation;

    const controller = new AbortController();
    const pending = host.executeCommand(`${pluginId}/cancel`, null, [], controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(child.killed).toBe(true);
    const disposal = host.dispose();
    child.exit(0);
    await disposal;
  });

  it('terminates a synchronous worker on cancellation and starts a fresh process later', async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const fork = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const transport = new ExternalExtensionProcessTransport({
      pluginId,
      workerPath: '/safe/worker.cjs',
      terminateOnCancel: true,
      fork,
    });
    const pending = transport.send(request('request-cancel'), new AbortController().signal);
    const other = transport.send(request('request-other'), new AbortController().signal);

    transport.cancel('request-cancel');
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await expect(other).rejects.toMatchObject({ code: 'transport-error' });
    expect(first.killed).toBe(true);
    await expect(transport.send(request('request-before-exit'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'transport-error' });
    expect(fork).toHaveBeenCalledTimes(1);
    first.exit(0);

    const restarted = transport.send(request('request-restart'), new AbortController().signal);
    second.respond({ protocolVersion: 1, requestId: 'request-restart', pluginId, ok: true, result: true });
    await expect(restarted).resolves.toMatchObject({ ok: true });
    expect(fork).toHaveBeenCalledTimes(2);
    const stopping = transport.dispose();
    second.exit(0);
    await stopping;
  });

  it('reports disposal only after the worker exits', async () => {
    const child = new FakeProcess();
    const onStopped = vi.fn();
    const transport = new ExternalExtensionProcessTransport({
      pluginId,
      workerPath: '/safe/worker.cjs',
      onStopped,
      fork: () => child,
    });
    const pending = transport.send(request('request-dispose'), new AbortController().signal);
    const disposal = transport.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'disposed' });
    expect(onStopped).not.toHaveBeenCalled();
    child.exit(0);
    await disposal;
    expect(onStopped).toHaveBeenCalledOnce();
    await transport.dispose();
    expect(onStopped).toHaveBeenCalledOnce();
  });

  it('rejects in-flight requests after process exit and blocks later sends after dispose', async () => {
    const child = new FakeProcess();
    const transport = new ExternalExtensionProcessTransport({ pluginId, workerPath: '/safe/worker.cjs', fork: () => child });
    const pending = transport.send(request('request-3'), new AbortController().signal);

    child.exit();
    await expect(pending).rejects.toBeInstanceOf(ExternalExtensionRpcError);
    await expect(pending).rejects.toMatchObject({ code: 'transport-error' });

    await transport.dispose();
    await expect(transport.send(request('request-4'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'disposed' });
  });

  // 模拟 kill 已发出但系统尚未报告退出，确认超时不会变成成功，也不会无限等待。
  it('does not complete disposal before the process exits and bounds the wait', async () => {
    const child = new FakeProcess();
    const transport = new ExternalExtensionProcessTransport({
      pluginId,
      workerPath: '/safe/worker.cjs',
      stopTimeoutMs: 5,
      fork: () => child,
    });
    const requestPromise = transport.send(request('request-bounded-stop'), new AbortController().signal);
    const stopping = transport.dispose();
    await expect(requestPromise).rejects.toMatchObject({ code: 'disposed' });
    await expect(stopping).rejects.toMatchObject({ code: 'timeout' });
    expect(child.killed).toBe(true);

    child.exit(0);
    await expect(transport.dispose()).resolves.toBeUndefined();
  });

  // kill() 返回 false 时保留旧进程，下一次 dispose 重试，并继续禁止启动新进程。
  it('retries a rejected kill on a later dispose without restarting before exit', async () => {
    const child = new FakeProcess();
    child.killResults = [false, true];
    const fork = vi.fn<ExternalExtensionProcessFork>(() => child);
    const onStopped = vi.fn();
    const transport = new ExternalExtensionProcessTransport({
      pluginId,
      workerPath: '/safe/worker.cjs',
      stopTimeoutMs: 5,
      onStopped,
      fork,
    });
    const pending = transport.send(request('request-kill-false'), new AbortController().signal);
    const firstStop = transport.dispose();

    await expect(pending).rejects.toMatchObject({ code: 'disposed' });
    expect(child.killCalls).toBe(1);
    await expect(transport.send(request('request-before-retry'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'disposed' });
    await expect(firstStop).rejects.toMatchObject({ code: 'timeout' });

    const retry = transport.dispose();
    expect(child.killCalls).toBe(2);
    expect(fork).toHaveBeenCalledTimes(1);
    expect(onStopped).not.toHaveBeenCalled();
    child.exit(0);
    await expect(retry).resolves.toBeUndefined();
    expect(onStopped).toHaveBeenCalledOnce();
  });

  // kill() 抛错时也保留旧进程并允许后续 dispose 重试停止请求。
  it('retries a thrown kill on a later dispose and waits for exit confirmation', async () => {
    const child = new FakeProcess();
    child.killResults = [new Error('temporary kill failure'), true];
    const fork = vi.fn<ExternalExtensionProcessFork>(() => child);
    const onStopped = vi.fn();
    const transport = new ExternalExtensionProcessTransport({
      pluginId,
      workerPath: '/safe/worker.cjs',
      stopTimeoutMs: 5,
      onStopped,
      fork,
    });
    const pending = transport.send(request('request-kill-throw'), new AbortController().signal);
    const firstStop = transport.dispose();

    await expect(pending).rejects.toMatchObject({ code: 'disposed' });
    expect(child.killCalls).toBe(1);
    await expect(firstStop).rejects.toMatchObject({ code: 'timeout' });

    const retry = transport.dispose();
    expect(child.killCalls).toBe(2);
    expect(fork).toHaveBeenCalledTimes(1);
    expect(onStopped).not.toHaveBeenCalled();
    child.exit(0);
    await expect(retry).resolves.toBeUndefined();
    expect(onStopped).toHaveBeenCalledOnce();
  });

  // 真实 RPC host 必须等待进程退出事件，不能只等待 worker 的 dispose 响应。
  it('waits for confirmed worker exit before the RPC host disposal resolves', async () => {
    const child = new FakeProcess();
    const transport = new ExternalExtensionProcessTransport({
      pluginId,
      workerPath: '/safe/worker.cjs',
      fork: () => child,
    });
    const host = new ExternalExtensionRpcHost({ pluginId, version: '1.0.0', transport });
    const activation = host.activate();
    const activationRequest = child.messages[0] as ExternalExtensionRpcRequest;
    child.respond({
      protocolVersion: 1,
      requestId: activationRequest.requestId,
      pluginId,
      ok: true,
      result: { ready: true },
    });
    await activation;

    const disposal = host.dispose();
    const disposeRequest = child.messages[1] as ExternalExtensionRpcRequest;
    expect(disposeRequest.method).toBe('dispose');
    child.respond({
      protocolVersion: 1,
      requestId: disposeRequest.requestId,
      pluginId,
      ok: true,
      result: true,
    });
    let disposalCompleted = false;
    const settled = disposal.then(() => { disposalCompleted = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(disposalCompleted).toBe(false);
    expect(child.killed).toBe(true);

    child.exit(0);
    await settled;
    expect(disposalCompleted).toBe(true);
  });
});
