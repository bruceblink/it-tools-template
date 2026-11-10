import type { PluginCapabilityId } from './plugin-capabilities';
import { isPluginCapabilityId, pluginCapabilityIds } from './plugin-capabilities';
import type { ToolDataProcessing, ToolOfflineSupport } from '../tools/tools.types';
import { isToolDataProcessing, isToolOfflineSupport } from './plugin-tool-metadata';

/** 声明式外部扩展协议版本。实现代码通过扩展宿主 RPC 激活，不提供页面入口。 */
export const externalPluginV2FormatVersion = 2 as const;

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const contributionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fieldIdPattern = /^[a-z][a-z0-9-]{0,63}$/;
const categoryIdPattern = /^[a-z][a-z0-9-]{0,63}$/;
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const activationPrefixes = ['onTool', 'onCommand'] as const;

export const externalPluginV2Limits = Object.freeze({
  maximumTools: 64,
  maximumCommands: 128,
  maximumInputFields: 32,
  maximumSelectOptions: 64,
  maximumKeywords: 32,
  maximumStringLength: 240,
  maximumTitleLength: 120,
  maximumDescriptionLength: 240,
  maximumFieldLength: 64,
  maximumTextLength: 16_384,
});

export type ExternalPluginV2OutputKind = 'text' | 'json' | 'table';

interface ExternalPluginV2InputFieldBase {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly required?: boolean;
}
export interface ExternalPluginV2TextField extends ExternalPluginV2InputFieldBase {
  readonly kind: 'text';
  readonly multiline?: boolean;
  readonly placeholder?: string;
  readonly maxLength?: number;
}

export interface ExternalPluginV2NumberField extends ExternalPluginV2InputFieldBase {
  readonly kind: 'number';
  readonly minimum?: number;
  readonly maximum?: number;
  readonly step?: number;
}

export interface ExternalPluginV2BooleanField extends ExternalPluginV2InputFieldBase {
  readonly kind: 'boolean';
  readonly defaultValue?: boolean;
}

export interface ExternalPluginV2SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface ExternalPluginV2SelectField extends ExternalPluginV2InputFieldBase {
  readonly kind: 'select';
  readonly options: readonly ExternalPluginV2SelectOption[];
  readonly defaultValue?: string;
}

/** 宿主可直接渲染的输入控件集合，不允许插件注入 Vue 组件或任意 HTML。 */
export type ExternalPluginV2InputField =
  | ExternalPluginV2TextField
  | ExternalPluginV2NumberField
  | ExternalPluginV2BooleanField
  | ExternalPluginV2SelectField;

export interface ExternalPluginV2OutputDeclaration {
  readonly kind: ExternalPluginV2OutputKind;
  readonly label?: string;
}

/** 工具只声明数据和交互结构，具体执行由扩展宿主 RPC 负责。 */
export interface ExternalPluginV2ToolDeclaration {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly categoryId: string;
  readonly dataProcessing: ToolDataProcessing;
  readonly offline: ToolOfflineSupport;
  readonly capabilities: readonly PluginCapabilityId[];
  readonly inputs: readonly ExternalPluginV2InputField[];
  readonly output: ExternalPluginV2OutputDeclaration;
}

/** 命令只描述搜索目录和目标工具，执行请求通过扩展宿主 RPC 发送。 */
export interface ExternalPluginV2CommandDeclaration {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly toolId?: string;
}

export type ExternalPluginV2ActivationEvent = `onTool:${string}` | `onCommand:${string}`;

export interface ExternalPluginV2Contributions {
  readonly tools: readonly ExternalPluginV2ToolDeclaration[];
  readonly commands: readonly ExternalPluginV2CommandDeclaration[];
}

/** v2 清单只包含宿主可审查的声明，不包含 HTML 页面入口。 */
export interface ExternalPluginV2Manifest {
  readonly formatVersion: typeof externalPluginV2FormatVersion;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: {
    readonly minInclusive: string;
    readonly maxExclusive: string;
  };
  readonly requestedCapabilities: readonly PluginCapabilityId[];
  readonly activationEvents: readonly ExternalPluginV2ActivationEvent[];
  readonly contributions: ExternalPluginV2Contributions;
}

