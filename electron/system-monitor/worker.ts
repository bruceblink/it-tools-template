import { cpus, freemem, totalmem } from 'node:os';
import { SystemMonitorSampler, type SystemMonitorCpuTimes } from './sampler';
import { collectSystemMonitorDiskAndNetwork } from './system-info';
import { parseSystemMonitorWorkerCommand, type SystemMonitorWorkerResponse } from './worker-protocol';
import {
  SYSTEM_MONITOR_EXTENDED_SAMPLE_INTERVAL_MS,
  type SystemMonitorDiskSnapshot,
  type SystemMonitorNetworkSnapshot,
} from '../../src/shared/desktop-services/system-monitor';

const parentPort = process.parentPort;
const sampler = new SystemMonitorSampler();
let extendedSnapshot: { disk: SystemMonitorDiskSnapshot; network: SystemMonitorNetworkSnapshot } | null = null;
let extendedSampledAt = 0;

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
  if (!extendedSnapshot || monotonicMs - extendedSampledAt >= SYSTEM_MONITOR_EXTENDED_SAMPLE_INTERVAL_MS) {
    extendedSnapshot = await collectSystemMonitorDiskAndNetwork();
    extendedSampledAt = monotonicMs;
  }
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
      disk: extendedSnapshot.disk,
      network: extendedSnapshot.network,
    },
  } as const;
}
