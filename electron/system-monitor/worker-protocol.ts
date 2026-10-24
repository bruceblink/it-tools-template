import type {
  SystemMonitorBridgeResult,
  SystemMonitorWorkerSample,
} from '../../src/shared/desktop-services/system-monitor';

export type SystemMonitorWorkerCommand =
  | { requestId: string; operation: 'sample' }
  | { requestId: string; operation: 'close' };

export interface SystemMonitorWorkerResponse {
  requestId: string;
  result: SystemMonitorBridgeResult<SystemMonitorWorkerSample | boolean>;
}

export function parseSystemMonitorWorkerCommand(value: unknown): SystemMonitorWorkerCommand | null {
  if (!isRecord(value) || typeof value.requestId !== 'string' || !isRequestId(value.requestId)) {
    return null;
  }
  if (value.operation === 'sample' && hasExactKeys(value, ['requestId', 'operation'])) {
    return value as SystemMonitorWorkerCommand;
  }
  if (value.operation === 'close' && hasExactKeys(value, ['requestId', 'operation'])) {
    return value as SystemMonitorWorkerCommand;
  }
  return null;
}

export function isSystemMonitorWorkerResponse(value: unknown): value is SystemMonitorWorkerResponse {
  if (!isRecord(value)
    || typeof value.requestId !== 'string'
    || !isRecord(value.result)
    || typeof value.result.ok !== 'boolean') {
    return false;
  }
  if (value.result.ok) {
    return Object.keys(value.result).length === 2 && 'value' in value.result;
  }
  return Object.keys(value.result).length === 2
    && (value.result.error === 'invalid-request'
      || value.result.error === 'service-unavailable'
      || value.result.error === 'sampling-failed');
}

function isRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
