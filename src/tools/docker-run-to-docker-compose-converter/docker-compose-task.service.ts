import { taskLimits } from '@/task-runner/task-runner.types';
import type { WorkerRequest, WorkerResponse } from '@/task-runner/task-runner.types';

const textEncoder = new TextEncoder();
type Composerize = typeof import('composerize-ts').composerize;

/** Convert Docker run input in a dedicated Worker and cap the structured result before it crosses the worker boundary. */
export function executeDockerComposeTask(request: WorkerRequest, composerize: Composerize): WorkerResponse {
  const response = { id: request.id, inputVersion: request.inputVersion };
  if (request.task.kind !== 'docker-run-to-compose') {
    return { ...response, ok: false, code: 'error' };
  }

  if (textEncoder.encode(request.task.value).byteLength > taskLimits.dockerRunToCompose.maxInputBytes) {
    return { ...response, ok: false, code: 'input-limit' };
  }

  try {
    const converted = composerize(request.task.value);
    const result = {
      kind: 'docker-run-to-compose' as const,
      yaml: converted.yaml,
      messages: converted.messages,
    };
    const outputLimit = Number.isSafeInteger(request.maxOutputBytes) && request.maxOutputBytes >= 0
      ? Math.min(request.maxOutputBytes, taskLimits.dockerRunToCompose.maxOutputBytes)
      : 0;
    if (textEncoder.encode(JSON.stringify(result)).byteLength > outputLimit) {
      return { ...response, ok: false, code: 'output-limit' };
    }

    return { ...response, ok: true, result };
  }
  catch {
    return { ...response, ok: false, code: 'error' };
  }
}
