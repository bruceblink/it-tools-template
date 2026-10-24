export type SystemMonitorMetricStatus = 'ok' | 'sampling' | 'unsupported' | 'denied' | 'failed';

export type SystemMonitorErrorCode =
  | 'invalid-request'
  | 'untrusted-renderer'
  | 'service-unavailable'
  | 'sampling-failed';

export type SystemMonitorBridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SystemMonitorErrorCode };

export interface SystemMonitorMetric {
  value: number | null;
  unit: 'percent' | 'bytes';
  status: SystemMonitorMetricStatus;
}

export interface SystemMonitorFilesystem {
  id: string;
  mount: string;
  type: string;
  sizeBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usedPercent: SystemMonitorMetric;
  status: SystemMonitorMetricStatus;
}

export interface SystemMonitorDiskSnapshot {
  filesystems: SystemMonitorFilesystem[];
  readBytesPerSecond: SystemMonitorMetric;
  writeBytesPerSecond: SystemMonitorMetric;
  status: SystemMonitorMetricStatus;
  truncated: boolean;
}

export interface SystemMonitorNetworkInterface {
  id: string;
  operstate: string;
  receivedBytes: number | null;
  transmittedBytes: number | null;
  receivedBytesPerSecond: SystemMonitorMetric;
  transmittedBytesPerSecond: SystemMonitorMetric;
  status: SystemMonitorMetricStatus;
}

export interface SystemMonitorNetworkSnapshot {
  interfaces: SystemMonitorNetworkInterface[];
  receivedBytesPerSecond: SystemMonitorMetric;
  transmittedBytesPerSecond: SystemMonitorMetric;
  status: SystemMonitorMetricStatus;
  truncated: boolean;
}

export interface SystemMonitorProcess {
  key: string;
  pid: number;
  parentPid: number | null;
  name: string;
  state: string;
  startTime: string | null;
  cpuPercent: SystemMonitorMetric;
  memoryBytes: SystemMonitorMetric;
  memoryPercent: SystemMonitorMetric;
}

export interface SystemMonitorProcessSnapshot {
  processes: SystemMonitorProcess[];
  total: number;
  status: SystemMonitorMetricStatus;
  truncated: boolean;
}

export interface SystemMonitorSample {
  sampledAt: number;
  monotonicMs: number;
  sequence: number;
  gapBefore: boolean;
  error: SystemMonitorErrorCode | null;
  cpu: {
    system: SystemMonitorMetric;
    process: SystemMonitorMetric;
  };
  memory: {
    used: SystemMonitorMetric;
    available: SystemMonitorMetric;
    total: SystemMonitorMetric;
    usedPercent: SystemMonitorMetric;
    process: SystemMonitorMetric;
  };
  disk: SystemMonitorDiskSnapshot;
  network: SystemMonitorNetworkSnapshot;
  processes: SystemMonitorProcessSnapshot;
}

/** A worker snapshot contains only OS values; the main process adds app metrics. */
export interface SystemMonitorWorkerSample {
  sampledAt: number;
  monotonicMs: number;
  cpuPercent: number | null;
  cpuStatus: SystemMonitorMetricStatus;
  gapBefore: boolean;
  memoryTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  memoryStatus: SystemMonitorMetricStatus;
  disk?: SystemMonitorDiskSnapshot;
  network?: SystemMonitorNetworkSnapshot;
  processes?: SystemMonitorProcessSnapshot;
  error: SystemMonitorErrorCode | null;
}

export interface SystemMonitorSessionInfo {
  subscriptionId: string;
  intervalMs: number;
  state: 'running' | 'paused';
}

export const SYSTEM_MONITOR_DEFAULT_INTERVAL_MS = 2_000;
export const SYSTEM_MONITOR_MIN_INTERVAL_MS = 1_000;
export const SYSTEM_MONITOR_MAX_INTERVAL_MS = 60_000;
export const SYSTEM_MONITOR_MAX_HISTORY_POINTS = 3_600;
export const SYSTEM_MONITOR_EXTENDED_SAMPLE_INTERVAL_MS = 5_000;
export const SYSTEM_MONITOR_MAX_FILESYSTEMS = 64;
export const SYSTEM_MONITOR_MAX_NETWORK_INTERFACES = 64;
export const SYSTEM_MONITOR_MAX_PROCESSES = 2_000;
export const SYSTEM_MONITOR_MAX_SAMPLE_GAP_MS = 120_000;
