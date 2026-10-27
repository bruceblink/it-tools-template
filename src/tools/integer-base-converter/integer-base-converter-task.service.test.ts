import { describe, expect, it } from 'vitest';
import type { WorkerRequest } from '@/task-runner/task-runner.types';
import { taskLimits } from '@/task-runner/task-runner.types';
import { executeIntegerBaseConverterTask } from './integer-base-converter-task.service';

function createRequest(value: string, fromBase = 10, customBase = 42, maxOutputBytes = taskLimits.integerBaseConverter.maxOutputBytes): WorkerRequest {
  return {
    id: 8,
    inputVersion: 3,
    task: { kind: 'integer-base-converter', value, fromBase, customBase },
    maxOutputBytes,
  };
}

describe('integer base converter task service', () => {
  it('returns fixed and custom outputs from one Worker task', () => {
    expect(executeIntegerBaseConverterTask(createRequest('165'))).toEqual({
      id: 8,
      inputVersion: 3,
      ok: true,
      result: {
        kind: 'integer-base-converter',
        valid: true,
        outputs: {
          base2: '10100101',
          base8: '245',
          base10: '165',
          base16: 'a5',
          base64: '2B',
          custom: '3D',
        },
      },
    });
  });

  it('returns a safe validation result for invalid digits', () => {
    expect(executeIntegerBaseConverterTask(createRequest('19', 8))).toMatchObject({
      ok: true,
      result: {
        kind: 'integer-base-converter',
        valid: false,
        outputs: { base2: '', base8: '', base10: '', base16: '', base64: '', custom: '' },
        errorMessage: 'Invalid digit "9" for base 8.',
      },
    });
  });

  it('rejects oversized input and serialized output before returning a result', () => {
    expect(executeIntegerBaseConverterTask(createRequest('x'.repeat(taskLimits.integerBaseConverter.maxInputBytes + 1)))).toMatchObject({
      ok: false,
      code: 'input-limit',
    });
    expect(executeIntegerBaseConverterTask(createRequest('42', 10, 42, 1))).toMatchObject({
      ok: false,
      code: 'output-limit',
    });
  });

  it('rejects unsupported task kinds', () => {
    const request = { ...createRequest('1'), task: { kind: 'json-minify' as const, value: '{}' } };
    expect(executeIntegerBaseConverterTask(request)).toMatchObject({ ok: false, code: 'error' });
  });
});
