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
}

/** A worker snapshot contains only OS values; the main process adds app metrics. */
export interface SystemMonitorWorkerSample {
  sampledAt: number;
  monotonicMs: number;
  cpuPercent: number | null;
  cpuStatus: SystemMonitorMetricStatus;
  memoryTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  memoryStatus: SystemMonitorMetricStatus;
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
