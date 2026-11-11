import { randomUUID } from 'node:crypto';
import type { ToolCapability } from '../src/tools/tools.types';
import {
  externalExtensionRpcProtocolVersion,
  getExternalExtensionRpcPayloadBytes,
  parseExternalExtensionRpcResponse,
  type ExternalExtensionCapabilityContext,
  type ExternalExtensionRpcErrorCode,
  type ExternalExtensionRpcJsonValue,
  type ExternalExtensionRpcRequest,
  type ExternalExtensionRpcResponse,
} from '../src/shared/desktop-services/external-extension-rpc';

export const externalExtensionRpcDefaults = Object.freeze({
  timeoutMs: 10_000,
  maximumPayloadBytes: 16 * 1024,
  maximumConcurrentRequests: 4,
});

export interface ExternalExtensionRpcTransport {
  /** 向隔离的扩展宿主发送一条已校验请求。 */
  send(request: ExternalExtensionRpcRequest, signal: AbortSignal): Promise<unknown>;
  /** 请求传输层取消仍在运行的请求。 */
  cancel?(requestId: string): void;
  /** 释放传输层和扩展宿主资源。 */
  dispose(): void | Promise<void>;
}

export interface ExternalExtensionRpcHostOptions {
  pluginId: string;
  version: string;
  transport: ExternalExtensionRpcTransport;
  grantedCapabilities?: readonly ToolCapability[];
  timeoutMs?: number;
  maximumPayloadBytes?: number;
  maximumConcurrentRequests?: number;
}

export class ExternalExtensionRpcError extends Error {
  constructor(
    readonly code: ExternalExtensionRpcErrorCode,
    message = code,
  ) {
    super(message);
    this.name = 'ExternalExtensionRpcError';
  }
}

/**
 * 调用隔离扩展宿主的最小适配器。
 * 它只传输 JSON 数据，不接收 DOM、Vue 组件或主窗口句柄。
 */
export class ExternalExtensionRpcHost {
  private readonly grantedCapabilities: ReadonlySet<ToolCapability>;
  private readonly timeoutMs: number;
  private readonly maximumPayloadBytes: number;
  private readonly maximumConcurrentRequests: number;
  private active = false;
  private disposed = false;
  private inFlight = 0;
  /** 并发释放共享同一个完成结果；超时后允许再次等待传输层退出。 */
  private disposePromise: Promise<void> | null = null;

