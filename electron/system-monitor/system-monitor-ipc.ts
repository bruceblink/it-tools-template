import { randomUUID } from 'node:crypto';
import { app, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type {
  SystemMonitorBridgeResult,
  SystemMonitorDiskSnapshot,
  SystemMonitorErrorCode,
  SystemMonitorMetric,
  SystemMonitorNetworkSnapshot,
  SystemMonitorProcessSnapshot,
  SystemMonitorSample,
  SystemMonitorSessionInfo,
  SystemMonitorWorkerSample,
} from '../../src/shared/desktop-services/system-monitor';
import {
  SYSTEM_MONITOR_DEFAULT_INTERVAL_MS,
  SYSTEM_MONITOR_MAX_INTERVAL_MS,
  SYSTEM_MONITOR_MIN_INTERVAL_MS,
} from '../../src/shared/desktop-services/system-monitor';
import { isTrustedDesktopSender } from '../plugin-ipc-security';
import { SystemMonitorServiceHost } from './service-host';

const START_CHANNEL = 'desktop:system-monitor:start';
const PAUSE_CHANNEL = 'desktop:system-monitor:pause';
const REFRESH_CHANNEL = 'desktop:system-monitor:refresh';
const STOP_CHANNEL = 'desktop:system-monitor:stop';
const SAMPLE_CHANNEL = 'desktop:system-monitor:sample';

interface SystemMonitorIpcDependencies {
  trustedRendererUrl: () => string;
  workerPath: string;
}

interface OwnedSubscription {
  rendererId: number;
  sender: WebContents;
  subscriptionId: string;
  intervalMs: number;
  paused: boolean;
}

/** Owns one bounded sampler schedule and broadcasts snapshots only to trusted subscribers. */
export function registerSystemMonitorIpc(dependencies: SystemMonitorIpcDependencies) {
  const serviceHost = new SystemMonitorServiceHost(dependencies.workerPath);
  const subscriptions = new Map<string, OwnedSubscription>();
  const rendererSubscriptions = new Map<number, string>();
  let scheduleTimer: NodeJS.Timeout | null = null;
  let sampleInFlight = false;
  let sampleAgain = false;
  let sequence = 0;
  let gapBeforeNextSample = false;

  ipcMain.handle(START_CHANNEL, async (event, value: unknown) => {
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError } satisfies SystemMonitorBridgeResult<never>;
    }
    const intervalMs = parseInterval(value);
    if (intervalMs === null) {
      return { ok: false, error: 'invalid-request' } satisfies SystemMonitorBridgeResult<never>;
    }

    removeRendererSubscription(event.sender.id);
    const subscriptionId = randomUUID();
    subscriptions.set(subscriptionId, {
      rendererId: event.sender.id,
      sender: event.sender,
      subscriptionId,
      intervalMs,
      paused: false,
    });
    rendererSubscriptions.set(event.sender.id, subscriptionId);
    event.sender.once('destroyed', () => removeRendererSubscription(event.sender.id));
    reschedule();
    void sampleNow();
    return {
      ok: true,
      value: { subscriptionId, intervalMs, state: 'running' },
    } satisfies SystemMonitorBridgeResult<SystemMonitorSessionInfo>;
  });

  ipcMain.handle(PAUSE_CHANNEL, async (event, value: unknown) => {
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError } satisfies SystemMonitorBridgeResult<never>;
    }
    const request = parsePauseRequest(value);
    const subscription = request ? getOwnedSubscription(event.sender.id, request.subscriptionId) : null;
    if (!request || !subscription) {
      return { ok: false, error: 'invalid-request' } satisfies SystemMonitorBridgeResult<never>;
    }
    if (subscription.paused !== request.paused) {
      subscription.paused = request.paused;
      if (!request.paused) {
        gapBeforeNextSample = true;
        void sampleNow();
      }
      reschedule();
    }
    return { ok: true, value: true } satisfies SystemMonitorBridgeResult<boolean>;
  });

  ipcMain.handle(REFRESH_CHANNEL, async (event, value: unknown) => {
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError } satisfies SystemMonitorBridgeResult<never>;
    }
    const subscriptionId = parseSubscriptionRequest(value);
    if (!subscriptionId || !getOwnedSubscription(event.sender.id, subscriptionId)) {
      return { ok: false, error: 'invalid-request' } satisfies SystemMonitorBridgeResult<never>;
    }
    void sampleNow(true);
    return { ok: true, value: true } satisfies SystemMonitorBridgeResult<boolean>;
  });

  ipcMain.handle(STOP_CHANNEL, async (event, value: unknown) => {
    const senderError = getTrustedSenderError(event, dependencies.trustedRendererUrl());
    if (senderError) {
      return { ok: false, error: senderError } satisfies SystemMonitorBridgeResult<never>;
    }
    const subscriptionId = parseSubscriptionRequest(value);
    const subscription = subscriptionId ? getOwnedSubscription(event.sender.id, subscriptionId) : null;
    if (!subscription) {
      return { ok: false, error: 'invalid-request' } satisfies SystemMonitorBridgeResult<never>;
    }
    removeSubscription(subscription.subscriptionId);
    return { ok: true, value: true } satisfies SystemMonitorBridgeResult<boolean>;
  });

  function closeRenderer(rendererId: number): void {
    removeRendererSubscription(rendererId);
  }

  function shutdown(): void {
    if (scheduleTimer) {
      clearInterval(scheduleTimer);
      scheduleTimer = null;
    }
    subscriptions.clear();
    rendererSubscriptions.clear();
    serviceHost.close();
  }

  async function sampleNow(includePaused = false): Promise<void> {
    if (!hasSamplingSubscriber(includePaused)) {
      return;
    }
    if (sampleInFlight) {
      sampleAgain = true;
      return;
    }
    sampleInFlight = true;
    try {
      const workerResult = await serviceHost.sample();
      const sample = buildSample(workerResult);
      for (const subscription of subscriptions.values()) {
        if (!subscription.paused || includePaused) {
          sendSample(subscription, sample);
        }
      }
    }
    finally {
      sampleInFlight = false;
      // A paused subscriber keeps the worker warm so resume can publish a new baseline promptly.
      if (subscriptions.size === 0) {
        serviceHost.close();
      }
      if (sampleAgain) {
        sampleAgain = false;
        void sampleNow();
      }
    }
  }

  function reschedule(): void {
    if (scheduleTimer) {
      clearInterval(scheduleTimer);
      scheduleTimer = null;
    }
    const active = [...subscriptions.values()].filter(subscription => !subscription.paused);
    if (active.length === 0) {
      if (subscriptions.size === 0) {
        serviceHost.close();
      }
      return;
    }
    const intervalMs = Math.min(...active.map(subscription => subscription.intervalMs));
    scheduleTimer = setInterval(() => void sampleNow(), intervalMs);
  }

  function buildSample(
    workerResult: SystemMonitorBridgeResult<SystemMonitorWorkerSample>,
  ): SystemMonitorSample {
    const appMetric = readAppMetric();
    const worker = workerResult.ok ? workerResult.value : null;
    const sampledAt = worker?.sampledAt ?? Date.now();
    const monotonicMs = worker?.monotonicMs ?? Number(process.hrtime.bigint() / 1_000_000n);
    const systemCpu = worker
      ? metric(worker.cpuPercent, 'percent', worker.cpuStatus)
      : metric(null, 'percent', 'failed');
    const totalMemory = worker?.memoryTotalBytes ?? null;
    const availableMemory = worker?.memoryAvailableBytes ?? null;
    const memoryValid = totalMemory !== null
      && availableMemory !== null
      && totalMemory > 0
      && availableMemory >= 0
      && availableMemory <= totalMemory;
    const memoryStatus = worker?.memoryStatus ?? 'failed';
    const error = workerResult.ok ? workerResult.value.error : workerResult.error;
    const gapBefore = gapBeforeNextSample || (worker?.gapBefore ?? false);
    gapBeforeNextSample = false;
    sequence += 1;
    return {
      sampledAt,
      monotonicMs,
      sequence,
      gapBefore,
      error,
      cpu: {
        system: systemCpu,
        process: metric(appMetric?.cpuPercent ?? null, 'percent', appMetric?.cpuPercent === null ? 'failed' : 'ok'),
      },
      memory: {
        used: metric(memoryValid ? totalMemory! - availableMemory! : null, 'bytes', memoryValid ? 'ok' : memoryStatus),
        available: metric(availableMemory, 'bytes', memoryValid ? 'ok' : memoryStatus),
        total: metric(totalMemory, 'bytes', memoryValid ? 'ok' : memoryStatus),
        usedPercent: metric(
          memoryValid ? ((totalMemory! - availableMemory!) / totalMemory!) * 100 : null,
          'percent',
          memoryValid ? 'ok' : memoryStatus,
        ),
        process: metric(appMetric?.memoryBytes ?? null, 'bytes', appMetric?.memoryBytes === null ? 'failed' : 'ok'),
      },
      disk: worker?.disk ?? emptyDiskSnapshot(),
      network: worker?.network ?? emptyNetworkSnapshot(),
      processes: worker?.processes ?? emptyProcessSnapshot(),
    };
  }

  function sendSample(subscription: OwnedSubscription, sample: SystemMonitorSample): void {
    if (subscription.sender.isDestroyed()) {
      removeSubscription(subscription.subscriptionId);
      return;
    }
    try {
      subscription.sender.send(SAMPLE_CHANNEL, sample);
    }
    catch {
      removeSubscription(subscription.subscriptionId);
    }
  }

  function removeRendererSubscription(rendererId: number): void {
    const subscriptionId = rendererSubscriptions.get(rendererId);
    if (subscriptionId) {
      removeSubscription(subscriptionId);
    }
  }

  function removeSubscription(subscriptionId: string): void {
    const subscription = subscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }
    subscriptions.delete(subscriptionId);
    if (rendererSubscriptions.get(subscription.rendererId) === subscriptionId) {
      rendererSubscriptions.delete(subscription.rendererId);
    }
    reschedule();
  }

  function getOwnedSubscription(rendererId: number, subscriptionId: string): OwnedSubscription | null {
    const subscription = subscriptions.get(subscriptionId);
    return subscription?.rendererId === rendererId ? subscription : null;
  }

  function hasSamplingSubscriber(includePaused: boolean): boolean {
    return [...subscriptions.values()].some(subscription => includePaused || !subscription.paused);
  }

  return { closeRenderer, shutdown };
}

