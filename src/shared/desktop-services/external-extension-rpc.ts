import type { ToolCapability } from '../../tools/tools.types';

/** 外部扩展边界只允许传输 JSON 值。 */
export type ExternalExtensionRpcJsonValue =
  | string
  | number
  | boolean
  | null
  | ExternalExtensionRpcJsonValue[]
  | { [key: string]: ExternalExtensionRpcJsonValue };

export const externalExtensionRpcProtocolVersion = 1 as const;
export const externalExtensionRpcMethods = Object.freeze([
  'activate',
  'executeCommand',
  'readData',
  'getSetting',
  'setSetting',
  'cancel',
  'dispose',
] as const);

export type ExternalExtensionRpcMethod = typeof externalExtensionRpcMethods[number];

export const externalExtensionRuntimePlatforms = Object.freeze([
  'aix',
  'android',
  'cygwin',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'netbsd',
  'openbsd',
  'sunos',
  'win32',
] as const);

export type ExternalExtensionRuntimePlatform = typeof externalExtensionRuntimePlatforms[number];

/** WASM 纯计算命令可读取的最小、只读宿主信息。 */
export interface ExternalExtensionRuntimeInfoContext {
  readonly platform: ExternalExtensionRuntimePlatform;
  readonly appVersion: string;
}

/** 当前只承载经用户本次批准的只读宿主数据。 */
export interface ExternalExtensionCapabilityContext {
  readonly runtimeInfo?: ExternalExtensionRuntimeInfoContext;
  readonly settings?: Readonly<Record<string, string | number | boolean>>;
  readonly data?: Readonly<Record<string, ExternalExtensionRpcJsonValue>>;
}

/** 扩展宿主适配器只返回这些稳定错误码。 */
export const externalExtensionRpcErrorCodes = Object.freeze([
  'invalid-request',
  'unsupported-method',
  'not-active',
  'permission-denied',
  'payload-too-large',
  'too-many-requests',
  'timeout',
  'cancelled',
  'transport-error',
  'extension-failed',
  'disposed',
] as const);

export type ExternalExtensionRpcErrorCode = typeof externalExtensionRpcErrorCodes[number];

export interface ExternalExtensionRpcRequestBase {
  readonly protocolVersion: typeof externalExtensionRpcProtocolVersion;
  readonly requestId: string;
  readonly pluginId: string;
}

export type ExternalExtensionRpcRequest =
  | (ExternalExtensionRpcRequestBase & {
      readonly method: 'activate';
      readonly payload: {
        readonly version: string;
        readonly grantedCapabilities: readonly ToolCapability[];
      };
    })
  | (ExternalExtensionRpcRequestBase & {
      readonly method: 'executeCommand';
      readonly payload: {
        readonly commandId: string;
        readonly input: ExternalExtensionRpcJsonValue;
        readonly requiredCapabilities: readonly ToolCapability[];
        readonly capabilityContext?: ExternalExtensionCapabilityContext;
      };
    })
  | (ExternalExtensionRpcRequestBase & {
      readonly method: 'readData';
      readonly payload: {
        readonly providerId: string;
        readonly query?: ExternalExtensionRpcJsonValue;
      };
    })
  | (ExternalExtensionRpcRequestBase & {
      readonly method: 'getSetting';
      readonly payload: { readonly settingId: string };
    })
  | (ExternalExtensionRpcRequestBase & {
      readonly method: 'setSetting';
      readonly payload: {
        readonly settingId: string;
        readonly value: ExternalExtensionRpcJsonValue;
      };
    })
  | (ExternalExtensionRpcRequestBase & {
      readonly method: 'cancel';
      readonly payload: { readonly targetRequestId: string };
    })
  | (ExternalExtensionRpcRequestBase & {
      readonly method: 'dispose';
      readonly payload: Record<string, never>;
    });

export interface ExternalExtensionRpcSuccessResponse {
  readonly protocolVersion: typeof externalExtensionRpcProtocolVersion;
  readonly requestId: string;
  readonly pluginId: string;
  readonly ok: true;
  readonly result?: ExternalExtensionRpcJsonValue;
}

export interface ExternalExtensionRpcFailureResponse {
  readonly protocolVersion: typeof externalExtensionRpcProtocolVersion;
  readonly requestId: string;
  readonly pluginId: string;
  readonly ok: false;
  readonly error: ExternalExtensionRpcErrorCode;
}

export type ExternalExtensionRpcResponse =
  | ExternalExtensionRpcSuccessResponse
  | ExternalExtensionRpcFailureResponse;

const requestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const contributionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const capabilityIds = new Set<ToolCapability>([
  'clipboard.write',
  'data.oui',
  'device.camera',
  'file.read',
  'file.save',
  'runtime.info',
  'settings.read',
  'settings.write',
]);

