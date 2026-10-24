import type {
  SystemMonitorBridgeResult,
  SystemMonitorMetric,
  SystemMonitorWorkerSample,
} from '../../src/shared/desktop-services/system-monitor';
import {
  SYSTEM_MONITOR_MAX_FILESYSTEMS,
  SYSTEM_MONITOR_MAX_NETWORK_INTERFACES,
  SYSTEM_MONITOR_MAX_PROCESSES,
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
    return Object.keys(value.result).length === 2
      && 'value' in value.result
      && (typeof value.result.value === 'boolean' || isWorkerSample(value.result.value));
  }
  return Object.keys(value.result).length === 2
    && (value.result.error === 'invalid-request'
      || value.result.error === 'service-unavailable'
      || value.result.error === 'sampling-failed');
}

function isWorkerSample(value: unknown): value is SystemMonitorWorkerSample {
  if (!isRecord(value)
    || !hasExactKeys(value, ['sampledAt', 'monotonicMs', 'cpuPercent', 'cpuStatus', 'gapBefore', 'memoryTotalBytes', 'memoryAvailableBytes', 'memoryStatus', 'disk', 'network', 'processes', 'error'])
    || !isFiniteNumber(value.sampledAt)
    || !isFiniteNumber(value.monotonicMs)
    || !isNullableFiniteNumber(value.cpuPercent)
    || !isMetricStatus(value.cpuStatus)
    || typeof value.gapBefore !== 'boolean'
    || !isNullableFiniteNumber(value.memoryTotalBytes)
    || !isNullableFiniteNumber(value.memoryAvailableBytes)
    || !isMetricStatus(value.memoryStatus)
    || !isNullableError(value.error)) {
    return false;
  }
  return isDiskSnapshot(value.disk)
    && isNetworkSnapshot(value.network)
    && isProcessSnapshot(value.processes);
}

function isDiskSnapshot(value: unknown): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, ['filesystems', 'readBytesPerSecond', 'writeBytesPerSecond', 'status', 'truncated'])
    || !Array.isArray(value.filesystems)
    || value.filesystems.length > SYSTEM_MONITOR_MAX_FILESYSTEMS
    || !isMetric(value.readBytesPerSecond)
    || !isMetric(value.writeBytesPerSecond)
    || !isMetricStatus(value.status)
    || typeof value.truncated !== 'boolean') {
    return false;
  }
  return value.filesystems.every(filesystem => isRecord(filesystem)
    && hasExactKeys(filesystem, ['id', 'mount', 'type', 'sizeBytes', 'usedBytes', 'availableBytes', 'usedPercent', 'status'])
    && isBoundedText(filesystem.id)
    && isBoundedText(filesystem.mount)
    && isBoundedText(filesystem.type)
    && isNullableFiniteNumber(filesystem.sizeBytes)
    && isNullableFiniteNumber(filesystem.usedBytes)
    && isNullableFiniteNumber(filesystem.availableBytes)
    && isMetric(filesystem.usedPercent)
    && isMetricStatus(filesystem.status));
}

function isNetworkSnapshot(value: unknown): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, ['interfaces', 'receivedBytesPerSecond', 'transmittedBytesPerSecond', 'status', 'truncated'])
    || !Array.isArray(value.interfaces)
    || value.interfaces.length > SYSTEM_MONITOR_MAX_NETWORK_INTERFACES
    || !isMetric(value.receivedBytesPerSecond)
    || !isMetric(value.transmittedBytesPerSecond)
    || !isMetricStatus(value.status)
    || typeof value.truncated !== 'boolean') {
    return false;
  }
  return value.interfaces.every(networkInterface => isRecord(networkInterface)
    && hasExactKeys(networkInterface, ['id', 'operstate', 'receivedBytes', 'transmittedBytes', 'receivedBytesPerSecond', 'transmittedBytesPerSecond', 'status'])
    && isBoundedText(networkInterface.id)
    && isBoundedText(networkInterface.operstate)
    && isNullableFiniteNumber(networkInterface.receivedBytes)
    && isNullableFiniteNumber(networkInterface.transmittedBytes)
    && isMetric(networkInterface.receivedBytesPerSecond)
    && isMetric(networkInterface.transmittedBytesPerSecond)
    && isMetricStatus(networkInterface.status));
}

function isProcessSnapshot(value: unknown): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, ['processes', 'total', 'status', 'truncated'])
    || !Array.isArray(value.processes)
    || value.processes.length > SYSTEM_MONITOR_MAX_PROCESSES
    || !isFiniteNumber(value.total)
    || !isMetricStatus(value.status)
    || typeof value.truncated !== 'boolean') {
    return false;
  }
  return value.processes.every(process => isRecord(process)
    && hasExactKeys(process, ['key', 'pid', 'parentPid', 'name', 'state', 'startTime', 'cpuPercent', 'memoryBytes', 'memoryPercent'])
    && isBoundedText(process.key)
    && isFiniteNumber(process.pid)
    && isNullableFiniteNumber(process.parentPid)
    && isBoundedText(process.name)
    && isBoundedText(process.state)
    && (process.startTime === null || isBoundedText(process.startTime))
    && isMetric(process.cpuPercent)
    && isMetric(process.memoryBytes)
    && isMetric(process.memoryPercent));
}

function isMetric(value: unknown): value is SystemMonitorMetric {
  return isRecord(value)
    && hasExactKeys(value, ['value', 'unit', 'status'])
    && isNullableFiniteNumber(value.value)
    && (value.unit === 'percent' || value.unit === 'bytes')
    && isMetricStatus(value.status);
}

function isMetricStatus(value: unknown): boolean {
  return value === 'ok' || value === 'sampling' || value === 'unsupported' || value === 'denied' || value === 'failed';
}

function isNullableError(value: unknown): boolean {
  return value === null || value === 'invalid-request' || value === 'untrusted-renderer' || value === 'service-unavailable' || value === 'sampling-failed';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && !value.includes('\u0000');
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
