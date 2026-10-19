import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { DatabaseBridgeResult, DatabaseErrorCode } from '../../src/shared/desktop-services/database';
import type { DatabaseWorkerCommand, DatabaseWorkerResponse } from './protocol';

const DATABASE_SERVICE_TIMEOUT_MS = 30_000;
const DATABASE_SERVICE_NAME = 'IT Tools Database Service';

type PendingResponse = {
  resolve: (result: DatabaseBridgeResult<unknown>) => void;
  timer: NodeJS.Timeout;
};

type DatabaseWorkerRequest = DatabaseWorkerCommand extends infer Command
  ? Command extends { requestId: string }
    ? Omit<Command, 'requestId'>
    : never
  : never;

/** Correlates bounded main-process requests with one isolated database utility process. */
export class DatabaseServiceHost {
  private child: UtilityProcess | null = null;
  private readonly pending = new Map<string, PendingResponse>();

  constructor(private readonly workerPath = resolve(process.cwd(), 'out/main/database-worker.cjs')) {}

  request<T>(command: DatabaseWorkerRequest): Promise<DatabaseBridgeResult<T>> {
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
      }, DATABASE_SERVICE_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: result => resolveResponse(result as DatabaseBridgeResult<T>),
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

  close(): void {
    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.kill();
      }
      catch {
        // Process exit still closes PostgreSQL sockets when a graceful kill is unavailable.
      }
    }
    this.failAllPending('service-unavailable');
  }

  private getOrStartWorker(): UtilityProcess | null {
    if (this.child) {
      return this.child;
    }

    try {
      const child = utilityProcess.fork(this.workerPath, [], {
        env: getDatabaseServiceEnvironment(),
        stdio: 'ignore',
        serviceName: DATABASE_SERVICE_NAME,
      });
      this.child = child;
      child.on('message', message => this.handleMessage(message));
      child.on('exit', () => {
        if (this.child === child) {
          this.child = null;
        }
        this.failAllPending('service-unavailable');
      });
      return child;
    }
    catch {
      return null;
    }
  }

  private handleMessage(value: unknown): void {
    if (!isDatabaseWorkerResponse(value)) {
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

  private failAllPending(error: DatabaseErrorCode): void {
    const pendingRequests = [...this.pending.values()];
    this.pending.clear();
    for (const pending of pendingRequests) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error });
    }
  }
}

function getDatabaseServiceEnvironment(): NodeJS.ProcessEnv {
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

function isDatabaseWorkerResponse(value: unknown): value is DatabaseWorkerResponse {
  if (!isRecord(value)
    || typeof value.requestId !== 'string'
    || !isRecord(value.result)
    || typeof value.result.ok !== 'boolean') {
    return false;
  }
  if (value.result.ok) {
    return Object.keys(value.result).length === 2 && 'value' in value.result;
  }
  return Object.keys(value.result).length === 2
    && isDatabaseErrorCode(value.result.error);
}

function isDatabaseErrorCode(value: unknown): value is DatabaseErrorCode {
  return value === 'invalid-request'
    || value === 'untrusted-renderer'
    || value === 'service-unavailable'
    || value === 'connection-failed'
    || value === 'too-many-sessions'
    || value === 'not-connected'
    || value === 'query-failed'
    || value === 'query-timeout'
    || value === 'profile-storage-failed'
    || value === 'profile-limit-reached';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