  constructor(private readonly options: ExternalExtensionRpcHostOptions) {
    this.grantedCapabilities = new Set(options.grantedCapabilities ?? []);
    // v2 只允许本次命令读取只读的宿主上下文，不在扩展进程中执行持久化写入。
    if ([...this.grantedCapabilities].some(capability => capability !== 'runtime.info' && capability !== 'settings.read')) {
      throw new ExternalExtensionRpcError('permission-denied');
    }
    this.timeoutMs = options.timeoutMs ?? externalExtensionRpcDefaults.timeoutMs;
    this.maximumPayloadBytes = options.maximumPayloadBytes ?? externalExtensionRpcDefaults.maximumPayloadBytes;
    this.maximumConcurrentRequests = options.maximumConcurrentRequests ?? externalExtensionRpcDefaults.maximumConcurrentRequests;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new RangeError('The extension RPC timeout must be a positive integer.');
    }
    if (!Number.isSafeInteger(this.maximumPayloadBytes) || this.maximumPayloadBytes < 1) {
      throw new RangeError('The extension RPC payload limit must be a positive integer.');
    }
    if (!Number.isSafeInteger(this.maximumConcurrentRequests) || this.maximumConcurrentRequests < 1) {
      throw new RangeError('The extension RPC concurrency limit must be a positive integer.');
    }
  }

  async activate(signal?: AbortSignal): Promise<void> {
    this.assertUsable();
    if (this.active) {
      return;
    }
    await this.call({
      method: 'activate',
      payload: {
        version: this.options.version,
        grantedCapabilities: [...this.grantedCapabilities],
      },
    }, signal);
    this.active = true;
  }

  async executeCommand(
    commandId: string,
    input: ExternalExtensionRpcJsonValue,
    requiredCapabilities: readonly ToolCapability[] = [],
    signal?: AbortSignal,
    capabilityContext?: ExternalExtensionCapabilityContext,
  ): Promise<ExternalExtensionRpcJsonValue | undefined> {
    this.assertActive();
    this.assertCapabilities(requiredCapabilities);
    const requiresRuntimeInfo = requiredCapabilities.includes('runtime.info');
    const requiresSettings = requiredCapabilities.includes('settings.read');
    // 不能让 renderer 或其他调用方在无 grant 时附带宿主上下文。
    if (requiredCapabilities.some(capability => capability !== 'runtime.info' && capability !== 'settings.read')
      || (requiresRuntimeInfo || requiresSettings) !== (capabilityContext !== undefined)
      || (requiresRuntimeInfo !== (capabilityContext?.runtimeInfo !== undefined))
      || (requiresSettings !== (capabilityContext?.settings !== undefined))) {
      throw new ExternalExtensionRpcError('permission-denied');
    }
    return this.call({
      method: 'executeCommand',
      payload: {
        commandId,
        input,
        requiredCapabilities,
        ...(capabilityContext === undefined ? {} : { capabilityContext }),
      },
    }, signal);
  }

  async readData(
    providerId: string,
    query?: ExternalExtensionRpcJsonValue,
    signal?: AbortSignal,
  ): Promise<ExternalExtensionRpcJsonValue | undefined> {
    this.assertActive();
    return this.call({ method: 'readData', payload: { providerId, query } }, signal);
  }

  async getSetting(settingId: string, signal?: AbortSignal): Promise<ExternalExtensionRpcJsonValue | undefined> {
    this.assertActive();
    return this.call({ method: 'getSetting', payload: { settingId } }, signal);
  }

  async setSetting(
    settingId: string,
    value: ExternalExtensionRpcJsonValue,
    signal?: AbortSignal,
  ): Promise<ExternalExtensionRpcJsonValue | undefined> {
    this.assertActive();
    return this.call({ method: 'setSetting', payload: { settingId, value } }, signal);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }
    const pending = this.disposeOnce();
    this.disposePromise = pending;
    pending.catch(() => {
      if (this.disposePromise === pending) {
        this.disposePromise = null;
      }
    });
    return pending;
  }

  /** 先请求扩展清理，再等待底层进程或传输完成停止。 */
  private async disposeOnce(): Promise<void> {
    if (this.disposed) {
      await this.options.transport.dispose();
      return;
    }
    if (this.active) {
      await this.call({ method: 'dispose', payload: {} }).catch(() => undefined);
    }
    this.active = false;
    this.disposed = true;
    await this.options.transport.dispose();
  }

  private async call(
    requestData: Omit<ExternalExtensionRpcRequest, 'protocolVersion' | 'requestId' | 'pluginId'>,
    signal?: AbortSignal,
  ): Promise<ExternalExtensionRpcJsonValue | undefined> {
    this.assertUsable();
    if (this.inFlight >= this.maximumConcurrentRequests) {
      throw new ExternalExtensionRpcError('too-many-requests');
    }
    const request = {
      protocolVersion: externalExtensionRpcProtocolVersion,
      requestId: randomUUID(),
      pluginId: this.options.pluginId,
      ...requestData,
    } as ExternalExtensionRpcRequest;
    const payloadBytes = getExternalExtensionRpcPayloadBytes(request);
    if (payloadBytes === null || payloadBytes > this.maximumPayloadBytes) {
      throw new ExternalExtensionRpcError('payload-too-large');
    }
    if (signal?.aborted) {
      throw new ExternalExtensionRpcError('cancelled');
    }

    this.inFlight += 1;
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort('timeout'), this.timeoutMs);
    let onControllerAbort: (() => void) | undefined;
    try {
      const responsePromise = this.options.transport.send(request, controller.signal);
      const aborted = new Promise<never>((_resolve, reject) => {
        onControllerAbort = () => reject(new ExternalExtensionRpcError(signal?.aborted ? 'cancelled' : 'timeout'));
        controller.signal.addEventListener('abort', onControllerAbort, { once: true });
        if (controller.signal.aborted) {
          onControllerAbort();
        }
      });
      const response = await Promise.race([responsePromise, aborted]);
      if (controller.signal.aborted) {
        this.options.transport.cancel?.(request.requestId);
        throw new ExternalExtensionRpcError(signal?.aborted ? 'cancelled' : 'timeout');
      }
      const parsed = parseExternalExtensionRpcResponse(response);
      if (!parsed || parsed.requestId !== request.requestId || parsed.pluginId !== this.options.pluginId) {
        throw new ExternalExtensionRpcError('transport-error');
      }
      return this.unwrap(parsed);
    }
    catch (error) {
      if (signal?.aborted) {
        this.options.transport.cancel?.(request.requestId);
        throw new ExternalExtensionRpcError('cancelled');
      }
      if (controller.signal.aborted) {
        this.options.transport.cancel?.(request.requestId);
        throw new ExternalExtensionRpcError('timeout');
      }
      if (error instanceof ExternalExtensionRpcError) {
        throw error;
      }
      throw new ExternalExtensionRpcError('transport-error');
    }
    finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      if (onControllerAbort) {
        controller.signal.removeEventListener('abort', onControllerAbort);
      }
      this.inFlight -= 1;
    }
  }

  private unwrap(response: ExternalExtensionRpcResponse): ExternalExtensionRpcJsonValue | undefined {
    if (!response.ok) {
      throw new ExternalExtensionRpcError(response.error);
    }
    return response.result;
  }

  private assertCapabilities(requiredCapabilities: readonly ToolCapability[]): void {
    if (new Set(requiredCapabilities).size !== requiredCapabilities.length
      || requiredCapabilities.some(capability => !this.grantedCapabilities.has(capability))) {
      throw new ExternalExtensionRpcError('permission-denied');
    }
  }

  private assertActive(): void {
    this.assertUsable();
    if (!this.active) {
      throw new ExternalExtensionRpcError('not-active');
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new ExternalExtensionRpcError('disposed');
    }
  }
}

/** 可用于单元测试和后续 utility process 适配的内存传输。 */
export function createInProcessExternalExtensionRpcTransport(
  handler: (request: ExternalExtensionRpcRequest, signal: AbortSignal) => Promise<ExternalExtensionRpcResponse> | ExternalExtensionRpcResponse,
): ExternalExtensionRpcTransport {
  let disposed = false;
  const cancelled = new Set<string>();
  return {
    async send(request, signal) {
      if (disposed) {
        throw new Error('The extension RPC transport is disposed.');
      }
      if (signal.aborted || cancelled.has(request.requestId)) {
        throw new ExternalExtensionRpcError('cancelled');
      }
      return handler(request, signal);
    },
    cancel(requestId) {
      cancelled.add(requestId);
    },
    dispose() {
      disposed = true;
      cancelled.clear();
    },
  };
}
