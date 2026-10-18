import type { TaskLimits, TaskOutcome, WorkerRequest, WorkerResponse, WorkerTask, WorkerTaskResult } from './task-runner.types';

export interface TaskWorker {
  onmessage: ((event: { data: WorkerResponse }) => void) | null
  onerror: (() => void) | null
  onmessageerror: (() => void) | null
  postMessage(message: WorkerRequest): void
  terminate(): void
}

interface TaskJob {
  id: number
  taskKey: string
  inputVersion: number
  task: WorkerTask
  limits: TaskLimits
  resolve: (outcome: TaskOutcome<WorkerTaskResult>) => void
}

interface ActiveTask extends TaskJob {
  worker: TaskWorker
  timeout: ReturnType<typeof setTimeout>
}

type WorkerFactory = () => TaskWorker;

function createWorker(): TaskWorker {
  return new Worker(new URL('./task-runner.worker.ts', import.meta.url), { type: 'module' }) as unknown as TaskWorker;
}

/** Bound worker concurrency, keep one replaceable pending task per tool, and terminate synchronous work on cancel or timeout. */
export class TaskRunner {
  private readonly pending = new Map<string, TaskJob>();
  private readonly active = new Map<string, ActiveTask>();
  private nextId = 0;

  constructor(
    private readonly workerFactory: WorkerFactory = createWorker,
    private readonly maxWorkers = 2,
  ) {}

  run(taskKey: string, inputVersion: number, task: Extract<WorkerTask, { kind: 'regex' }>, limits: TaskLimits): Promise<TaskOutcome<Extract<WorkerTaskResult, { kind: 'regex' }>>>
  run(taskKey: string, inputVersion: number, task: Extract<WorkerTask, { kind: 'text-diff' }>, limits: TaskLimits): Promise<TaskOutcome<Extract<WorkerTaskResult, { kind: 'text-diff' }>>>
  run(taskKey: string, inputVersion: number, task: Extract<WorkerTask, { kind: 'json-viewer' | 'json-minify' | 'csv-to-json' | 'json-to-csv' | 'json-lines' | 'xml-format' | 'xml-to-json' | 'json-to-xml' | 'yaml-to-json' | 'json-to-yaml' | 'toml-to-json' | 'toml-to-yaml' | 'json-to-toml' | 'yaml-to-toml' }>, limits: TaskLimits): Promise<TaskOutcome<Extract<WorkerTaskResult, { kind: 'json-viewer' | 'json-minify' | 'csv-to-json' | 'json-to-csv' | 'json-lines' | 'xml-format' | 'xml-to-json' | 'json-to-xml' | 'yaml-to-json' | 'json-to-yaml' | 'toml-to-json' | 'toml-to-yaml' | 'json-to-toml' | 'yaml-to-toml' }>>>
  run(taskKey: string, inputVersion: number, task: WorkerTask, limits: TaskLimits): Promise<TaskOutcome<WorkerTaskResult>> {
    this.cancel(taskKey);
    const inputCharacters = task.kind === 'regex'
      ? task.regex.length + task.text.length + task.flags.length
      : task.kind === 'text-diff'
        ? task.originalText.length + task.modifiedText.length
        : task.value.length;
    if (inputCharacters > limits.maxInputBytes) {
      return Promise.resolve({ status: 'input-limit' });
    }
    const inputBytes = new TextEncoder().encode(JSON.stringify(task)).byteLength;
    if (inputBytes > limits.maxInputBytes) {
      return Promise.resolve({ status: 'input-limit' });
    }

    return new Promise((resolve) => {
      const job: TaskJob = {
        id: ++this.nextId,
        taskKey,
        inputVersion,
        task,
        limits,
        resolve,
      };
      this.pending.set(taskKey, job);
      this.pump();
    });
  }

  cancel(taskKey: string): void {
    const pending = this.pending.get(taskKey);
    if (pending) {
      this.pending.delete(taskKey);
      pending.resolve({ status: 'cancelled' });
    }
    const active = this.active.get(taskKey);
    if (active) {
      this.finish(active, { status: 'cancelled' });
    }
  }

  private pump(): void {
    while (this.active.size < this.maxWorkers && this.pending.size > 0) {
      const next = this.pending.entries().next().value as [string, TaskJob] | undefined;
      if (!next) {
        return;
      }
      const [taskKey, job] = next;
      this.pending.delete(taskKey);
      this.start(job);
    }
  }

  private start(job: TaskJob): void {
    let worker: TaskWorker;
    try {
      worker = this.workerFactory();
    }
    catch {
      job.resolve({ status: 'error' });
      return;
    }

    const active: ActiveTask = {
      ...job,
      worker,
      timeout: setTimeout(() => this.finish(active, { status: 'timeout' }), job.limits.timeoutMs),
    };
    this.active.set(job.taskKey, active);
    worker.onmessage = ({ data }) => {
      if (data.id !== job.id || data.inputVersion !== job.inputVersion) {
        return;
      }
      if (data.ok) {
        this.finish(active, { status: 'success', result: data.result });
      }
      else {
        this.finish(active, {
          status: data.code === 'input-limit' || data.code === 'output-limit' ? data.code : 'error',
        });
      }
    };
    worker.onerror = () => this.finish(active, { status: 'error' });
    worker.onmessageerror = () => this.finish(active, { status: 'error' });

    try {
      worker.postMessage({ id: job.id, inputVersion: job.inputVersion, task: job.task, maxOutputBytes: job.limits.maxOutputBytes });
    }
    catch {
      this.finish(active, { status: 'error' });
    }
  }

  private finish(active: ActiveTask, outcome: TaskOutcome<WorkerTaskResult>): void {
    if (this.active.get(active.taskKey) !== active) {
      return;
    }
    this.active.delete(active.taskKey);
    clearTimeout(active.timeout);
    active.worker.terminate();
    active.resolve(outcome);
    this.pump();
  }
}

export const taskRunner = new TaskRunner();
