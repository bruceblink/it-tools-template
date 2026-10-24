import { taskLimits } from '@/task-runner/task-runner.types';
import type { WorkerRequest, WorkerResponse } from '@/task-runner/task-runner.types';
import { Ipv4CidrMergeError, mergeIpv4Ranges, parseIpv4Ranges, rangeToCidrs } from './ipv4-cidr-merge.service';

const textEncoder = new TextEncoder();
const emptyResultBytes = textEncoder.encode(JSON.stringify({ kind: 'ipv4-cidr-merge', valid: true, output: '' })).byteLength;

function countLines(value: string) {
  let lineCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x000a) { lineCount += 1; }
  }
  return lineCount;
}

function serializedOutputLimit(requestedLimit: number) {
  return Number.isSafeInteger(requestedLimit) && requestedLimit >= 0
    ? Math.min(requestedLimit, taskLimits.ipv4CidrMerge.maxOutputBytes)
    : 0;
}

function outputLimitResponse(response: Pick<WorkerResponse, 'id' | 'inputVersion'>): WorkerResponse {
  return { ...response, ok: false, code: 'output-limit' };
}

/** Merge bounded address input and stop collecting CIDRs before their serialized result exceeds the host limit. */
export function executeIpv4CidrMergeTask(request: WorkerRequest): WorkerResponse {
  const response = { id: request.id, inputVersion: request.inputVersion };
  if (request.task.kind !== 'ipv4-cidr-merge') {
    return { ...response, ok: false, code: 'error' };
  }

  const { value } = request.task;
  const limits = taskLimits.ipv4CidrMerge;
  if (textEncoder.encode(value).byteLength > limits.maxInputBytes || countLines(value) > (limits.maxLines ?? Number.MAX_SAFE_INTEGER)) {
    return { ...response, ok: false, code: 'input-limit' };
  }

  const outputLimit = serializedOutputLimit(request.maxOutputBytes);
  if (emptyResultBytes > outputLimit) {
    return outputLimitResponse(response);
  }

  try {
    if (value.trim() === '') {
      return {
        ...response,
        ok: true,
        result: { kind: 'ipv4-cidr-merge', valid: true, output: '' },
      };
    }

    const ranges = mergeIpv4Ranges(parseIpv4Ranges(value));
    const cidrs: string[] = [];
    let serializedBytes = emptyResultBytes;
    for (const range of ranges) {
      for (const cidr of rangeToCidrs(range)) {
        // Generated CIDRs are ASCII; JSON escapes each line break into two bytes.
        serializedBytes += cidr.length + (cidrs.length > 0 ? 2 : 0);
        if (serializedBytes > outputLimit) {
          return outputLimitResponse(response);
        }
        cidrs.push(cidr);
      }
    }

    const result = { kind: 'ipv4-cidr-merge' as const, valid: true, output: cidrs.join('\n') };
    if (textEncoder.encode(JSON.stringify(result)).byteLength > outputLimit) {
      return outputLimitResponse(response);
    }
    return { ...response, ok: true, result };
  }
  catch (error) {
    const result = {
      kind: 'ipv4-cidr-merge' as const,
      valid: false,
      output: '',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    if (error instanceof Ipv4CidrMergeError && textEncoder.encode(JSON.stringify(result)).byteLength <= outputLimit) {
      return { ...response, ok: true, result };
    }
    if (textEncoder.encode(JSON.stringify(result)).byteLength > outputLimit) {
      return outputLimitResponse(response);
    }
    return { ...response, ok: false, code: 'error' };
  }
}
