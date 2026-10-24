import type {
  SystemMonitorBridgeResult,
  SystemMonitorSample,
  SystemMonitorSessionInfo,
} from '@/shared/desktop-services/system-monitor';

export type SystemMonitorOperation<T> =
  | { status: 'success'; value: T }
  | { status: 'unsupported' }
  | { status: 'failed'; error: 'invalid-request' | 'untrusted-renderer' | 'service-unavailable' | 'sampling-failed' };

async function callSystemMonitor<T>(
  operation: ((bridge: NonNullable<Window['itToolsDesktop']>) => Promise<SystemMonitorBridgeResult<T>> | undefined) | undefined,
): Promise<SystemMonitorOperation<T>> {
  const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
  if (!bridge || !operation) {
    return { status: 'unsupported' };
  }
  try {
    const result = await operation(bridge);
    if (!result) {
      return { status: 'unsupported' };
    }
    return result.ok ? { status: 'success', value: result.value } : { status: 'failed', error: result.error };
  }
  catch {
    return { status: 'failed', error: 'service-unavailable' };
  }
}

export function startSystemMonitor(intervalMs?: number): Promise<SystemMonitorOperation<SystemMonitorSessionInfo>> {
  return callSystemMonitor(bridge => bridge.startSystemMonitor?.(intervalMs));
}

export function setSystemMonitorPaused(
  subscriptionId: string,
  paused: boolean,
): Promise<SystemMonitorOperation<boolean>> {
  return callSystemMonitor(bridge => bridge.setSystemMonitorPaused?.(subscriptionId, paused));
}

export function refreshSystemMonitor(subscriptionId: string): Promise<SystemMonitorOperation<boolean>> {
  return callSystemMonitor(bridge => bridge.refreshSystemMonitor?.(subscriptionId));
}

export function stopSystemMonitor(subscriptionId: string): Promise<SystemMonitorOperation<boolean>> {
  return callSystemMonitor(bridge => bridge.stopSystemMonitor?.(subscriptionId));
}

export function subscribeSystemMonitor(
  callback: (sample: SystemMonitorSample) => void,
): (() => void) | null {
  const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
  if (!bridge?.onSystemMonitorSample) {
    return null;
  }
  try {
    return bridge.onSystemMonitorSample(callback);
  }
  catch {
    return null;
  }
}
