import type {
  ExternalPluginV2Manifest,
  ExternalPluginV2ToolDeclaration,
} from '../src/shared/external-plugin-v2';
import type {
  PluginCapabilityId,
  PluginHostCapability,
} from '../src/shared/plugin-capabilities';
import {
  isPluginCapabilityId,
} from '../src/shared/plugin-capabilities';

// v2 当前只开放主进程能逐命令批准的只读运行时信息能力。
const supportedCapabilities = new Set<PluginHostCapability>(['runtime.info']);

export const externalPluginV2CapabilityErrorCodes = Object.freeze([
  'invalid-policy',
  'capability-not-requested',
  'unsupported-capability',
  'permission-denied',
] as const);

export type ExternalPluginV2CapabilityErrorCode = typeof externalPluginV2CapabilityErrorCodes[number];

/** 表示 v2 工具声明、宿主支持和用户授权之间的校验失败。 */
export class ExternalPluginV2CapabilityPolicyError extends Error {
  constructor(
    readonly code: ExternalPluginV2CapabilityErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ExternalPluginV2CapabilityPolicyError';
  }
}

export interface ExternalPluginV2CapabilityPolicy {
  readonly requestedCapabilities: readonly PluginCapabilityId[];
  readonly supportedCapabilities: readonly PluginHostCapability[];
  readonly grantedCapabilities: readonly PluginHostCapability[];
  /** 返回工具已请求且 v2 当前可提供的能力，供主进程在授权前展示提示。 */
  getToolCapabilities(toolId: string): readonly PluginHostCapability[];
  /** 返回工具实际可使用的能力；缺少任一能力时抛出稳定错误。 */
  authorizeTool(toolId: string): readonly PluginHostCapability[];
}

/**
 * 为一个已校验的 v2 清单建立能力边界。
 *
 * 请求能力来自签名清单，授权能力来自宿主审批。工具只能使用这两个集合、
 * 宿主支持集合的交集，避免 RPC 请求通过修改工具声明或授权列表扩大权限。
 */
export function createExternalPluginV2CapabilityPolicy(
  manifest: Pick<ExternalPluginV2Manifest, 'requestedCapabilities' | 'contributions'>,
  grantedCapabilities: readonly string[],
): ExternalPluginV2CapabilityPolicy {
  const requested = readUniqueCapabilityList(manifest.requestedCapabilities, 'requestedCapabilities');
  const requestedSet = new Set(requested);
  const supported = requested.filter((capability): capability is PluginHostCapability => supportedCapabilities.has(capability as PluginHostCapability));
  const granted = readGrantedCapabilities(grantedCapabilities, requestedSet);
  const toolById = new Map(manifest.contributions.tools.map(tool => [tool.id, tool]));
  const getToolCapabilities = (toolId: string): readonly PluginHostCapability[] => {
    const tool = toolById.get(toolId);
    if (!tool) {
      throw new ExternalPluginV2CapabilityPolicyError('invalid-policy', `The v2 tool ${toolId} is not declared.`);
    }
    return validateToolCapabilities(tool, requestedSet);
  };

  return {
    requestedCapabilities: requested,
    supportedCapabilities: supported,
    grantedCapabilities: granted,
    getToolCapabilities,
    authorizeTool(toolId) {
      return authorizeToolCapabilities(getToolCapabilities(toolId), granted);
    },
  };
}

function readUniqueCapabilityList(value: readonly string[], label: string): PluginCapabilityId[] {
  if (new Set(value).size !== value.length || value.some(capability => !isPluginCapabilityId(capability))) {
    throw new ExternalPluginV2CapabilityPolicyError('invalid-policy', `The v2 ${label} list is invalid.`);
  }
  return [...value] as PluginCapabilityId[];
}

function readGrantedCapabilities(
  value: readonly string[],
  requested: ReadonlySet<PluginCapabilityId>,
): PluginHostCapability[] {
  if (new Set(value).size !== value.length) {
    throw new ExternalPluginV2CapabilityPolicyError('invalid-policy', 'The v2 granted capability list contains duplicates.');
  }
  return value.map((capability): PluginHostCapability => {
    if (!isPluginCapabilityId(capability) || !supportedCapabilities.has(capability as PluginHostCapability)) {
      throw new ExternalPluginV2CapabilityPolicyError('unsupported-capability', `The host does not support ${capability}.`);
    }
    if (!requested.has(capability)) {
      throw new ExternalPluginV2CapabilityPolicyError('capability-not-requested', `The plugin did not request ${capability}.`);
    }
    return capability as PluginHostCapability;
  });
}

function authorizeToolCapabilities(
  requiredCapabilities: readonly PluginHostCapability[],
  granted: readonly PluginHostCapability[],
): readonly PluginHostCapability[] {
  const grantedSet = new Set(granted);
  return requiredCapabilities.map((capability): PluginHostCapability => {
    if (!grantedSet.has(capability)) {
      throw new ExternalPluginV2CapabilityPolicyError('permission-denied', `The capability ${capability} was not approved.`);
    }
    return capability;
  });
}

function validateToolCapabilities(
  tool: ExternalPluginV2ToolDeclaration,
  requested: ReadonlySet<PluginCapabilityId>,
): readonly PluginHostCapability[] {
  if (new Set(tool.capabilities).size !== tool.capabilities.length) {
    throw new ExternalPluginV2CapabilityPolicyError('invalid-policy', `The v2 tool ${tool.id} declares duplicate capabilities.`);
  }
  return tool.capabilities.map((capability): PluginHostCapability => {
    if (!requested.has(capability)) {
      throw new ExternalPluginV2CapabilityPolicyError('capability-not-requested', `The tool ${tool.id} uses an undeclared capability.`);
    }
    if (!supportedCapabilities.has(capability as PluginHostCapability)) {
      throw new ExternalPluginV2CapabilityPolicyError('unsupported-capability', `The host does not support ${capability}.`);
    }
    return capability as PluginHostCapability;
  });
}
