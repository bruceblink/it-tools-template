import { assertWorkerOutputSize, executeWorkerTask, TaskExecutionError } from './task-runner.dispatch';
import type { WorkerRequest, WorkerResponse } from './task-runner.types';

interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null
  postMessage(message: WorkerResponse): void
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = ({ data }) => {
  try {
    const result = executeWorkerTask(data.task);
    assertWorkerOutputSize(result, data.maxOutputBytes);
    workerScope.postMessage({ id: data.id, inputVersion: data.inputVersion, ok: true, result });
  }
  catch (error) {
    workerScope.postMessage({
      id: data.id,
      inputVersion: data.inputVersion,
      ok: false,
      code: error instanceof TaskExecutionError ? error.code : 'error',
    });
  }
};
