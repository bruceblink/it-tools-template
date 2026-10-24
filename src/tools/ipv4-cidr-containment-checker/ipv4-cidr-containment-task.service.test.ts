import { describe, expect, it } from 'vitest';
import type { WorkerRequest } from '@/task-runner/task-runner.types';
import { taskLimits } from '@/task-runner/task-runner.types';
import { executeIpv4CidrContainmentTask } from './ipv4-cidr-containment-task.service';

function createRequest(rules: string, targets: string, maxOutputBytes = taskLimits.ipv4CidrContainment.maxOutputBytes): WorkerRequest {
  return {
    id: 15,
    inputVersion: 6,
    task: { kind: 'ipv4-cidr-containment', rules, targets },
    maxOutputBytes,
  };
}

describe('IPv4 CIDR containment task service', () => {
  it('returns target and matching rule reports for a bounded input', () => {
    expect(executeIpv4CidrContainmentTask(createRequest('10.0.0.0/24', '10.0.0.42'))).toMatchObject({
      id: 15,
      inputVersion: 6,
      ok: true,
      result: {
        kind: 'ipv4-cidr-containment',
        valid: true,
        analysis: {
          summary: { ruleCount: 1, targetCount: 1, coveredCount: 1 },
          targets: [{ target: { cidr: '10.0.0.42/32' }, matches: [{ rule: { line: 1, cidr: '10.0.0.0/24' } }] }],
        },
      },
    });
  });

  it('returns line-numbered parse failures without a stale report', () => {
    expect(executeIpv4CidrContainmentTask(createRequest('10.0.0.0/24', 'bad-ip'))).toMatchObject({
      ok: true,
      result: {
        kind: 'ipv4-cidr-containment',
        valid: false,
        errorMessage: 'Line 1: Invalid IPv4 address "bad-ip".',
      },
    });
  });

  it('rejects combined input above byte and line limits', () => {
    expect(executeIpv4CidrContainmentTask(createRequest('x'.repeat(taskLimits.ipv4CidrContainment.maxInputBytes), 'y'))).toMatchObject({
      ok: false,
      code: 'input-limit',
    });
    const tooManyLines = '10.0.0.0/24\n'.repeat(501);
    expect(executeIpv4CidrContainmentTask(createRequest(tooManyLines, tooManyLines))).toMatchObject({
      ok: false,
      code: 'input-limit',
    });
  });

  it('stops dense reports above the pair limit', () => {
    const duplicateBlocks = Array.from({ length: 23 }, () => '10.0.0.0/24').join('\n');

    expect(executeIpv4CidrContainmentTask(createRequest(duplicateBlocks, duplicateBlocks))).toMatchObject({
      ok: true,
      result: {
        kind: 'ipv4-cidr-containment',
        valid: false,
        errorMessage: 'This input produces more than 500 rule matches. Reduce the input to view the full report.',
      },
    });
  });

  it('enforces the serialized output limit', () => {
    expect(executeIpv4CidrContainmentTask(createRequest('10.0.0.0/24', '10.0.0.1', 128))).toMatchObject({
      ok: false,
      code: 'output-limit',
    });
  });

  it('rejects unsupported task kinds', () => {
    const request = { ...createRequest('one', 'two'), task: { kind: 'json-minify' as const, value: '{}' } };
    expect(executeIpv4CidrContainmentTask(request)).toMatchObject({ ok: false, code: 'error' });
  });
});
