import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type {
  SystemMonitorBridgeResult,
  SystemMonitorErrorCode,
  SystemMonitorWorkerSample,
} from '../../src/shared/desktop-services/system-monitor';
import {
  isSystemMonitorWorkerResponse,
  type SystemMonitorWorkerCommand,
} from './worker-protocol';

const SERVICE_TIMEOUT_MS = 5_000;
const SERVICE_NAME = 'IT Tools System Monitor';

type WorkerRequest = SystemMonitorWorkerCommand extends infer Command
  ? Command extends { requestId: string }
    ? Omit<Command, 'requestId'>
    : never
  : never;

type PendingResponse = {
  resolve: (result: SystemMonitorBridgeResult<unknown>) => void;
  timer: NodeJS.Timeout;
};

/** Isolates OS sampling from the main process and bounds each request lifetime. */
export class SystemMonitorServiceHost {
  private child: UtilityProcess | null = null;
  private readonly pending = new Map<string, PendingResponse>();

  constructor(private readonly workerPath = resolve(process.cwd(), 'out/main/system-monitor-worker.cjs')) {}

  sample(): Promise<SystemMonitorBridgeResult<SystemMonitorWorkerSample>> {
    return this.request<SystemMonitorWorkerSample>({ operation: 'sample' });
  }

  close(): void {
    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.kill();
      }
      catch {
        // The utility process exit still releases the OS sampling resources.
      }
    }
    this.failAll('service-unavailable');
  }

  private request<T>(command: WorkerRequest): Promise<SystemMonitorBridgeResult<T>> {
    const child = this.getOrStartWorker();
    if (!child) {
      return Promise.resolve({ ok: false, error: 'service-unavailable' });
    }

    const requestId = randomUUID();
    return new Promise((resolveResponse) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolveResponse({ ok: false, error: 'service-unavailable' });
        this.close();
      }, SERVICE_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: result => resolveResponse(result as SystemMonitorBridgeResult<T>),
        timer,
      });
      try {
        child.postMessage({ ...command, requestId });
      }
      catch {
        this.pending.delete(requestId);
        clearTimeout(timer);
        resolveResponse({ ok: false, error: 'service-unavailable' });
      }
    });
  }

  private getOrStartWorker(): UtilityProcess | null {
    if (this.child) {
      return this.child;
    }
    try {
      const child = utilityProcess.fork(this.workerPath, [], {
        env: getServiceEnvironment(),
        stdio: 'ignore',
        serviceName: SERVICE_NAME,
      });
      this.child = child;
      child.on('message', message => this.handleMessage(message));
      child.on('exit', () => {
        if (this.child === child) {
          this.child = null;
        }
        this.failAll('service-unavailable');
      });
      return child;
    }
    catch {
      return null;
    }
  }

  private handleMessage(value: unknown): void {
    if (!isSystemMonitorWorkerResponse(value)) {
      return;
    }
    const pending = this.pending.get(value.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(value.requestId);
    clearTimeout(pending.timer);
    pending.resolve(value.result);
  }

  private failAll(error: SystemMonitorErrorCode): void {
    const pendingRequests = [...this.pending.values()];
    this.pending.clear();
    for (const pending of pendingRequests) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error });
    }
  }
}

function getServiceEnvironment(): NodeJS.ProcessEnv {
  const allowedKeys = ['PATH', 'Path', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'] as const;
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  return environment;
}
