import { describe, expect, it } from 'vitest';
import {
  isSystemMonitorWorkerResponse,
  parseSystemMonitorWorkerCommand,
} from './worker-protocol';

const requestId = '123e4567-e89b-42d3-a456-426614174000';

describe('system monitor worker protocol', () => {
  it('accepts only the bounded sample and close commands', () => {
    expect(parseSystemMonitorWorkerCommand({ requestId, operation: 'sample' })).toEqual({
      requestId,
      operation: 'sample',
    });
    expect(parseSystemMonitorWorkerCommand({ requestId, operation: 'close' })).toEqual({
      requestId,
      operation: 'close',
    });
    expect(parseSystemMonitorWorkerCommand({ requestId, operation: 'sample', extra: true })).toBeNull();
    expect(parseSystemMonitorWorkerCommand({ requestId: 'bad', operation: 'sample' })).toBeNull();
  });

  it('validates stable response envelopes and error codes', () => {
    expect(isSystemMonitorWorkerResponse({
      requestId,
      result: { ok: false, error: 'sampling-failed' },
    })).toBe(true);
    expect(isSystemMonitorWorkerResponse({
      requestId,
      result: { ok: false, error: 'query-failed' },
    })).toBe(false);
    expect(isSystemMonitorWorkerResponse({
      requestId,
      result: { ok: true, value: true },
    })).toBe(true);
    expect(isSystemMonitorWorkerResponse({
      requestId,
      result: { ok: true },
    })).toBe(false);
  });
});