/** 在进入宿主注册表前校验 v2 静态元数据。 */
export function validateExternalPluginV2Manifest(
  value: unknown,
  hostApiVersion = '2.0.0',
): ExternalPluginV2Manifest {
  if (!isRecord(value)) {
    throw new Error('The external plugin v2 manifest must be an object.');
  }
  assertExactKeys(
    value,
    ['formatVersion', 'id', 'name', 'version', 'apiVersion', 'requestedCapabilities', 'activationEvents', 'contributions'],
    [],
    'external plugin v2 manifest',
  );
  if (value.formatVersion !== externalPluginV2FormatVersion) {
    throw new Error('The external plugin v2 format is not supported.');
  }
  const id = readBoundedString(value.id, 'Plugin ID', 128);
  if (!pluginIdPattern.test(id)) {
    throw new Error('Plugin ID is invalid.');
  }
  const name = readBoundedString(value.name, 'Plugin name', externalPluginV2Limits.maximumTitleLength);
  const version = readBoundedString(value.version, 'Plugin version', 32);
  const hostVersion = parseStableVersion(hostApiVersion, 'Host API version');
  const apiVersion = readApiRange(value.apiVersion);
  if (compareVersions(hostVersion, parseStableVersion(apiVersion.minInclusive, 'API minimum')) < 0
    || compareVersions(hostVersion, parseStableVersion(apiVersion.maxExclusive, 'API maximum')) >= 0) {
    throw new Error(`Plugin ${id} does not support host API ${hostApiVersion}.`);
  }
  parseStableVersion(version, 'Plugin version');
  const requestedCapabilities = readCapabilities(
    value.requestedCapabilities,
    new Set(pluginCapabilityIds),
    'requestedCapabilities',
  );
  const requested = new Set(requestedCapabilities);
  const contributions = readContributions(value.contributions, id, requested);
  const activationEvents = readActivationEvents(value.activationEvents, id, contributions);
  return {
    formatVersion: externalPluginV2FormatVersion,
    id,
    name,
    version,
    apiVersion: {
      minInclusive: apiVersion.minInclusive,
      maxExclusive: apiVersion.maxExclusive,
    },
    requestedCapabilities,
    activationEvents,
    contributions,
  };
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: RecordValue, required: readonly string[], optional: readonly string[], label: string): void {
  const accepted = new Set([...required, ...optional]);
  if (Object.keys(value).some(key => !accepted.has(key)) || required.some(key => !(key in value))) {
    throw new Error(`${label} contains unsupported or missing fields.`);
  }
}

