import { formatSqlQuery } from '@/tools/sql-prettify/sql-prettify.service';
import type { WorkerRequest, WorkerResponse } from './task-runner.types';

interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null
  postMessage(message: WorkerResponse): void
}

const workerScope = self as unknown as WorkerScope;

// Format SQL outside the renderer and cap the serialized result before crossing the worker boundary.
workerScope.onmessage = ({ data }) => {
  if (data.task.kind !== 'sql-format') {
    workerScope.postMessage({ id: data.id, inputVersion: data.inputVersion, ok: false, code: 'error' });
    return;
  }

  let result: WorkerResponse;
  try {
    const formatted = formatSqlQuery(data.task.value, data.task.options);
    const taskResult = { kind: 'sql-format' as const, valid: true, output: formatted };
    const outputBytes = new TextEncoder().encode(JSON.stringify(taskResult)).byteLength;
    result = outputBytes > data.maxOutputBytes
      ? { id: data.id, inputVersion: data.inputVersion, ok: false, code: 'output-limit' }
      : { id: data.id, inputVersion: data.inputVersion, ok: true, result: taskResult };
  }
  catch {
    result = { id: data.id, inputVersion: data.inputVersion, ok: false, code: 'error' };
  }

  workerScope.postMessage(result);
};
