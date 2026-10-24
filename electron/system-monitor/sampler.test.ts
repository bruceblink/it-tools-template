import { describe, expect, it } from 'vitest';
import { SystemMonitorSampler, type SystemMonitorCpuTimes } from './sampler';

const cpuTimes = (idle: number, user = 100): SystemMonitorCpuTimes[] => [{
  user,
  nice: 0,
  sys: 50,
  idle,
  irq: 0,
}];

describe('SystemMonitorSampler', () => {
  it('marks the first sample as warming up and calculates the next CPU delta', () => {
    const sampler = new SystemMonitorSampler();

    const first = sampler.sample({
      sampledAt: 1_000,
      monotonicMs: 10,
      cpuTimes: cpuTimes(100),
      memoryTotalBytes: 1_000,
      memoryAvailableBytes: 400,
    });
    const second = sampler.sample({
      sampledAt: 2_000,
      monotonicMs: 1_010,
      cpuTimes: cpuTimes(150, 150),
      memoryTotalBytes: 1_000,
      memoryAvailableBytes: 250,
    });

    expect(first.cpuStatus).toBe('sampling');
    expect(first.cpuPercent).toBeNull();
    expect(first.gapBefore).toBe(false);
    expect(first.memoryStatus).toBe('ok');
    expect(second.cpuStatus).toBe('ok');
    expect(second.cpuPercent).toBe(50);
    expect(second.memoryAvailableBytes).toBe(250);
  });

  it('resets the CPU baseline after a monotonic sleep gap', () => {
    const sampler = new SystemMonitorSampler();
    sampler.sample({
      sampledAt: 1_000,
      monotonicMs: 10,
      cpuTimes: cpuTimes(100),
      memoryTotalBytes: 1_000,
      memoryAvailableBytes: 400,
    });

    const afterSleep = sampler.sample({
      sampledAt: 200_000,
      monotonicMs: 200_010,
      cpuTimes: cpuTimes(5_000, 5_000),
      memoryTotalBytes: 1_000,
      memoryAvailableBytes: 400,
    });
    expect(afterSleep.gapBefore).toBe(true);
    expect(afterSleep.cpuStatus).toBe('sampling');
    expect(afterSleep.cpuPercent).toBeNull();

    const resumed = sampler.sample({
      sampledAt: 201_000,
      monotonicMs: 201_010,
      cpuTimes: cpuTimes(5_100, 5_100),
      memoryTotalBytes: 1_000,
      memoryAvailableBytes: 400,
    });
    expect(resumed.gapBefore).toBe(false);
    expect(resumed.cpuStatus).toBe('ok');
  });

  it('rejects inconsistent memory counters and resets the CPU baseline', () => {
    const sampler = new SystemMonitorSampler();
    sampler.sample({
      sampledAt: 1_000,
      monotonicMs: 10,
      cpuTimes: cpuTimes(100),
      memoryTotalBytes: 1_000,
      memoryAvailableBytes: 400,
    });

    const invalid = sampler.sample({
      sampledAt: 2_000,
      monotonicMs: 1_010,
      cpuTimes: cpuTimes(120),
      memoryTotalBytes: 1_000,
      memoryAvailableBytes: 2_000,
    });
    expect(invalid.memoryStatus).toBe('failed');
    expect(invalid.memoryTotalBytes).toBeNull();
    expect(invalid.error).toBe('sampling-failed');

    sampler.reset();
    const afterReset = sampler.sample({
      sampledAt: 3_000,
      monotonicMs: 2_010,
      cpuTimes: cpuTimes(300),
      memoryTotalBytes: 1_000,
      memoryAvailableBytes: 500,
    });
    expect(afterReset.cpuStatus).toBe('sampling');
    expect(afterReset.cpuPercent).toBeNull();
  });

  it('marks a counter reset as a gap before rebuilding the baseline', () => {
    const sampler = new SystemMonitorSampler();
    sampler.sample({
      sampledAt: 1_000,
      monotonicMs: 10,
      cpuTimes: cpuTimes(1_000, 1_000),
      memoryTotalBytes: 1_000,
      memoryAvailableBytes: 400,
    });

    const reset = sampler.sample({
      sampledAt: 2_000,
      monotonicMs: 1_010,
      cpuTimes: cpuTimes(5, 5),
      memoryTotalBytes: 1_000,
      memoryAvailableBytes: 400,
    });
    expect(reset.gapBefore).toBe(true);
    expect(reset.cpuStatus).toBe('sampling');
    expect(reset.cpuPercent).toBeNull();

    const resumed = sampler.sample({
      sampledAt: 3_000,
      monotonicMs: 2_010,
      cpuTimes: cpuTimes(15, 15),
      memoryTotalBytes: 1_000,
      memoryAvailableBytes: 400,
    });
    expect(resumed.gapBefore).toBe(false);
    expect(resumed.cpuStatus).toBe('ok');
  });
});