function getTrustedSenderError(
  event: IpcMainInvokeEvent,
  trustedRendererUrl: string,
): SystemMonitorErrorCode | null {
  return isTrustedDesktopSender(event, trustedRendererUrl) ? null : 'untrusted-renderer';
}

function parseInterval(value: unknown): number | null {
  if (value === undefined) {
    return SYSTEM_MONITOR_DEFAULT_INTERVAL_MS;
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ['intervalMs'])) {
    return null;
  }
  if (value.intervalMs === undefined) {
    return SYSTEM_MONITOR_DEFAULT_INTERVAL_MS;
  }
  return typeof value.intervalMs === 'number'
    && Number.isInteger(value.intervalMs)
    && value.intervalMs >= SYSTEM_MONITOR_MIN_INTERVAL_MS
    && value.intervalMs <= SYSTEM_MONITOR_MAX_INTERVAL_MS
    ? value.intervalMs
    : null;
}

function parsePauseRequest(value: unknown): { subscriptionId: string; paused: boolean } | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['subscriptionId', 'paused'])
    || !isSubscriptionId(value.subscriptionId)
    || typeof value.paused !== 'boolean') {
    return null;
  }
  return { subscriptionId: value.subscriptionId, paused: value.paused };
}

function parseSubscriptionRequest(value: unknown): string | null {
  return isRecord(value)
    && hasOnlyKeys(value, ['subscriptionId'])
    && isSubscriptionId(value.subscriptionId)
    ? value.subscriptionId
    : null;
}

