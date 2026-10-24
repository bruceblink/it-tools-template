import { describe, expect, it } from 'vitest';
import type { WorkerRequest } from '@/task-runner/task-runner.types';
import { taskLimits } from '@/task-runner/task-runner.types';
import { executeIpv4CidrOverlapTask } from './ipv4-cidr-overlap-task.service';

function createRequest(value: string, maxOutputBytes = taskLimits.ipv4CidrOverlap.maxOutputBytes): WorkerRequest {
  return {
    id: 12,
    inputVersion: 4,
    task: { kind: 'ipv4-cidr-overlap', value },
    maxOutputBytes,
  };
}

describe('IPv4 CIDR overlap task service', () => {
  it('returns the complete report for a bounded input', () => {
    const result = executeIpv4CidrOverlapTask(createRequest('10.0.0.0/24\n10.0.0.128/25\n10.0.1.0/24'));

    expect(result).toMatchObject({
      id: 12,
      inputVersion: 4,
      ok: true,
      result: {
        kind: 'ipv4-cidr-overlap',
        valid: true,
        analysis: {
          hasOverlaps: true,
          summary: { totalBlocks: 3, overlapCount: 1, coveredAddressCount: 512 },
        },
      },
    });
    if (result.ok && result.result.kind === 'ipv4-cidr-overlap') {
      expect(result.result.analysis?.overlaps[0]?.first).toEqual({ line: 1, cidr: '10.0.0.0/24' });
    }
  });

  it('returns line-numbered validation messages without stale analysis', () => {
    expect(executeIpv4CidrOverlapTask(createRequest('10.0.0.0/24\nbad-ip'))).toMatchObject({
      ok: true,
      result: {
        kind: 'ipv4-cidr-overlap',
        valid: false,
        errorMessage: 'Line 2: Enter CIDR notation like 192.168.0.0/24.',
      },
    });
  });

  it('rejects input above byte and line limits', () => {
    expect(executeIpv4CidrOverlapTask(createRequest('x'.repeat(taskLimits.ipv4CidrOverlap.maxInputBytes + 1)))).toMatchObject({
      ok: false,
      code: 'input-limit',
    });
    expect(executeIpv4CidrOverlapTask(createRequest('10.0.0.0/24\n'.repeat(taskLimits.ipv4CidrOverlap.maxLines)))).toMatchObject({
      ok: false,
      code: 'input-limit',
    });
  });

  it('returns a clear message when the pair count exceeds the report limit', () => {
    const duplicateBlocks = Array.from({ length: 33 }, () => '10.0.0.0/24').join('\n');

    expect(executeIpv4CidrOverlapTask(createRequest(duplicateBlocks))).toMatchObject({
      ok: true,
      result: {
        kind: 'ipv4-cidr-overlap',
        valid: false,
        errorMessage: 'This input produces more than 500 overlapping pairs. Reduce the input to view the full report.',
      },
    });
  });

  it('enforces the serialized output limit', () => {
    expect(executeIpv4CidrOverlapTask(createRequest('10.0.0.0/24\n10.0.0.128/25', 128))).toMatchObject({
      ok: false,
      code: 'output-limit',
    });
  });

  it('rejects unsupported task kinds', () => {
    const request = { ...createRequest('one'), task: { kind: 'json-minify' as const, value: '{}' } };
    expect(executeIpv4CidrOverlapTask(request)).toMatchObject({ ok: false, code: 'error' });
  });
});
