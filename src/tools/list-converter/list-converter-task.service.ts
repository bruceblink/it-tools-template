import { convert } from './list-converter.models';
import type { ConvertOptions } from './list-converter.types';
import { taskLimits } from '@/task-runner/task-runner.types';
import type { WorkerRequest, WorkerResponse } from '@/task-runner/task-runner.types';

const textEncoder = new TextEncoder();

function countLines(value: string): number {
  let lineCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x000a) { lineCount += 1; }
  }
  return lineCount;
}

/** Bound output growth from repeated item and list wrappers before the converter allocates the result string. */
function estimateOutputBytes(value: string, options: ConvertOptions, lineCount: number): number {
  const normalizedValue = options.lowerCase ? value.toLowerCase() : value;
  const itemPrefixBytes = textEncoder.encode(options.itemPrefix).byteLength;
  const itemSuffixBytes = textEncoder.encode(options.itemSuffix).byteLength;
  const separatorBytes = textEncoder.encode(options.separator).byteLength + (options.keepLineBreaks ? 1 : 0);
  const listWrapperBytes = textEncoder.encode(options.listPrefix).byteLength
    + textEncoder.encode(options.listSuffix).byteLength
    + (options.keepLineBreaks ? 2 : 0);
  return textEncoder.encode(normalizedValue).byteLength
    + lineCount * (itemPrefixBytes + itemSuffixBytes)
    + Math.max(0, lineCount - 1) * separatorBytes
    + listWrapperBytes;
}

/** Convert one bounded list task and check output growth before and after conversion. */
export function executeListConverterTask(request: WorkerRequest, converter: typeof convert = convert): WorkerResponse {
  const response = { id: request.id, inputVersion: request.inputVersion };
  if (request.task.kind !== 'list-convert') {
    return { ...response, ok: false, code: 'error' };
  }

  const { value, options } = request.task;
  const limits = taskLimits.listConverter;
  if (textEncoder.encode(value).byteLength > limits.maxInputBytes) {
    return { ...response, ok: false, code: 'input-limit' };
  }

  const lineCount = countLines(value);
  if (lineCount > (limits.maxLines ?? Number.MAX_SAFE_INTEGER)) {
    return { ...response, ok: false, code: 'input-limit' };
  }

  const outputLimit = Number.isSafeInteger(request.maxOutputBytes) && request.maxOutputBytes >= 0
    ? Math.min(request.maxOutputBytes, limits.maxOutputBytes)
    : 0;
  let resultOptions = options;
  let inputValue = value;
  if (options.lowerCase) {
    inputValue = value.toLowerCase();
    resultOptions = { ...options, lowerCase: false };
  }
  if (estimateOutputBytes(inputValue, resultOptions, lineCount) > outputLimit) {
    return { ...response, ok: false, code: 'output-limit' };
  }

  try {
    const result = { kind: 'list-convert' as const, valid: true, output: converter(inputValue, resultOptions) };
    if (textEncoder.encode(JSON.stringify(result)).byteLength > outputLimit) {
      return { ...response, ok: false, code: 'output-limit' };
    }
    return { ...response, ok: true, result };
  }
  catch {
    return { ...response, ok: false, code: 'error' };
  }
}
