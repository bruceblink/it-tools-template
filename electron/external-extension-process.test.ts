import { describe, expect, it, vi } from 'vitest';
import { ExternalExtensionProcessTransport, type ExternalExtensionProcessLike } from './external-extension-process';
import { ExternalExtensionRpcError } from './external-extension-rpc';
import type { ExternalExtensionRpcRequest } from '../src/shared/desktop-services/external-extension-rpc';

const pluginId = 'org.it-tools.process-demo';

class FakeProcess implements ExternalExtensionProcessLike {
  readonly messages: unknown[] = [];
  readonly pid = 42;
  killed = false;
  private messageListener?: (message: unknown) => void;
  private exitListener?: (code: number) => void;

  postMessage(message: unknown): void { this.messages.push(message); }

  kill(): boolean { this.killed = true; return true; }

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
    const fork = vi.fn(() => child);
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
    transport.dispose();
    expect(child.killed).toBe(true);
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
    transport.dispose();
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
    transport.dispose();
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

    const restarted = transport.send(request('request-restart'), new AbortController().signal);
    second.respond({ protocolVersion: 1, requestId: 'request-restart', pluginId, ok: true, result: true });
    await expect(restarted).resolves.toMatchObject({ ok: true });
    expect(fork).toHaveBeenCalledTimes(2);
    transport.dispose();
  });

  it('rejects in-flight requests after process exit and blocks later sends after dispose', async () => {
    const child = new FakeProcess();
    const transport = new ExternalExtensionProcessTransport({ pluginId, workerPath: '/safe/worker.cjs', fork: () => child });
    const pending = transport.send(request('request-3'), new AbortController().signal);

    child.exit();
    await expect(pending).rejects.toBeInstanceOf(ExternalExtensionRpcError);
    await expect(pending).rejects.toMatchObject({ code: 'transport-error' });

    transport.dispose();
    await expect(transport.send(request('request-4'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'disposed' });
  });
});
