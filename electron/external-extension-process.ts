import { randomUUID } from 'node:crypto';
import { utilityProcess, type ForkOptions, type UtilityProcess } from 'electron';
import {
  externalExtensionRpcProtocolVersion,
  parseExternalExtensionRpcResponse,
  type ExternalExtensionRpcRequest,
} from '../src/shared/desktop-services/external-extension-rpc';
import { ExternalExtensionRpcError, type ExternalExtensionRpcTransport } from './external-extension-rpc';
import {
  encodeExternalExtensionWorkerLaunchArgument,
  type ExternalExtensionWorkerLaunchConfig,
} from './external-extension-worker-launch';

/** 传输层需要的最小进程接口，测试可以用内存对象替换 Electron 进程。 */
export interface ExternalExtensionProcessLike {
  readonly pid?: number;
  postMessage(message: unknown): void;
  kill(): boolean;
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  removeListener(event: 'message', listener: (message: unknown) => void): this;
  removeListener(event: 'exit', listener: (code: number) => void): this;
}

export type ExternalExtensionProcessFork = (
  modulePath: string,
  args: string[],
  options: Pick<ForkOptions, 'env' | 'stdio' | 'serviceName'>,
) => ExternalExtensionProcessLike;

export interface ExternalExtensionProcessTransportOptions {
  pluginId: string;
  workerPath: string;
  /** 主进程验签并复核文件后的 WASM 入口信息。 */
  launchConfig?: ExternalExtensionWorkerLaunchConfig;
  /** 同步计算无法响应取消消息时，终止进程以结束计算。 */
  terminateOnCancel?: boolean;
  /** 释放后在进程确认退出时通知调用方；未启动进程则立即通知。 */
  onStopped?: () => void;
  /** 等待进程退出的最长时间；超时后释放操作失败，调用方可稍后重试等待。 */
  stopTimeoutMs?: number;
  serviceName?: string;
  environment?: NodeJS.ProcessEnv;
  fork?: ExternalExtensionProcessFork;
}

type PendingRequest = {
  pluginId: string;
  resolve: (response: unknown) => void;
  reject: (error: unknown) => void;
};

/** 独立 utility process 的 RPC 传输；不加载插件入口，不执行任意外部代码。 */
export class ExternalExtensionProcessTransport implements ExternalExtensionRpcTransport {
  private child: ExternalExtensionProcessLike | null = null;
  private disposed = false;
  private stopping = false;
  /** 只有 kill() 接受停止请求后才置位；失败时保留后续重试机会。 */
  private killAccepted = false;
  private stoppedNotified = false;
  /** 并发释放时共用一次有界等待。 */
  private disposePromise: Promise<void> | null = null;
  /** 等待 Electron 确认进程退出的调用方。 */
  private readonly stopWaiters = new Set<() => void>();
  /** 防止停机等待无限挂起。 */
  private readonly stopTimeoutMs: number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly fork: ExternalExtensionProcessFork;
  private readonly onMessage = (message: unknown) => this.handleMessage(message);
  private readonly onExit = () => this.handleExit();

