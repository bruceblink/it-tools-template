import { evaluateMathExpression, MathExpressionLimitError } from '@/tools/math-evaluator/math-evaluator.service';
import type { WorkerRequest, WorkerResponse } from './task-runner.types';

interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null
  postMessage(message: WorkerResponse): void
}

const workerScope = self as unknown as WorkerScope;

// Parse, preflight, and evaluate math expressions outside the renderer thread.
workerScope.onmessage = async ({ data }) => {
  const task = data.task;
  if (task.kind !== 'math-evaluate') {
    workerScope.postMessage({ id: data.id, inputVersion: data.inputVersion, ok: false, code: 'error' });
    return;
  }

  let result: WorkerResponse;
  try {
    const mathResult = {
      kind: 'math-evaluate' as const,
      valid: true,
      output: await evaluateMathExpression(task.value),
    };
    const outputBytes = new TextEncoder().encode(JSON.stringify(mathResult)).byteLength;
    result = outputBytes > data.maxOutputBytes
      ? { id: data.id, inputVersion: data.inputVersion, ok: false, code: 'output-limit' }
      : { id: data.id, inputVersion: data.inputVersion, ok: true, result: mathResult };
  }
  catch (error) {
    result = {
      id: data.id,
      inputVersion: data.inputVersion,
      ok: true,
      result: {
        kind: 'math-evaluate',
        valid: false,
        output: '',
        errorCode: error instanceof MathExpressionLimitError || error instanceof RangeError ? 'limit' : 'invalid',
      },
    };
  }

  workerScope.postMessage(result);
};
