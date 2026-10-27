import { executeIntegerBaseConverterTask } from '@/tools/integer-base-converter/integer-base-converter-task.service';
import type { WorkerRequest, WorkerResponse } from './task-runner.types';

interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null
  postMessage(message: WorkerResponse): void
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = ({ data }) => {
  workerScope.postMessage(executeIntegerBaseConverterTask(data));
};
