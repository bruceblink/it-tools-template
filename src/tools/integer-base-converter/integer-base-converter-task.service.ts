import { taskLimits } from '@/task-runner/task-runner.types';
import type { WorkerRequest, WorkerResponse } from '@/task-runner/task-runner.types';
import { convertBaseOutputs, type IntegerBaseConversionOutputs } from './integer-base-converter.model';

const textEncoder = new TextEncoder();

const emptyOutputs: IntegerBaseConversionOutputs = {
  base2: '',
  base8: '',
  base10: '',
  base16: '',
  base64: '',
  custom: '',
};

function outputLimit(request: WorkerRequest): number {
  return Number.isSafeInteger(request.maxOutputBytes) && request.maxOutputBytes >= 0
    ? Math.min(request.maxOutputBytes, taskLimits.integerBaseConverter.maxOutputBytes)
    : 0;
}

function responseSize(response: WorkerResponse): number {
  return textEncoder.encode(JSON.stringify(response)).byteLength;
}

function failureResponse(response: Pick<WorkerResponse, 'id' | 'inputVersion'>, code: 'input-limit' | 'output-limit' | 'error'): WorkerResponse {
  return { ...response, ok: false, code };
}

/** Run one bounded conversion and return every fixed output from one parsed BigInt value. */
export function executeIntegerBaseConverterTask(request: WorkerRequest): WorkerResponse {
  const response = { id: request.id, inputVersion: request.inputVersion };
  if (request.task.kind !== 'integer-base-converter') {
    return failureResponse(response, 'error');
  }

  const limits = taskLimits.integerBaseConverter;
  if (textEncoder.encode(request.task.value).byteLength > limits.maxInputBytes) {
    return failureResponse(response, 'input-limit');
  }

  const maxOutputBytes = outputLimit(request);
  try {
    const result = {
      kind: 'integer-base-converter' as const,
      valid: true as const,
      outputs: convertBaseOutputs(request.task),
    };
    const successResponse: WorkerResponse = { ...response, ok: true, result };
    return responseSize(successResponse) > maxOutputBytes
      ? failureResponse(response, 'output-limit')
      : successResponse;
  }
  catch (error) {
    const result = {
      kind: 'integer-base-converter' as const,
      valid: false as const,
      outputs: emptyOutputs,
      errorMessage: error instanceof Error ? error.message : 'Could not convert this number.',
    };
    const errorResponse: WorkerResponse = { ...response, ok: true, result };
    return responseSize(errorResponse) > maxOutputBytes
      ? failureResponse(response, 'output-limit')
      : errorResponse;
  }
}
