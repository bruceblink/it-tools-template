import { cpus, freemem, totalmem } from 'node:os';
import { SystemMonitorSampler, type SystemMonitorCpuTimes } from './sampler';
import { parseSystemMonitorWorkerCommand, type SystemMonitorWorkerResponse } from './worker-protocol';

const parentPort = process.parentPort;
const sampler = new SystemMonitorSampler();

if (!parentPort) {
  process.exit(1);
}

parentPort.on('message', (event) => {
  const command = parseSystemMonitorWorkerCommand(event.data);
  if (!command) {
    return;
  }
  const result = command.operation === 'sample'
    ? collectSample()
    : { ok: true, value: true } as const;
  const response: SystemMonitorWorkerResponse = { requestId: command.requestId, result };
  parentPort?.postMessage(response);
  if (command.operation === 'close') {
    process.exit(0);
  }
});

function collectSample() {
  const sampledAt = Date.now();
  const monotonicMs = Number(process.hrtime.bigint() / 1_000_000n);
  const cpuTimes = cpus().map<SystemMonitorCpuTimes>(cpu => ({
    user: cpu.times.user,
    nice: cpu.times.nice,
    sys: cpu.times.sys,
    idle: cpu.times.idle,
    irq: cpu.times.irq,
  }));
  return {
    ok: true,
    value: sampler.sample({
      sampledAt,
      monotonicMs,
      cpuTimes,
      memoryTotalBytes: totalmem(),
      memoryAvailableBytes: freemem(),
    }),
  } as const;
}
