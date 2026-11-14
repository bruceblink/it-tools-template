import type {
  ExternalPluginV2Manifest,
  ExternalPluginV2SettingDeclaration,
  ExternalPluginV2SettingValue,
} from '../external-plugin-v2';

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
  'unsupported-capability',
  'unsupported-runtime',
  'permission-denied',
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
  'cancelled',
  'timeout',
  'data-query-invalid',
  'data-provider-invalid',
  'data-provider-unavailable',
  'data-resource-limit',
  'data-integrity-mismatch',
  'data-timeout',
  'data-cancelled',
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
  readonly kind: 'release';
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

/** v2 扩展宿主失败码；只记录可由用户重试的运行时故障。 */
export const desktopPluginV2RuntimeFailureCodes = Object.freeze([
  'transport-error',
  'extension-failed',
  'timeout',
  'protocol-error',
] as const);

export type DesktopPluginV2RuntimeFailureCode = typeof desktopPluginV2RuntimeFailureCodes[number];

/** v2 工具在内存中的运行状态；安装状态仍由 status 字段单独表示。 */
export const desktopPluginV2RuntimeStatuses = Object.freeze([
  'ready',
  'unavailable',
] as const);

export type DesktopPluginV2RuntimeStatus = typeof desktopPluginV2RuntimeStatuses[number];

/** Reasons delivered with a desktop plugin lifecycle state change event. */
export const desktopPluginStateChangeReasons = Object.freeze([
  'installed',
  'uninstalled',
  'activated',
  'deactivated',
  'enabled',
  'disabled',
  'runtime-failure',
  'runtime-recovered',
] as const);

export type DesktopPluginStateChangeReason = typeof desktopPluginStateChangeReasons[number];

export interface DesktopPluginStateChangeEvent {
  readonly schemaVersion: 1;
  readonly pluginId: string;
  readonly version: string;
  readonly reason: DesktopPluginStateChangeReason;
  readonly runtimeFailureCode?: DesktopPluginV2RuntimeFailureCode;
}

/** 已验签 v2 包的静态快照；不包含安装路径、签名或入口脚本内容。 */
export interface DesktopPluginV2Snapshot {
  readonly pluginId: string;
  readonly name: string;
  readonly version: string;
  readonly runtime: 'process' | 'wasm';
  readonly manifest: ExternalPluginV2Manifest;
  readonly status: 'installed' | 'invalid';
  /** 当前版本是否是插件唯一进入导航和搜索索引的活动版本。 */
  readonly active: boolean;
  /** 用户是否允许该版本注册到宿主并执行命令。 */
  readonly enabled: boolean;
  readonly runtimeStatus: DesktopPluginV2RuntimeStatus;
  readonly runtimeFailureCode?: DesktopPluginV2RuntimeFailureCode;
  readonly errorCode?: string;
}

/** 宿主设置页展示的 v2 设置；值始终经过声明类型和边界校验。 */
export interface DesktopPluginV2SettingSnapshot extends ExternalPluginV2SettingDeclaration {
  readonly value: ExternalPluginV2SettingValue;
}

/** v2 包的宿主设置快照，不包含安装路径或签名数据。 */
export interface DesktopPluginV2SettingsSnapshot {
  readonly pluginId: string;
  readonly version: string;
  readonly settings: readonly DesktopPluginV2SettingSnapshot[];
}

/** 从已安装 v2 包读取宿主设置的请求。 */
export interface DesktopPluginV2SettingsRequest {
  readonly pluginId: string;
  readonly version: string;
}

/** 宿主设置页保存单个 v2 设置的请求。 */
export interface DesktopPluginV2SettingUpdateRequest extends DesktopPluginV2SettingsRequest {
  readonly settingId: string;
  readonly value: ExternalPluginV2SettingValue;
}

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const pluginVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const stateChangeKeys = new Set([
  'schemaVersion',
  'pluginId',
  'version',
  'reason',
  'runtimeFailureCode',
]);
const stateChangeReasons = new Set<string>(desktopPluginStateChangeReasons);
const v2RuntimeFailureCodes = new Set<string>(desktopPluginV2RuntimeFailureCodes);
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
  if (record.runtimeFailureCode !== undefined && record.reason !== 'runtime-failure') {
    return false;
  }
  return record.runtimeFailureCode === undefined
    || (typeof record.runtimeFailureCode === 'string' && v2RuntimeFailureCodes.has(record.runtimeFailureCode));
}

/** Result envelope shared by every renderer-facing plugin management operation. */
export type DesktopPluginOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DesktopPluginErrorCode };
