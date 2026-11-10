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
  private readonly pending = new Map<string, PendingRequest>();
  private readonly fork: ExternalExtensionProcessFork;
  private readonly onMessage = (message: unknown) => this.handleMessage(message);
  private readonly onExit = () => this.handleExit();

  constructor(private readonly options: ExternalExtensionProcessTransportOptions) {
    this.fork = options.fork ?? defaultFork;
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

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopChild(new ExternalExtensionRpcError('disposed'));
  }

  /** 取消同步计算时同时拒绝其他请求，后续请求重新创建进程。 */
  private stopChild(error: ExternalExtensionRpcError): void {
    const child = this.child;
    this.child = null;
    this.rejectPending(error);
    if (!child) {
      return;
    }
    child.removeListener('message', this.onMessage);
    child.removeListener('exit', this.onExit);
    try {
      child.kill();
    }
    catch {
      // 进程退出属于尽力清理，活动请求已经被拒绝。
    }
  }

  private getOrStartProcess(): ExternalExtensionProcessLike {
    if (this.child) {
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
    this.child = null;
    if (!this.disposed) {
      this.rejectPending(new ExternalExtensionRpcError('transport-error'));
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