/** 宿主解释方法负载前，先校验不可信消息。 */
export function parseExternalExtensionRpcRequest(value: unknown): ExternalExtensionRpcRequest | null {
  if (!isRecord(value)
    || value.protocolVersion !== externalExtensionRpcProtocolVersion
    || typeof value.requestId !== 'string'
    || !requestIdPattern.test(value.requestId)
    || typeof value.pluginId !== 'string'
    || !pluginIdPattern.test(value.pluginId)
    || typeof value.method !== 'string'
    || !externalExtensionRpcMethods.includes(value.method as ExternalExtensionRpcMethod)
    || !isRecord(value.payload)) {
    return null;
  }

  const base = {
    protocolVersion: externalExtensionRpcProtocolVersion,
    requestId: value.requestId,
    pluginId: value.pluginId,
  } as const;
  switch (value.method) {
    case 'activate':
      return hasExactKeys(value.payload, ['version', 'grantedCapabilities'])
        && typeof value.payload.version === 'string'
        && versionPattern.test(value.payload.version)
        && isCapabilityList(value.payload.grantedCapabilities)
        ? { ...base, method: 'activate', payload: {
            version: value.payload.version,
            grantedCapabilities: value.payload.grantedCapabilities,
          } }
        : null;
    case 'executeCommand':
      return (hasExactKeys(value.payload, ['commandId', 'input', 'requiredCapabilities'])
        || hasExactKeys(value.payload, ['commandId', 'input', 'requiredCapabilities', 'capabilityContext']))
        && typeof value.payload.commandId === 'string'
        && contributionIdPattern.test(value.payload.commandId)
        && value.payload.commandId.startsWith(`${value.pluginId}/`)
        && isJsonValue(value.payload.input)
        && isCapabilityList(value.payload.requiredCapabilities)
        && (value.payload.requiredCapabilities.includes('runtime.info')
          || value.payload.requiredCapabilities.includes('settings.read')
          || value.payload.requiredCapabilities.includes('data.oui')
          ? isExternalExtensionCapabilityContext(
            value.payload.capabilityContext,
            value.pluginId,
            value.payload.requiredCapabilities.includes('runtime.info'),
            value.payload.requiredCapabilities.includes('settings.read'),
            value.payload.requiredCapabilities.includes('data.oui'),
          )
          : value.payload.capabilityContext === undefined)
        ? { ...base, method: 'executeCommand', payload: {
            commandId: value.payload.commandId,
            input: value.payload.input,
            requiredCapabilities: value.payload.requiredCapabilities,
            ...(value.payload.capabilityContext === undefined
              ? {}
              : { capabilityContext: value.payload.capabilityContext as ExternalExtensionCapabilityContext }),
          } }
        : null;
    case 'readData':
      return (hasExactKeys(value.payload, ['providerId']) || hasExactKeys(value.payload, ['providerId', 'query']))
        && typeof value.payload.providerId === 'string'
        && contributionIdPattern.test(value.payload.providerId)
        && value.payload.providerId.startsWith(`${value.pluginId}/`)
        && (value.payload.query === undefined || isJsonValue(value.payload.query))
        ? { ...base, method: 'readData', payload: {
            providerId: value.payload.providerId,
          ...(value.payload.query === undefined ? {} : { query: value.payload.query }),
          } }
        : null;
    case 'getSetting':
      return hasExactKeys(value.payload, ['settingId'])
        && typeof value.payload.settingId === 'string'
        && contributionIdPattern.test(value.payload.settingId)
        && value.payload.settingId.startsWith(`${value.pluginId}/`)
        ? { ...base, method: 'getSetting', payload: { settingId: value.payload.settingId } }
        : null;
    case 'setSetting':
      return hasExactKeys(value.payload, ['settingId', 'value'])
        && typeof value.payload.settingId === 'string'
        && contributionIdPattern.test(value.payload.settingId)
        && value.payload.settingId.startsWith(`${value.pluginId}/`)
        && isJsonValue(value.payload.value)
        ? { ...base, method: 'setSetting', payload: {
            settingId: value.payload.settingId,
            value: value.payload.value,
          } }
        : null;
    case 'cancel':
      return hasExactKeys(value.payload, ['targetRequestId'])
        && typeof value.payload.targetRequestId === 'string'
        && requestIdPattern.test(value.payload.targetRequestId)
        ? { ...base, method: 'cancel', payload: { targetRequestId: value.payload.targetRequestId } }
        : null;
    case 'dispose':
      return hasExactKeys(value.payload, [])
        ? { ...base, method: 'dispose', payload: {} }
        : null;
    default:
      return null;
  }
}