function isSubscriptionId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}

function metric(
  value: number | null,
  unit: 'percent' | 'bytes',
  status: SystemMonitorMetric['status'],
): SystemMonitorMetric {
  return {
    value: value !== null && Number.isFinite(value) ? value : null,
    unit,
    status: value !== null && Number.isFinite(value) ? status : status === 'ok' ? 'failed' : status,
  };
}

function emptyDiskSnapshot(): SystemMonitorDiskSnapshot {
  return {
    filesystems: [],
    readBytesPerSecond: metric(null, 'bytes', 'failed'),
    writeBytesPerSecond: metric(null, 'bytes', 'failed'),
    status: 'failed',
    truncated: false,
  };
}

function emptyNetworkSnapshot(): SystemMonitorNetworkSnapshot {
  return {
    interfaces: [],
    receivedBytesPerSecond: metric(null, 'bytes', 'failed'),
    transmittedBytesPerSecond: metric(null, 'bytes', 'failed'),
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

function readAppMetric(): { cpuPercent: number | null; memoryBytes: number | null } | null {
  try {
    const metric = app.getAppMetrics().find(candidate => candidate.pid === process.pid);
    if (!metric) {
      return null;
    }
    const cpuPercent = Number.isFinite(metric.cpu.percentCPUUsage)
      ? Math.min(100, Math.max(0, metric.cpu.percentCPUUsage))
      : null;
    const memoryBytes = Number.isFinite(metric.memory.workingSetSize) && metric.memory.workingSetSize >= 0
      ? metric.memory.workingSetSize * 1024
      : null;
    return { cpuPercent, memoryBytes };
  }
  catch {
    return null;
  }
}
