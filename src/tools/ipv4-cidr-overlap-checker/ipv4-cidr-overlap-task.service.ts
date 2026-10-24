import { taskLimits } from '@/task-runner/task-runner.types';
import type { WorkerRequest, WorkerResponse } from '@/task-runner/task-runner.types';
import { analyzeIpv4CidrOverlaps, Ipv4CidrOverlapCheckerError, Ipv4CidrOverlapLimitError } from './ipv4-cidr-overlap-checker.service';

const textEncoder = new TextEncoder();
const maximumOverlaps = 500;

function countLines(value: string) {
  let lineCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x000a) { lineCount += 1; }
  }
  return lineCount;
}

function outputLimit(requestedLimit: number) {
  return Number.isSafeInteger(requestedLimit) && requestedLimit >= 0
    ? Math.min(requestedLimit, taskLimits.ipv4CidrOverlap.maxOutputBytes)
    : 0;
}

function outputLimitResponse(response: Pick<WorkerResponse, 'id' | 'inputVersion'>): WorkerResponse {
  return { ...response, ok: false, code: 'output-limit' };
}

/** Bound input and pair growth before transferring the complete CIDR report to the renderer. */
export function executeIpv4CidrOverlapTask(request: WorkerRequest): WorkerResponse {
  const response = { id: request.id, inputVersion: request.inputVersion };
  if (request.task.kind !== 'ipv4-cidr-overlap') {
    return { ...response, ok: false, code: 'error' };
  }

  const { value } = request.task;
  const limits = taskLimits.ipv4CidrOverlap;
  if (textEncoder.encode(value).byteLength > limits.maxInputBytes || countLines(value) > (limits.maxLines ?? Number.MAX_SAFE_INTEGER)) {
    return { ...response, ok: false, code: 'input-limit' };
  }

  const maxOutputBytes = outputLimit(request.maxOutputBytes);
  try {
    const analysis = analyzeIpv4CidrOverlaps(value, { maxOverlaps: maximumOverlaps });
    const result = { kind: 'ipv4-cidr-overlap' as const, valid: true, analysis };
    if (textEncoder.encode(JSON.stringify(result)).byteLength > maxOutputBytes) {
      return outputLimitResponse(response);
    }
    return { ...response, ok: true, result };
  }
  catch (error) {
    if (!(error instanceof Ipv4CidrOverlapCheckerError || error instanceof Ipv4CidrOverlapLimitError)) {
      return { ...response, ok: false, code: 'error' };
    }

    const result = { kind: 'ipv4-cidr-overlap' as const, valid: false, errorMessage: error.message };
    if (textEncoder.encode(JSON.stringify(result)).byteLength > maxOutputBytes) {
      return outputLimitResponse(response);
    }
    return { ...response, ok: true, result };
  }
}
