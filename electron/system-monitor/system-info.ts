import * as systemInformation from 'systeminformation';
import type {
  SystemMonitorDiskSnapshot,
  SystemMonitorFilesystem,
  SystemMonitorMetric,
  SystemMonitorNetworkInterface,
  SystemMonitorNetworkSnapshot,
  SystemMonitorProcess,
  SystemMonitorProcessSnapshot,
  SystemMonitorMetricStatus,
} from '../../src/shared/desktop-services/system-monitor';
import {
  SYSTEM_MONITOR_MAX_FILESYSTEMS,
  SYSTEM_MONITOR_MAX_NETWORK_INTERFACES,
  SYSTEM_MONITOR_MAX_PROCESSES,
} from '../../src/shared/desktop-services/system-monitor';

const MAX_TEXT_LENGTH = 256;

export interface RawFilesystemRow {
  fs: string;
  type: string;
  size: number;
  used: number;
  available: number;
  use: number;
  mount: string;
}

export interface RawFilesystemStats {
  rx_sec: number | null;
  wx_sec: number | null;
}

export interface RawNetworkRow {
  iface: string;
  operstate: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_sec: number;
  tx_sec: number;
}

export interface RawProcessRow {
  pid: number;
  parentPid: number;
  name: string;
  cpu: number;
  mem: number;
  memRss: number;
  started: string;
  state: string;
}

/** Reads bounded storage and network snapshots outside the Electron main process. */
export async function collectSystemMonitorDiskAndNetwork(): Promise<{
  disk: SystemMonitorDiskSnapshot;
  network: SystemMonitorNetworkSnapshot;
}> {
  const [filesystemResult, filesystemStatsResult, networkResult] = await Promise.allSettled([
    systemInformation.fsSize(),
    systemInformation.fsStats(),
    systemInformation.networkStats(),
  ]);
  return {
    disk: normalizeDiskSnapshot(
      filesystemResult.status === 'fulfilled' ? filesystemResult.value : null,
      filesystemStatsResult.status === 'fulfilled' ? filesystemStatsResult.value : null,
    ),
    network: normalizeNetworkSnapshot(networkResult.status === 'fulfilled' ? networkResult.value : null),
  };
}

/** Reads the bounded process projection without command lines, paths, or environment data. */
export async function collectSystemMonitorProcessList(): Promise<SystemMonitorProcessSnapshot> {
  try {
    const result = await systemInformation.processes();
    return normalizeProcessSnapshot(result.list, result.all);
  }
  catch {
    return normalizeProcessSnapshot(null, null);
  }
}

export function normalizeDiskSnapshot(
  rows: readonly RawFilesystemRow[] | null,
  stats: RawFilesystemStats | null,
): SystemMonitorDiskSnapshot {
  if (!rows) {
    return {
      filesystems: [],
      readBytesPerSecond: metric(null, 'failed'),
      writeBytesPerSecond: metric(null, 'failed'),
      status: 'failed',
      truncated: false,
    };
  }
  const truncated = rows.length > SYSTEM_MONITOR_MAX_FILESYSTEMS;
  const filesystems = rows.slice(0, SYSTEM_MONITOR_MAX_FILESYSTEMS).map((row, index) => normalizeFilesystem(row, index));
  const status: SystemMonitorMetricStatus = stats ? 'ok' : 'failed';
  return {
    filesystems,
    readBytesPerSecond: metric(stats?.rx_sec ?? null, status),
    writeBytesPerSecond: metric(stats?.wx_sec ?? null, status),
    status: rows.length === 0 ? 'unsupported' : status,
    truncated,
  };
}

export function normalizeNetworkSnapshot(
  rows: readonly RawNetworkRow[] | null,
): SystemMonitorNetworkSnapshot {
  if (!rows) {
    return {
      interfaces: [],
      receivedBytesPerSecond: metric(null, 'failed'),
      transmittedBytesPerSecond: metric(null, 'failed'),
      status: 'failed',
      truncated: false,
    };
  }
  const truncated = rows.length > SYSTEM_MONITOR_MAX_NETWORK_INTERFACES;
  const interfaces = rows.slice(0, SYSTEM_MONITOR_MAX_NETWORK_INTERFACES).map((row, index) => normalizeNetworkInterface(row, index));
  const validRows = rows.filter(row => finiteNonNegative(row.rx_sec) !== null && finiteNonNegative(row.tx_sec) !== null);
  const status: SystemMonitorMetricStatus = validRows.length === rows.length ? 'ok' : 'failed';
  return {
    interfaces,
    receivedBytesPerSecond: metric(sumFinite(rows.map(row => row.rx_sec)), status),
    transmittedBytesPerSecond: metric(sumFinite(rows.map(row => row.tx_sec)), status),
    status: rows.length === 0 ? 'unsupported' : status,
    truncated,
  };
}