function parseStableVersion(value: unknown, label: string): readonly [number, number, number] {
  if (typeof value !== 'string') {
    throw new Error(`${label} must use MAJOR.MINOR.PATCH.`);
  }
  const match = stableVersionPattern.exec(value);
  if (!match) {
    throw new Error(`${label} must use MAJOR.MINOR.PATCH.`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function readBoundedString(value: unknown, label: string, maximumLength: number, requireNonEmpty = true): string {
  if (typeof value !== 'string' || value.length > maximumLength || (requireNonEmpty && !value.trim())) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function readKeywords(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > externalPluginV2Limits.maximumKeywords) {
    throw new Error(`${label} must be a bounded list.`);
  }
  const keywords = value.map((keyword, index) => readBoundedString(
    keyword,
    `${label}[${index}]`,
    externalPluginV2Limits.maximumStringLength,
  ));
  if (new Set(keywords).size !== keywords.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return keywords;
}

function readCapabilities(value: unknown, requested: ReadonlySet<PluginCapabilityId>, label: string): PluginCapabilityId[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length) {
    throw new Error(`${label} must be a unique list.`);
  }
  return value.map((capability, index) => {
    if (typeof capability !== 'string' || !isPluginCapabilityId(capability)) {
      throw new Error(`${label}[${index}] is not a known capability.`);
    }
    if (!requested.has(capability)) {
      throw new Error(`${label}[${index}] is not declared by the package.`);
    }
    return capability;
  });
}

function readContributionId(value: unknown, pluginId: string, label: string): string {
  if (typeof value !== 'string' || !contributionIdPattern.test(value) || !value.startsWith(`${pluginId}/`)) {
    throw new Error(`${label} must use the plugin namespace.`);
  }
  return value;
}

function readApiRange(value: unknown): { minInclusive: string; maxExclusive: string } {
  if (!isRecord(value)) {
    throw new Error('API compatibility range is invalid.');
  }
  assertExactKeys(value, ['minInclusive', 'maxExclusive'], [], 'API compatibility range');
  const minInclusive = readBoundedString(value.minInclusive, 'API minimum', 32);
  const maxExclusive = readBoundedString(value.maxExclusive, 'API maximum', 32);
  if (compareVersions(parseStableVersion(minInclusive, 'API minimum'), parseStableVersion(maxExclusive, 'API maximum')) >= 0) {
    throw new Error('API compatibility range is empty.');
  }
  return { minInclusive, maxExclusive };
}

function readContributions(
  value: unknown,
  pluginId: string,
  requestedCapabilities: ReadonlySet<PluginCapabilityId>,
): ExternalPluginV2Contributions {
  if (!isRecord(value)) {
    throw new Error('Plugin contributions are invalid.');
  }
  assertExactKeys(value, ['tools', 'commands'], [], 'Plugin contributions');
  if (!Array.isArray(value.tools) || value.tools.length > externalPluginV2Limits.maximumTools) {
    throw new Error('Plugin tools are invalid.');
  }
  if (!Array.isArray(value.commands) || value.commands.length > externalPluginV2Limits.maximumCommands) {
    throw new Error('Plugin commands are invalid.');
  }
  const tools = value.tools.map((tool, index) => readTool(tool, pluginId, requestedCapabilities, index));
  const commands = value.commands.map((command, index) => readCommand(command, pluginId, tools, index));
  if (new Set(tools.map(tool => tool.id)).size !== tools.length || new Set(commands.map(command => command.id)).size !== commands.length) {
    throw new Error('Plugin contribution IDs must be unique.');
  }
  return { tools, commands };
}

function readTool(
  value: unknown,
  pluginId: string,
  requestedCapabilities: ReadonlySet<PluginCapabilityId>,
  index: number,
): ExternalPluginV2ToolDeclaration {
  if (!isRecord(value)) {
    throw new Error(`Tool contribution ${index} is invalid.`);
  }
  assertExactKeys(value, ['id', 'title', 'description', 'keywords', 'categoryId', 'dataProcessing', 'offline', 'capabilities', 'inputs', 'output'], [], `Tool contribution ${index}`);
  const id = readContributionId(value.id, pluginId, `Tool contribution ${index} ID`);
  const categoryId = readBoundedString(value.categoryId, `Tool contribution ${id} category`, 64);
  if (!categoryIdPattern.test(categoryId)) {
    throw new Error(`Tool contribution ${id} category is invalid.`);
  }
  if (!isToolDataProcessing(value.dataProcessing) || !isToolOfflineSupport(value.offline)) {
    throw new Error(`Tool contribution ${id} metadata is invalid.`);
  }
  if (!Array.isArray(value.inputs) || value.inputs.length > externalPluginV2Limits.maximumInputFields) {
    throw new Error(`Tool contribution ${id} inputs are invalid.`);
  }
  const inputs = value.inputs.map((field, fieldIndex) => readInputField(field, id, fieldIndex));
  const output = readOutput(value.output, id);
  const capabilities = readCapabilities(value.capabilities, requestedCapabilities, `Tool contribution ${id} capabilities`);
  return {
    id,
    title: readBoundedString(value.title, `Tool contribution ${id} title`, externalPluginV2Limits.maximumTitleLength),
    description: readBoundedString(value.description, `Tool contribution ${id} description`, externalPluginV2Limits.maximumDescriptionLength),
    keywords: readKeywords(value.keywords, `Tool contribution ${id} keywords`),
    categoryId,
    dataProcessing: value.dataProcessing,
    offline: value.offline,
    capabilities,
    inputs,
    output,
  };
}

function readInputField(value: unknown, toolId: string, index: number): ExternalPluginV2InputField {
  if (!isRecord(value)) {
    throw new Error(`Tool ${toolId} input ${index} is invalid.`);
  }
  if (typeof value.kind !== 'string') {
    throw new Error(`Tool ${toolId} input ${index} kind is invalid.`);
  }
  const id = readBoundedString(value.id, `Tool ${toolId} input ${index} ID`, externalPluginV2Limits.maximumFieldLength);
  if (!fieldIdPattern.test(id)) {
    throw new Error(`Tool ${toolId} input ${id} ID is invalid.`);
  }
  const base = {
    id,
    label: readBoundedString(value.label, `Tool ${toolId} input ${id} label`, externalPluginV2Limits.maximumTitleLength),
    ...(value.description === undefined ? {} : { description: readBoundedString(value.description, `Tool ${toolId} input ${id} description`, externalPluginV2Limits.maximumDescriptionLength) }),
    ...(value.required === undefined ? {} : { required: readBoolean(value.required, `Tool ${toolId} input ${id} required`) }),
  };
  if (value.kind === 'text') {
    assertExactKeys(value, ['kind', 'id', 'label'], ['description', 'required', 'multiline', 'placeholder', 'maxLength'], `Tool ${toolId} input ${id}`);
    const maxLength = value.maxLength === undefined ? undefined : readSafeInteger(value.maxLength, `Tool ${toolId} input ${id} maxLength`);
    if (maxLength !== undefined && (maxLength < 1 || maxLength > externalPluginV2Limits.maximumTextLength)) {
      throw new Error(`Tool ${toolId} input ${id} length is invalid.`);
    }
    return { ...base, kind: 'text', ...(value.multiline === undefined ? {} : { multiline: readBoolean(value.multiline, `Tool ${toolId} input ${id} multiline`) }), ...(value.placeholder === undefined ? {} : { placeholder: readBoundedString(value.placeholder, `Tool ${toolId} input ${id} placeholder`, externalPluginV2Limits.maximumStringLength, false) }), ...(maxLength === undefined ? {} : { maxLength }) };
  }
  if (value.kind === 'number') {
    assertExactKeys(value, ['kind', 'id', 'label'], ['description', 'required', 'minimum', 'maximum', 'step'], `Tool ${toolId} input ${id}`);
    const minimum = readOptionalNumber(value.minimum, `Tool ${toolId} input ${id} minimum`);
    const maximum = readOptionalNumber(value.maximum, `Tool ${toolId} input ${id} maximum`);
    const step = readOptionalNumber(value.step, `Tool ${toolId} input ${id} step`);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      throw new Error(`Tool ${toolId} input ${id} range is invalid.`);
    }
    return { ...base, kind: 'number', ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }), ...(step === undefined ? {} : { step }) };
  }
  if (value.kind === 'boolean') {
    assertExactKeys(value, ['kind', 'id', 'label'], ['description', 'required', 'defaultValue'], `Tool ${toolId} input ${id}`);
    return { ...base, kind: 'boolean', ...(value.defaultValue === undefined ? {} : { defaultValue: readBoolean(value.defaultValue, `Tool ${toolId} input ${id} defaultValue`) }) };
  }
  if (value.kind === 'select') {
    assertExactKeys(value, ['kind', 'id', 'label', 'options'], ['description', 'required', 'defaultValue'], `Tool ${toolId} input ${id}`);
    if (!Array.isArray(value.options) || value.options.length === 0 || value.options.length > externalPluginV2Limits.maximumSelectOptions) {
      throw new Error(`Tool ${toolId} input ${id} options are invalid.`);
    }
    const options = value.options.map((option, optionIndex) => {
      if (!isRecord(option)) {
        throw new Error(`Tool ${toolId} input ${id} option ${optionIndex} is invalid.`);
      }
      assertExactKeys(option, ['value', 'label'], [], `Tool ${toolId} input ${id} option ${optionIndex}`);
      return { value: readBoundedString(option.value, 'Option value', externalPluginV2Limits.maximumFieldLength), label: readBoundedString(option.label, 'Option label', externalPluginV2Limits.maximumTitleLength) };
    });
    if (new Set(options.map(option => option.value)).size !== options.length) {
      throw new Error(`Tool ${toolId} input ${id} options must be unique.`);
    }
    if (value.defaultValue !== undefined && !options.some(option => option.value === value.defaultValue)) {
      throw new Error(`Tool ${toolId} input ${id} defaultValue is not an option.`);
    }
    return { ...base, kind: 'select', options, ...(value.defaultValue === undefined ? {} : { defaultValue: readBoundedString(value.defaultValue, `Tool ${toolId} input ${id} defaultValue`, externalPluginV2Limits.maximumFieldLength) }) };
  }
  throw new Error(`Tool ${toolId} input ${id} has an unsupported kind.`);
}

function readSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer.`);
  }
  return value as number;
}

function readOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function readOutput(value: unknown, toolId: string): ExternalPluginV2OutputDeclaration {
  if (!isRecord(value)) {
    throw new Error(`Tool contribution ${toolId} output is invalid.`);
  }
  assertExactKeys(value, ['kind'], ['label'], `Tool contribution ${toolId} output`);
  if (value.kind !== 'text' && value.kind !== 'json' && value.kind !== 'table') {
    throw new Error(`Tool contribution ${toolId} output kind is invalid.`);
  }
  return { kind: value.kind, ...(value.label === undefined ? {} : { label: readBoundedString(value.label, `Tool contribution ${toolId} output label`, externalPluginV2Limits.maximumTitleLength) }) };
}

function readCommand(value: unknown, pluginId: string, tools: readonly ExternalPluginV2ToolDeclaration[], index: number): ExternalPluginV2CommandDeclaration {
  if (!isRecord(value)) {
    throw new Error(`Command contribution ${index} is invalid.`);
  }
  assertExactKeys(value, ['id', 'title', 'description', 'keywords'], ['toolId'], `Command contribution ${index}`);
  const id = readContributionId(value.id, pluginId, `Command contribution ${index} ID`);
  const toolId = value.toolId === undefined ? undefined : readContributionId(value.toolId, pluginId, `Command ${id} tool ID`);
  if (toolId !== undefined && !tools.some(tool => tool.id === toolId)) {
    throw new Error(`Command ${id} references an unknown tool.`);
  }
  return {
    id,
    title: readBoundedString(value.title, `Command ${id} title`, externalPluginV2Limits.maximumTitleLength),
    description: readBoundedString(value.description, `Command ${id} description`, externalPluginV2Limits.maximumDescriptionLength),
    keywords: readKeywords(value.keywords, `Command ${id} keywords`),
    ...(toolId === undefined ? {} : { toolId }),
  };
}

function readActivationEvents(value: unknown, pluginId: string, contributions: ExternalPluginV2Contributions): ExternalPluginV2ActivationEvent[] {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length) {
    throw new Error('Activation events must be a non-empty unique list.');
  }
  const declared = new Set([...contributions.tools.map(tool => `onTool:${tool.id}`), ...contributions.commands.map(command => `onCommand:${command.id}`)]);
  const events = value.map((event, index) => {
    if (typeof event !== 'string') {
      throw new Error(`Activation event ${index} is invalid.`);
    }
    const separator = event.indexOf(':');
    const prefix = event.slice(0, separator);
    const contributionId = event.slice(separator + 1);
    if (!activationPrefixes.includes(prefix as typeof activationPrefixes[number]) || !declared.has(event) || !contributionId.startsWith(`${pluginId}/`)) {
      throw new Error(`Activation event ${event} is invalid.`);
    }
    return event as ExternalPluginV2ActivationEvent;
  });
  for (const required of declared) {
    if (!events.includes(required as ExternalPluginV2ActivationEvent)) {
      throw new Error(`Activation event ${required} is missing.`);
    }
  }
  return events;
}
