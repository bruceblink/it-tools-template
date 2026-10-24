import type {
  SystemMonitorErrorCode,
  SystemMonitorMetricStatus,
  SystemMonitorWorkerSample,
} from '../../src/shared/desktop-services/system-monitor';
import { SYSTEM_MONITOR_MAX_SAMPLE_GAP_MS } from '../../src/shared/desktop-services/system-monitor';

export interface SystemMonitorCpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

export interface SystemMonitorSampleInput {
  sampledAt: number;
  monotonicMs: number;
  cpuTimes: readonly SystemMonitorCpuTimes[];
  memoryTotalBytes: number;
  memoryAvailableBytes: number;
}

interface CpuTotals {
  idle: number;
  total: number;
}

/** Converts cumulative OS counters into one bounded CPU percentage and memory snapshot. */
export class SystemMonitorSampler {
  private previousCpuTotals: CpuTotals | null = null;
  private previousMonotonicMs: number | null = null;

  sample(input: SystemMonitorSampleInput): SystemMonitorWorkerSample {
    const cpuTotals = sumCpuTimes(input.cpuTimes);
    let cpuPercent: number | null = null;
    let cpuStatus: SystemMonitorMetricStatus = 'sampling';
    let error: SystemMonitorErrorCode | null = null;
    let gapBefore = this.previousMonotonicMs !== null
      && (input.monotonicMs <= this.previousMonotonicMs
        || input.monotonicMs - this.previousMonotonicMs > SYSTEM_MONITOR_MAX_SAMPLE_GAP_MS);

    if (gapBefore) {
      this.previousCpuTotals = null;
    }

    if (this.previousCpuTotals) {
      const idleDelta = cpuTotals.idle - this.previousCpuTotals.idle;
      const totalDelta = cpuTotals.total - this.previousCpuTotals.total;
      if (totalDelta > 0 && idleDelta >= 0) {
        cpuPercent = clampPercent((1 - idleDelta / totalDelta) * 100);
        cpuStatus = 'ok';
      }
      else {
        gapBefore = true;
        this.previousCpuTotals = null;
        cpuStatus = 'sampling';
      }
    }

    this.previousCpuTotals = cpuTotals;
    this.previousMonotonicMs = input.monotonicMs;
    const memoryValid = Number.isFinite(input.memoryTotalBytes)
      && input.memoryTotalBytes > 0
      && Number.isFinite(input.memoryAvailableBytes)
      && input.memoryAvailableBytes >= 0
      && input.memoryAvailableBytes <= input.memoryTotalBytes;

    if (!memoryValid) {
      error = error ?? 'sampling-failed';
    }

    return {
      sampledAt: input.sampledAt,
      monotonicMs: input.monotonicMs,
      cpuPercent,
      cpuStatus,
      gapBefore,
      memoryTotalBytes: memoryValid ? input.memoryTotalBytes : null,
      memoryAvailableBytes: memoryValid ? input.memoryAvailableBytes : null,
      memoryStatus: memoryValid ? 'ok' : 'failed',
      error,
    };
  }

  reset(): void {
    this.previousCpuTotals = null;
    this.previousMonotonicMs = null;
  }
}

function sumCpuTimes(cpuTimes: readonly SystemMonitorCpuTimes[]): CpuTotals {
  return cpuTimes.reduce<CpuTotals>((totals, cpu) => {
    const idle = finiteNonNegative(cpu.idle);
    const total = idle
      + finiteNonNegative(cpu.user)
      + finiteNonNegative(cpu.nice)
      + finiteNonNegative(cpu.sys)
      + finiteNonNegative(cpu.irq);
    totals.idle += idle;
    totals.total += total;
    return totals;
  }, { idle: 0, total: 0 });
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}
