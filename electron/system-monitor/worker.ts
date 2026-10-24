import { cpus, freemem, totalmem } from 'node:os';
import { SystemMonitorSampler, type SystemMonitorCpuTimes } from './sampler';
import { collectSystemMonitorDiskAndNetwork, collectSystemMonitorProcessList } from './system-info';
import { parseSystemMonitorWorkerCommand, type SystemMonitorWorkerResponse } from './worker-protocol';
import {
  SYSTEM_MONITOR_EXTENDED_SAMPLE_INTERVAL_MS,
  type SystemMonitorDiskSnapshot,
  type SystemMonitorNetworkSnapshot,
  type SystemMonitorProcessSnapshot,
} from '../../src/shared/desktop-services/system-monitor';

const parentPort = process.parentPort;
const sampler = new SystemMonitorSampler();
let extendedSnapshot: {
  disk: SystemMonitorDiskSnapshot;
  network: SystemMonitorNetworkSnapshot;
  processes: SystemMonitorProcessSnapshot;
} | null = null;
let extendedSampledAt = 0;
let extendedRefresh: Promise<void> | null = null;

if (!parentPort) {
  process.exit(1);
}

parentPort.on('message', (event) => {
  void handleCommand(event.data);
});

async function handleCommand(value: unknown): Promise<void> {
  const command = parseSystemMonitorWorkerCommand(value);
  if (!command) {
    return;
  }
  const result = command.operation === 'sample'
    ? await collectSample()
    : { ok: true, value: true } as const;
  const response: SystemMonitorWorkerResponse = { requestId: command.requestId, result };
  parentPort?.postMessage(response);
  if (command.operation === 'close') {
    process.exit(0);
  }
}

async function collectSample() {
  const sampledAt = Date.now();
  const monotonicMs = Number(process.hrtime.bigint() / 1_000_000n);
  const cpuTimes = cpus().map<SystemMonitorCpuTimes>(cpu => ({
    user: cpu.times.user,
    nice: cpu.times.nice,
    sys: cpu.times.sys,
    idle: cpu.times.idle,
    irq: cpu.times.irq,
  }));

  // Keep the base CPU and memory sample below the IPC timeout. Extended OS
  // queries can be slow on Windows, so refresh them in the background.
  if (!extendedSnapshot || monotonicMs - extendedSampledAt >= SYSTEM_MONITOR_EXTENDED_SAMPLE_INTERVAL_MS) {
    refreshExtendedSnapshot(monotonicMs);
  }
  const snapshot = extendedSnapshot;
  return {
    ok: true,
    value: {
      ...sampler.sample({
        sampledAt,
        monotonicMs,
        cpuTimes,
        memoryTotalBytes: totalmem(),
        memoryAvailableBytes: freemem(),
      }),
      disk: snapshot?.disk ?? emptyDiskSnapshot(),
      network: snapshot?.network ?? emptyNetworkSnapshot(),
      processes: snapshot?.processes ?? emptyProcessSnapshot(),
    },
  } as const;
}

function refreshExtendedSnapshot(monotonicMs: number): void {
  if (extendedRefresh) {
    return;
  }
  extendedRefresh = Promise.all([
    collectSystemMonitorDiskAndNetwork(),
    collectSystemMonitorProcessList(),
  ])
    .then(([storageAndNetwork, processes]) => {
      extendedSnapshot = { ...storageAndNetwork, processes };
      extendedSampledAt = monotonicMs;
    })
    .catch(() => {
      // Keep the last bounded snapshot when an extended query fails.
    })
    .finally(() => {
      extendedRefresh = null;
    });
}

function metric(value: number | null, unit: 'percent' | 'bytes'): { value: number | null; unit: 'percent' | 'bytes'; status: 'failed' } {
  return { value, unit, status: 'failed' };
}

function emptyDiskSnapshot(): SystemMonitorDiskSnapshot {
  return {
    filesystems: [],
    readBytesPerSecond: metric(null, 'bytes'),
    writeBytesPerSecond: metric(null, 'bytes'),
    status: 'failed',
    truncated: false,
  };
}

function emptyNetworkSnapshot(): SystemMonitorNetworkSnapshot {
  return {
    interfaces: [],
    receivedBytesPerSecond: metric(null, 'bytes'),
    transmittedBytesPerSecond: metric(null, 'bytes'),
    status: 'failed',
    truncated: false,
  };
}

function emptyProcessSnapshot(): SystemMonitorProcessSnapshot {
  return {
    processes: [],
    total: 0,
    status: 'failed',
    truncated: false,
  };
}
