import type { PluginV2TableValue } from './plugin-v2-json';

/** v2 静态清单使用的宿主 API 主版本。 */
export type PluginV2ApiVersion = '2.0.0';

export type PluginV2CapabilityId =
  | 'clipboard.write'
  | 'data.oui'
  | 'device.camera'
  | 'file.read'
  | 'file.save'
  | 'runtime.info'
  | 'settings.read'
  | 'settings.write';

export type PluginV2ToolDataProcessing =
  | 'memory-only'
  | 'local-data'
  | 'user-selected-files'
  | 'network'
  | 'unspecified';

export type PluginV2ToolOfflineSupport = 'available' | 'requires-network' | 'conditional' | 'unknown';

export type PluginV2SettingType = 'string' | 'number' | 'boolean';
export type PluginV2SettingValue = string | number | boolean;

/** 设置只声明宿主可统一渲染的非秘密标量值。 */
export interface PluginV2SettingContribution {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly type: PluginV2SettingType;
  readonly defaultValue: PluginV2SettingValue;
  readonly integer?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maxLength?: number;
}

export type PluginV2DataProviderKind = 'oui.vendor';

/** 数据提供者声明宿主拥有的数据集，不包含插件 loader。 */
export interface PluginV2DataProviderContribution {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly kind: PluginV2DataProviderKind;
  readonly version: string;
  readonly schemaVersion: number;
  readonly maxBytes: number;
}

export interface PluginV2TextInput {
  readonly kind: 'text';
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly multiline?: boolean;
  readonly placeholder?: string;
  readonly maxLength?: number;
}

export interface PluginV2NumberInput {
  readonly kind: 'number';
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly integer?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly step?: number;
}

export interface PluginV2BooleanInput {
  readonly kind: 'boolean';
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly defaultValue?: boolean;
}

export interface PluginV2SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface PluginV2SelectInput {
  readonly kind: 'select';
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly options: readonly PluginV2SelectOption[];
  readonly defaultValue?: string;
}

export type PluginV2Input = PluginV2TextInput | PluginV2NumberInput | PluginV2BooleanInput | PluginV2SelectInput;

export type PluginV2OutputKind = 'text' | 'json' | 'table';

export interface PluginV2OutputDeclaration {
  readonly kind: PluginV2OutputKind;
  readonly label?: string;
}

export type PluginV2CommandResult =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'json'; readonly value: import('./plugin-v2-json').PluginV2JsonValue }
  | { readonly kind: 'table'; readonly value: PluginV2TableValue };

export interface PluginV2ToolContribution {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly categoryId: string;
  readonly dataProcessing: PluginV2ToolDataProcessing;
  readonly offline: PluginV2ToolOfflineSupport;
  readonly capabilities: readonly PluginV2CapabilityId[];
  /** 工具可以读取的设置贡献 ID。 */
  readonly settings?: readonly string[];
  /** 工具可以读取的宿主数据集引用。 */
  readonly dataProviders?: readonly {
    readonly id: string;
    readonly queryInputId?: string;
  }[];
  readonly inputs: readonly PluginV2Input[];
  readonly output: PluginV2OutputDeclaration;
}

export interface PluginV2CommandContribution {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly toolId?: string;
}

export type PluginV2ActivationEvent = `onTool:${string}` | `onCommand:${string}`;

export interface PluginV2Contributions {
  readonly tools: readonly PluginV2ToolContribution[];
  readonly commands: readonly PluginV2CommandContribution[];
  readonly settings?: readonly PluginV2SettingContribution[];
  readonly dataProviders?: readonly PluginV2DataProviderContribution[];
}

/** 未签名 v2 清单；runtime、entrypoint、files 和 signature 属于安装包封套。 */
export interface PluginV2Manifest {
  readonly formatVersion: 2;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: {
    readonly minInclusive: string;
    readonly maxExclusive: string;
  };
  readonly requestedCapabilities: readonly PluginV2CapabilityId[];
  readonly activationEvents: readonly PluginV2ActivationEvent[];
  readonly contributions: PluginV2Contributions;
}
