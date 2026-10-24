import type {
  StorageConnectInput,
  StorageConnection,
  StorageListInput,
  StoragePage,
  StoragePreviewInput,
  StoragePreview,
  StorageResult,
} from '@/shared/desktop-services/object-storage';

/** IPC failures remain fixed error codes; service diagnostics never reach the page. */
async function callStorage<T>(
  operation: (bridge: NonNullable<Window['itToolsDesktop']>) => Promise<StorageResult<T>> | undefined,
): Promise<StorageResult<T>> {
  const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
  if (!bridge) {
    return { ok: false, error: 'service-unavailable' };
  }
  try {
    return (await operation(bridge)) ?? { ok: false, error: 'service-unavailable' };
  } catch {
    return { ok: false, error: 'service-unavailable' };
  }
}

export const connectStorage = (input: StorageConnectInput): Promise<StorageResult<StorageConnection>> =>
  callStorage((bridge) => bridge.connectStorage?.(input));
export const listStorageObjects = (input: StorageListInput): Promise<StorageResult<StoragePage>> =>
  callStorage((bridge) => bridge.listStorageObjects?.(input));
export const previewStorageObject = (input: StoragePreviewInput): Promise<StorageResult<StoragePreview>> =>
  callStorage((bridge) => bridge.previewStorageObject?.(input));
export const cancelStorageRequest = (requestId: string): Promise<StorageResult<boolean>> =>
  callStorage((bridge) => bridge.cancelStorageRequest?.(requestId));
export const disconnectStorage = (): Promise<StorageResult<boolean>> =>
  callStorage((bridge) => bridge.disconnectStorage?.());
