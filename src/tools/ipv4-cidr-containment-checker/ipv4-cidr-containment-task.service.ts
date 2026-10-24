import { taskLimits } from '@/task-runner/task-runner.types';
import type { WorkerRequest, WorkerResponse } from '@/task-runner/task-runner.types';
import {
  analyzeIpv4CidrContainment,
  Ipv4CidrContainmentCheckerError,
  Ipv4CidrContainmentLimitError,
} from './ipv4-cidr-containment-checker.service';

const textEncoder = new TextEncoder();
const maximumMatches = 500;

function countLines(value: string) {
  if (value === '') { return 0; }
  let lineCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x000a) { lineCount += 1; }
  }
  return lineCount;
}

function outputLimit(requestedLimit: number) {
  return Number.isSafeInteger(requestedLimit) && requestedLimit >= 0
    ? Math.min(requestedLimit, taskLimits.ipv4CidrContainment.maxOutputBytes)
    : 0;
}

function outputLimitResponse(response: Pick<WorkerResponse, 'id' | 'inputVersion'>): WorkerResponse {
  return { ...response, ok: false, code: 'output-limit' };
}

/** Bound the combined inputs and match report before transferring containment results to the renderer. */
export function executeIpv4CidrContainmentTask(request: WorkerRequest): WorkerResponse {
  const response = { id: request.id, inputVersion: request.inputVersion };
  if (request.task.kind !== 'ipv4-cidr-containment') {
    return { ...response, ok: false, code: 'error' };
  }

  const { rules, targets } = request.task;
  const limits = taskLimits.ipv4CidrContainment;
  const totalInputBytes = textEncoder.encode(rules).byteLength + textEncoder.encode(targets).byteLength;
  const totalLines = countLines(rules) + countLines(targets);
  if (totalInputBytes > limits.maxInputBytes || totalLines > (limits.maxLines ?? Number.MAX_SAFE_INTEGER)) {
    return { ...response, ok: false, code: 'input-limit' };
  }

  const maxOutputBytes = outputLimit(request.maxOutputBytes);
  try {
    const analysis = analyzeIpv4CidrContainment(rules, targets, { maxMatches: maximumMatches });
    const result = { kind: 'ipv4-cidr-containment' as const, valid: true, analysis };
    if (textEncoder.encode(JSON.stringify(result)).byteLength > maxOutputBytes) {
      return outputLimitResponse(response);
    }
    return { ...response, ok: true, result };
  }
  catch (error) {
    if (!(error instanceof Ipv4CidrContainmentCheckerError || error instanceof Ipv4CidrContainmentLimitError)) {
      return { ...response, ok: false, code: 'error' };
    }

    const result = { kind: 'ipv4-cidr-containment' as const, valid: false, errorMessage: error.message };
    if (textEncoder.encode(JSON.stringify(result)).byteLength > maxOutputBytes) {
      return outputLimitResponse(response);
    }
    return { ...response, ok: true, result };
  }
}
