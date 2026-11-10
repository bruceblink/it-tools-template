/** 宿主工作台允许的输入值。值会原样作为 JSON 发送给扩展宿主。 */
export type PluginToolInputValue = string | number | boolean | null;

interface PluginToolInputFieldBase {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly required?: boolean;
}

/** 声明式插件工具的输入字段类型。宿主只渲染这些受限控件，不加载插件页面。 */
export type PluginToolInputField =
  | (PluginToolInputFieldBase & {
    readonly type: 'text' | 'textarea';
    readonly placeholder?: string;
    readonly defaultValue?: string;
    readonly maxLength?: number;
  })
  | (PluginToolInputFieldBase & {
    readonly type: 'number';
    readonly defaultValue?: number;
    readonly integer?: boolean;
    readonly minimum?: number;
    readonly maximum?: number;
    readonly step?: number;
  })
  | (PluginToolInputFieldBase & {
    readonly type: 'boolean';
    readonly defaultValue?: boolean;
  })
  | (PluginToolInputFieldBase & {
    readonly type: 'select';
    readonly options: readonly { readonly label: string; readonly value: string }[];
    readonly defaultValue?: string;
  });

/*
 * 保留旧字段的可选值约束，避免工作台把缺省数字转换成空字符串。
 * 所有字段仍然由宿主统一校验，插件不能注入控件或渲染模板。
 */
export type PluginToolInputValueMap = Readonly<Record<string, PluginToolInputValue>>;

/** 宿主支持的插件工具结果类型。 */
export type PluginToolResultKind = 'text' | 'json';

/** 由已验证插件清单提供、由宿主页面渲染的工具定义。 */
export interface PluginToolWorkbenchDefinition {
  readonly pluginId: string;
  readonly version: string;
  readonly toolId: string;
  readonly title: string;
  readonly description: string;
  readonly commandId: string;
  readonly fields: readonly PluginToolInputField[];
  readonly resultKind: PluginToolResultKind;
}

/** 宿主发送给扩展宿主的命令请求。输入值全部来自声明式字段。 */
export interface PluginToolCommandRequest {
  readonly pluginId: string;
  readonly version: string;
  readonly toolId: string;
  readonly commandId: string;
  readonly input: PluginToolInputValueMap;
}

export type PluginToolJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly PluginToolJsonValue[]
  | { readonly [key: string]: PluginToolJsonValue };

/** 插件命令只能返回文本或可序列化 JSON，避免把任意 HTML 交给宿主渲染。 */
export type PluginToolCommandResult =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'json'; readonly value: PluginToolJsonValue };

export type PluginToolCommandExecutor = (
  request: PluginToolCommandRequest,
  signal: AbortSignal,
) => Promise<PluginToolCommandResult>;