/** 校验不可信响应，只保留稳定错误码。 */
export function parseExternalExtensionRpcResponse(value: unknown): ExternalExtensionRpcResponse | null {
  if (!isRecord(value)
    || value.protocolVersion !== externalExtensionRpcProtocolVersion
    || typeof value.requestId !== 'string'
    || !requestIdPattern.test(value.requestId)
    || typeof value.pluginId !== 'string'
    || !pluginIdPattern.test(value.pluginId)
    || typeof value.ok !== 'boolean') {
    return null;
  }
  if (value.ok) {
    return (hasExactKeys(value, ['protocolVersion', 'requestId', 'pluginId', 'ok']) || hasExactKeys(value, ['protocolVersion', 'requestId', 'pluginId', 'ok', 'result']))
      && (value.result === undefined || isJsonValue(value.result))
      ? {
          protocolVersion: externalExtensionRpcProtocolVersion,
          requestId: value.requestId,
          pluginId: value.pluginId,
          ok: true,
          result: value.result,
        }
      : null;
  }
  return hasExactKeys(value, ['protocolVersion', 'requestId', 'pluginId', 'ok', 'error'])
    && typeof value.error === 'string'
    && externalExtensionRpcErrorCodes.includes(value.error as ExternalExtensionRpcErrorCode)
    ? {
        protocolVersion: externalExtensionRpcProtocolVersion,
        requestId: value.requestId,
        pluginId: value.pluginId,
        ok: false,
        error: value.error as ExternalExtensionRpcErrorCode,
      }
    : null;
}

/** 在进入 IPC 或 MessagePort 传输前限制序列化负载大小。 */
export function getExternalExtensionRpcPayloadBytes(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : new TextEncoder().encode(serialized).byteLength;
  }
  catch {
    return null;
  }
}

function isCapabilityList(value: unknown): value is readonly ToolCapability[] {
  return Array.isArray(value)
    && new Set(value).size === value.length
    && value.every(capability => typeof capability === 'string' && capabilityIds.has(capability as ToolCapability));
}

function isExternalExtensionCapabilityContext(
  value: unknown,
  pluginId: string,
  requiresRuntimeInfo: boolean,
  requiresSettings: boolean,
  requiresData: boolean,
): value is ExternalExtensionCapabilityContext {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.some(key => key !== 'runtimeInfo' && key !== 'settings' && key !== 'data')
    || (requiresRuntimeInfo !== ('runtimeInfo' in value))
    || (requiresSettings !== ('settings' in value))
    || (requiresData !== ('data' in value))) {
    return false;
  }
  if (requiresRuntimeInfo
    && (!isRecord(value.runtimeInfo)
      || !hasExactKeys(value.runtimeInfo, ['platform', 'appVersion'])
      || typeof value.runtimeInfo.platform !== 'string'
      || !externalExtensionRuntimePlatforms.includes(value.runtimeInfo.platform as ExternalExtensionRuntimePlatform)
      || typeof value.runtimeInfo.appVersion !== 'string'
      || value.runtimeInfo.appVersion.length === 0
      || value.runtimeInfo.appVersion.length > 64)) {
    return false;
  }
  if (requiresSettings && !isExternalExtensionSettingsContext(value.settings, pluginId)) {
    return false;
  }
  if (requiresData && !isExternalExtensionDataContext(value.data, pluginId)) {
    return false;
  }
  return true;
}

function isExternalExtensionSettingsContext(
  value: unknown,
  pluginId: string,
): value is Readonly<Record<string, string | number | boolean>> {
  if (!isRecord(value) || Object.keys(value).length > 64) {
    return false;
  }
  return Object.entries(value).every(([settingId, settingValue]) => {
    return contributionIdPattern.test(settingId)
      && settingId.startsWith(`${pluginId}/`)
      && (typeof settingValue === 'string' || typeof settingValue === 'boolean' || (typeof settingValue === 'number' && Number.isFinite(settingValue)))
      && (typeof settingValue !== 'string' || settingValue.length <= 4_096);
  });
}

function isExternalExtensionDataContext(
  value: unknown,
  pluginId: string,
): value is Readonly<Record<string, ExternalExtensionRpcJsonValue>> {
  if (!isRecord(value) || Object.keys(value).length > 32) {
    return false;
  }
  return Object.entries(value).every(([providerId, providerValue]) => (
    contributionIdPattern.test(providerId)
      && providerId.startsWith(`${pluginId}/`)
      && isJsonValue(providerValue)
  ));
}

function isJsonValue(value: unknown, depth = 0): value is ExternalExtensionRpcJsonValue {
  if (depth > 16 || value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value === null || typeof value === 'string' || typeof value === 'boolean';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(item => isJsonValue(item, depth + 1));
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(item => isJsonValue(item, depth + 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}
