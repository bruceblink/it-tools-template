import { executeDockerComposeTask } from '@/tools/docker-run-to-docker-compose-converter/docker-compose-task.service';
import type { WorkerRequest, WorkerResponse } from './task-runner.types';

interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null
  postMessage(message: WorkerResponse): void
}

const workerScope = self as unknown as WorkerScope;
const workerGlobal = globalThis as typeof globalThis & { window?: typeof globalThis };
const workerHadWindow = typeof workerGlobal.window !== 'undefined';

// yamljs 0.3.0 expects a browser global when Vite loads it as ESM inside a Worker.
if (!workerHadWindow) {
  Object.defineProperty(workerGlobal, 'window', { value: workerGlobal, configurable: true });
}

const composerize = import('composerize-ts').then(({ composerize }) => {
  if (!workerHadWindow) {
    Reflect.deleteProperty(workerGlobal, 'window');
  }
  return composerize;
});

workerScope.onmessage = async ({ data }) => {
  try {
    workerScope.postMessage(executeDockerComposeTask(data, await composerize));
  }
  catch {
    workerScope.postMessage({ id: data.id, inputVersion: data.inputVersion, ok: false, code: 'error' });
  }
};
