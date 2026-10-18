import { compareBcryptHash, generateBcryptHash } from '@/tools/bcrypt/bcrypt.service';
import type { WorkerRequest, WorkerResponse } from './task-runner.types';

interface WorkerScope {
  onmessage: ((event: { data: WorkerRequest }) => void) | null
  postMessage(message: WorkerResponse): void
}

const workerScope = self as unknown as WorkerScope;

// Keep bcrypt hashing and comparison off the renderer thread; TaskRunner terminates work at its deadline.
workerScope.onmessage = ({ data }) => {
  let response: WorkerResponse;
  try {
    const task = data.task;
    const result = task.kind === 'bcrypt-hash'
      ? { kind: 'bcrypt-hash' as const, hash: generateBcryptHash(task.value, task.saltRounds) }
      : task.kind === 'bcrypt-compare'
        ? { kind: 'bcrypt-compare' as const, matches: compareBcryptHash(task.value, task.hash) }
        : undefined;

    if (!result) {
      response = { id: data.id, inputVersion: data.inputVersion, ok: false, code: 'error' };
    }
    else if (new TextEncoder().encode(JSON.stringify(result)).byteLength > data.maxOutputBytes) {
      response = { id: data.id, inputVersion: data.inputVersion, ok: false, code: 'output-limit' };
    }
    else {
      response = { id: data.id, inputVersion: data.inputVersion, ok: true, result };
    }
  }
  catch {
    response = { id: data.id, inputVersion: data.inputVersion, ok: false, code: 'error' };
  }

  workerScope.postMessage(response);
};
