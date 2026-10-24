import { describe, expect, it } from 'vitest';
import type { WorkerRequest } from '@/task-runner/task-runner.types';
import { taskLimits } from '@/task-runner/task-runner.types';
import { executeIpv4CidrMergeTask } from './ipv4-cidr-merge-task.service';

function createRequest(value: string, maxOutputBytes = taskLimits.ipv4CidrMerge.maxOutputBytes): WorkerRequest {
  return {
    id: 4,
    inputVersion: 7,
    task: { kind: 'ipv4-cidr-merge', value },
    maxOutputBytes,
  };
}

describe('IPv4 CIDR merge task service', () => {
  it('merges and normalizes mixed IPv4 input in the Worker result', () => {
    expect(executeIpv4CidrMergeTask(createRequest('192.168.1.0/25\n192.168.1.128-192.168.1.255\n10.0.0.1\n10.0.0.2'))).toEqual({
      id: 4,
      inputVersion: 7,
      ok: true,
      result: {
        kind: 'ipv4-cidr-merge',
        valid: true,
        output: '10.0.0.1/32\n10.0.0.2/32\n192.168.1.0/24',
      },
    });
  });

  it('returns line-numbered validation errors without an output', () => {
    expect(executeIpv4CidrMergeTask(createRequest('10.0.0.1\nbad-ip'))).toEqual({
      id: 4,
      inputVersion: 7,
      ok: true,
      result: {
        kind: 'ipv4-cidr-merge',
        valid: false,
        output: '',
        errorMessage: 'Line 2: Invalid IPv4 address "bad-ip".',
      },
    });
  });

  it('accepts empty input as an empty result', () => {
    expect(executeIpv4CidrMergeTask(createRequest(''))).toMatchObject({
      ok: true,
      result: { valid: true, output: '' },
    });
  });

  it('rejects input above byte and line limits', () => {
    expect(executeIpv4CidrMergeTask(createRequest('x'.repeat(taskLimits.ipv4CidrMerge.maxInputBytes + 1)))).toMatchObject({
      ok: false,
      code: 'input-limit',
    });
    const tooManyLines = '1.1.1.1\n'.repeat(taskLimits.ipv4CidrMerge.maxLines);
    expect(new TextEncoder().encode(tooManyLines).byteLength).toBeLessThanOrEqual(taskLimits.ipv4CidrMerge.maxInputBytes);
    expect(executeIpv4CidrMergeTask(createRequest(tooManyLines))).toMatchObject({
      ok: false,
      code: 'input-limit',
    });
  });

  it('stops adding CIDRs when the serialized output limit is reached', () => {
    const input = Array.from({ length: 100 }, (_, index) => `10.${index}.0.1`).join('\n');
    expect(executeIpv4CidrMergeTask(createRequest(input, 256))).toMatchObject({
      ok: false,
      code: 'output-limit',
    });
  });

  it('rejects unsupported task kinds', () => {
    const request = { ...createRequest('one'), task: { kind: 'json-minify' as const, value: '{}' } };
    expect(executeIpv4CidrMergeTask(request)).toMatchObject({ ok: false, code: 'error' });
  });
});