export function normalizeProcessSnapshot(
  rows: readonly RawProcessRow[] | null,
  reportedTotal: number | null,
): SystemMonitorProcessSnapshot {
  if (!rows) {
    return { processes: [], total: 0, status: 'failed', truncated: false };
  }
  const normalized = rows
    .map((row, index) => normalizeProcess(row, index))
    .sort((left, right) => compareMetric(right.cpuPercent, left.cpuPercent)
      || compareMetric(right.memoryBytes, left.memoryBytes));
  const truncated = normalized.length > SYSTEM_MONITOR_MAX_PROCESSES;
  return {
    processes: normalized.slice(0, SYSTEM_MONITOR_MAX_PROCESSES),
    total: Math.max(rows.length, finiteInteger(reportedTotal) ?? 0),
    status: rows.length === 0 ? 'unsupported' : 'ok',
    truncated,
  };
}

function normalizeFilesystem(row: RawFilesystemRow, index: number): SystemMonitorFilesystem {
  const sizeBytes = finiteNonNegative(row.size);
  const usedBytes = finiteNonNegative(row.used);
  const availableBytes = finiteNonNegative(row.available);
  const usedPercent = finitePercent(row.use)
    ?? (sizeBytes !== null && usedBytes !== null && sizeBytes > 0 && usedBytes <= sizeBytes
      ? (usedBytes / sizeBytes) * 100
      : null);
  const status: SystemMonitorMetricStatus = sizeBytes !== null
    && usedBytes !== null
    && availableBytes !== null
    && usedPercent !== null
    ? 'ok'
    : 'failed';
  return {
    id: `${sanitizeText(row.mount, `filesystem-${index}`)}|${sanitizeText(row.fs, 'unknown')}`,
    mount: sanitizeText(row.mount, `filesystem-${index}`),
    type: sanitizeText(row.type, 'unknown'),
    sizeBytes,
    usedBytes,
    availableBytes,
    usedPercent: metric(usedPercent, status, 'percent'),
    status,
  };
}

function normalizeNetworkInterface(row: RawNetworkRow, index: number): SystemMonitorNetworkInterface {
  const receivedBytes = finiteNonNegative(row.rx_bytes);
  const transmittedBytes = finiteNonNegative(row.tx_bytes);
  const receivedBytesPerSecond = finiteNonNegative(row.rx_sec);
  const transmittedBytesPerSecond = finiteNonNegative(row.tx_sec);
  const status: SystemMonitorMetricStatus = receivedBytesPerSecond !== null && transmittedBytesPerSecond !== null
    ? 'ok'
    : 'failed';
  return {
    id: sanitizeText(row.iface, `interface-${index}`),
    operstate: sanitizeText(row.operstate, 'unknown'),
    receivedBytes,
    transmittedBytes,
    receivedBytesPerSecond: metric(receivedBytesPerSecond, status),
    transmittedBytesPerSecond: metric(transmittedBytesPerSecond, status),
    status,
  };
}

function normalizeProcess(row: RawProcessRow, index: number): SystemMonitorProcess {
  const pid = finiteInteger(row.pid) ?? 0;
  const parentPid = finiteInteger(row.parentPid);
  const cpuPercent = finitePercent(row.cpu);
  const memoryBytes = finiteNonNegative(row.memRss);
  const memoryPercent = finitePercent(row.mem);
  const startTime = sanitizeText(row.started, '');
  return {
    key: `${pid}:${startTime || 'unknown'}:${index}`,
    pid,
    parentPid,
    name: sanitizeText(row.name, 'unknown'),
    state: sanitizeText(row.state, 'unknown'),
    startTime: startTime || null,
    cpuPercent: metric(cpuPercent, cpuPercent === null ? 'failed' : 'ok', 'percent'),
    memoryBytes: metric(memoryBytes, memoryBytes === null ? 'failed' : 'ok'),
    memoryPercent: metric(memoryPercent, memoryPercent === null ? 'failed' : 'ok', 'percent'),
  };
}

function compareMetric(left: SystemMonitorMetric, right: SystemMonitorMetric): number {
  if (left.value === null && right.value === null) {
    return 0;
  }
  if (left.value === null) {
    return 1;
  }
  if (right.value === null) {
    return -1;
  }
  return left.value - right.value;
}

function metric(
  value: number | null,
  status: SystemMonitorMetricStatus,
  unit: SystemMonitorMetric['unit'] = 'bytes',
): SystemMonitorMetric {
  const normalized = unit === 'percent' ? finitePercent(value) : finiteNonNegative(value);
  return {
    value: normalized,
    unit,
    status: normalized === null ? (status === 'ok' ? 'failed' : status) : status,
  };
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= Number.MAX_SAFE_INTEGER
    ? value
    : null;
}

function finitePercent(value: number | null | undefined): number | null {
  const normalized = finiteNonNegative(value);
  return normalized === null ? null : Math.min(100, normalized);
}

function finiteInteger(value: number | null | undefined): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function sumFinite(values: readonly (number | null | undefined)[]): number | null {
  let total = 0;
  for (const value of values) {
    const normalized = finiteNonNegative(value);
    if (normalized === null || total > Number.MAX_SAFE_INTEGER - normalized) {
      return null;
    }
    total += normalized;
  }
  return total;
}

function sanitizeText(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\u0000/g, '');
  return normalized.length > 0 ? normalized.slice(0, MAX_TEXT_LENGTH) : fallback;
}