  constructor(private readonly options: ExternalExtensionProcessTransportOptions) {
    this.fork = options.fork ?? defaultFork;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(this.stopTimeoutMs) || this.stopTimeoutMs < 1) {
      throw new RangeError('The extension worker stop timeout must be a positive integer.');
    }
    if (options.launchConfig && options.launchConfig.pluginId !== options.pluginId) {
      throw new TypeError('The extension worker identity does not match the transport.');
    }
  }

  send(request: ExternalExtensionRpcRequest, signal: AbortSignal): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new ExternalExtensionRpcError('disposed'));
    }
    if (signal.aborted) {
      return Promise.reject(new ExternalExtensionRpcError('cancelled'));
    }
    let child: ExternalExtensionProcessLike;
    try {
      child = this.getOrStartProcess();
    }
    catch {
      return Promise.reject(new ExternalExtensionRpcError('transport-error'));
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.cancel(request.requestId);
      };
      this.pending.set(request.requestId, {
        pluginId: request.pluginId,
        resolve: response => {
          signal.removeEventListener('abort', onAbort);
          resolve(response);
        },
        reject: error => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      });
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        child.postMessage(request);
      }
      catch {
        this.pending.delete(request.requestId);
        signal.removeEventListener('abort', onAbort);
        reject(new ExternalExtensionRpcError('transport-error'));
      }
    });
  }

  cancel(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending || this.disposed) {
      return;
    }
    this.pending.delete(requestId);
    pending.reject(new ExternalExtensionRpcError('cancelled'));
    if (this.options.terminateOnCancel) {
      this.stopChild(new ExternalExtensionRpcError('transport-error'));
      return;
    }
    const child = this.child;
    if (!child) {
      return;
    }
    try {
      const cancelRequest: ExternalExtensionRpcRequest = {
        protocolVersion: externalExtensionRpcProtocolVersion,
        requestId: randomUUID(),
        pluginId: pending.pluginId,
        method: 'cancel',
        payload: { targetRequestId: requestId },
      };
      child.postMessage(cancelRequest);
    }
    catch {
      // 本地请求已经拒绝；进程退出时会继续清理其他请求。
    }
  }

  /** 请求停止进程，并在有限时间内等待 Electron 确认进程退出。 */
  dispose(): Promise<void> {
    if (this.stoppedNotified) {
      return Promise.resolve();
    }
    this.disposed = true;
    this.stopChild(new ExternalExtensionRpcError('disposed'));
    if (!this.child) {
      this.notifyStopped();
    }
    if (this.stoppedNotified) {
      return Promise.resolve();
    }
    if (!this.disposePromise) {
      const pending = new Promise<void>((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const onStopped = () => {
          if (timeout !== undefined) {
            clearTimeout(timeout);
          }
          this.stopWaiters.delete(onStopped);
          resolve();
        };
        this.stopWaiters.add(onStopped);
        timeout = setTimeout(() => {
          this.stopWaiters.delete(onStopped);
          reject(new ExternalExtensionRpcError('timeout'));
        }, this.stopTimeoutMs);
        if (this.stoppedNotified) {
          onStopped();
        }
      }).finally(() => {
        if (this.disposePromise === pending) {
          this.disposePromise = null;
        }
      });
      this.disposePromise = pending;
    }
    return this.disposePromise;
  }

  /** 取消同步计算时拒绝活动请求，并等待旧进程退出后才允许重启。 */
  private stopChild(error: ExternalExtensionRpcError): void {
    const child = this.child;
    this.rejectPending(error);
    if (!child) {
      return;
    }
    this.stopping = true;
    if (this.killAccepted) {
      return;
    }
    try {
      this.killAccepted = child.kill();
    }
    catch {
      // 保留退出监听并阻止新进程启动；后续 dispose 会重试停止请求。
      this.killAccepted = false;
    }
  }

  private getOrStartProcess(): ExternalExtensionProcessLike {
    if (this.child) {
      if (this.stopping) {
        throw new ExternalExtensionRpcError('transport-error');
      }
      return this.child;
    }
    const child = this.fork(
      this.options.workerPath,
      this.options.launchConfig ? [encodeExternalExtensionWorkerLaunchArgument(this.options.launchConfig)] : [],
      {
        env: getSafeEnvironment(this.options.environment),
        stdio: 'ignore',
        serviceName: this.options.serviceName ?? `IT Tools Extension Host (${this.options.pluginId})`,
      },
    );
    this.child = child;
    child.on('message', this.onMessage);
    child.on('exit', this.onExit);
    return child;
  }

  private handleMessage(value: unknown): void {
    const response = parseExternalExtensionRpcResponse(value);
    if (!response || response.pluginId !== this.options.pluginId) {
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(response.requestId);
    pending.resolve(response);
  }

  private handleExit(): void {
    const child = this.child;
    this.child = null;
    this.stopping = false;
    this.killAccepted = false;
    child?.removeListener('message', this.onMessage);
    child?.removeListener('exit', this.onExit);
    if (!this.disposed) {
      this.rejectPending(new ExternalExtensionRpcError('transport-error'));
    }
    if (this.disposed) {
      this.notifyStopped();
    }
  }

  private notifyStopped(): void {
    if (!this.stoppedNotified) {
      this.stoppedNotified = true;
      for (const resolve of [...this.stopWaiters]) {
        resolve();
      }
      this.options.onStopped?.();
    }
  }

  private rejectPending(error: ExternalExtensionRpcError): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) {
      request.reject(error);
    }
  }
}

/** 创建独立进程传输，要求调用方在 Electron `app.ready` 后创建。 */
export function createExternalExtensionProcessTransport(
  options: ExternalExtensionProcessTransportOptions,
): ExternalExtensionRpcTransport {
  return new ExternalExtensionProcessTransport(options);
}

function defaultFork(
  modulePath: string,
  args: string[],
  options: Pick<ForkOptions, 'env' | 'stdio' | 'serviceName'>,
): UtilityProcess {
  return utilityProcess.fork(modulePath, args, options);
}

function getSafeEnvironment(environment: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const allowedKeys = ['PATH', 'Path', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'] as const;
  const safeEnvironment: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    const value = environment?.[key] ?? process.env[key];
    if (value !== undefined) {
      safeEnvironment[key] = value;
    }
  }
  return safeEnvironment;
}
