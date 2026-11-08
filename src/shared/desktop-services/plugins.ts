/** Stable error codes returned by the trusted desktop plugin bridge. */
export const desktopPluginErrorCodes = Object.freeze([
  'invalid-package',
  'invalid-archive',
  'unsafe-archive-entry',
  'resource-limit',
  'untrusted-signature',
  'file-hash-mismatch',
  'already-installed',
  'not-installed',
  'active-limit',
  'contribution-not-found',
  'unsupported-capability',
  'activation-failed',
  'activation-rollback-failed',
  'window-close-timeout',
  'shutting-down',
  'store-unavailable',
  'invalid-store',
  'invalid-key',
  'already-trusted',
  'trust-confirmation-required',
  'trust-key-not-found',
  'invalid-request',
  'untrusted-renderer',
  'window-unavailable',
  'marketplace-invalid-repository',
  'marketplace-unavailable',
  'marketplace-release-not-found',
  'marketplace-download-failed',
  'marketplace-cancelled',
  'marketplace-busy',
  'operation-failed',
] as const);

export type DesktopPluginErrorCode = typeof desktopPluginErrorCodes[number];

export interface DesktopPluginMarketplaceInstallInput {
  readonly requestId: string;
  readonly owner: string;
  readonly name: string;
}

export const desktopPluginMarketplaceInstallPhases = Object.freeze([
  'discovering',
  'pinned',
  'downloading',
  'verifying',
  'installing',
  'completed',
  'cancelled',
] as const);

export type DesktopPluginMarketplaceInstallPhase = typeof desktopPluginMarketplaceInstallPhases[number];

export interface DesktopPluginMarketplaceInstallProgress {
  readonly requestId: string;
  readonly phase: DesktopPluginMarketplaceInstallPhase;
  readonly repository?: string;
  readonly tagName?: string;
  readonly commitSha?: string;
  readonly assetName?: string;
  readonly transferredBytes?: number;
  readonly totalBytes?: number | null;
}

export interface DesktopPluginMarketplaceInstallSource {
  readonly repository: string;
  readonly tagName: string;
  readonly commitSha: string;
  readonly assetName: string;
  readonly assetUrl: string;
  readonly archiveBytes: number;
  readonly sha256: string;
}

export interface DesktopPluginMarketplaceInstallResult<TSnapshot> {
  readonly snapshot: TSnapshot;
  readonly source: DesktopPluginMarketplaceInstallSource;
}

/** Runtime failure codes attached to an installed package or tool contribution snapshot. */
export const desktopPluginRuntimeFailureCodes = Object.freeze([
  'renderer-crashed',
  'renderer-unresponsive',
  'window-closed',
] as const);

export type DesktopPluginRuntimeFailureCode = typeof desktopPluginRuntimeFailureCodes[number];

/** Reasons delivered with a desktop plugin lifecycle state change event. */
export const desktopPluginStateChangeReasons = Object.freeze([
  'installed',
  'activated',
  'disabled',
  'uninstalled',
  'runtime-failure',
  'rollback',
] as const);

export type DesktopPluginStateChangeReason = typeof desktopPluginStateChangeReasons[number];

export interface DesktopPluginStateChangeEvent {
  readonly schemaVersion: 1;
  readonly pluginId: string;
  readonly version: string;
  readonly reason: DesktopPluginStateChangeReason;
  readonly contributionId?: string;
}

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const pluginVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const contributionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const stateChangeKeys = new Set(['schemaVersion', 'pluginId', 'version', 'reason', 'contributionId']);
const stateChangeReasons = new Set<string>(desktopPluginStateChangeReasons);
const marketplaceProgressKeys = new Set([
  'requestId',
  'phase',
  'repository',
  'tagName',
  'commitSha',
  'assetName',
  'transferredBytes',
  'totalBytes',
]);
const marketplaceRequestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const marketplaceProgressPhases = new Set<string>(desktopPluginMarketplaceInstallPhases);

/** Validate untrusted marketplace progress notifications before exposing them to a renderer. */
export function isDesktopPluginMarketplaceInstallProgress(value: unknown): value is DesktopPluginMarketplaceInstallProgress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(key => !marketplaceProgressKeys.has(key))
    || typeof record.requestId !== 'string'
    || !marketplaceRequestIdPattern.test(record.requestId)
    || typeof record.phase !== 'string'
    || !marketplaceProgressPhases.has(record.phase)
  ) {
    return false;
  }
  for (const key of ['repository', 'tagName', 'commitSha', 'assetName'] as const) {
    if (record[key] !== undefined && (typeof record[key] !== 'string' || record[key].length === 0 || record[key].length > 1024)) {
      return false;
    }
  }
  if (
    record.transferredBytes !== undefined
    && (!Number.isSafeInteger(record.transferredBytes) || (record.transferredBytes as number) < 0)
  ) {
    return false;
  }
  if (
    record.totalBytes !== undefined
    && record.totalBytes !== null
    && (!Number.isSafeInteger(record.totalBytes) || (record.totalBytes as number) < 0)
  ) {
    return false;
  }
  return true;
}

/** Validate untrusted IPC payloads before exposing a lifecycle event to a renderer. */
export function isDesktopPluginStateChangeEvent(value: unknown): value is DesktopPluginStateChangeEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(key => !stateChangeKeys.has(key))
    || record.schemaVersion !== 1
    || typeof record.pluginId !== 'string'
    || record.pluginId.length > 128
    || !pluginIdPattern.test(record.pluginId)
    || typeof record.version !== 'string'
    || record.version.length > 64
    || !pluginVersionPattern.test(record.version)
    || typeof record.reason !== 'string'
    || !stateChangeReasons.has(record.reason)
  ) {
    return false;
  }
  return record.contributionId === undefined
    || (
      typeof record.contributionId === 'string'
      && record.contributionId.length <= 256
      && contributionIdPattern.test(record.contributionId)
    );
}

/** Result envelope shared by every renderer-facing plugin management operation. */
export type DesktopPluginOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopPluginErrorCode };
