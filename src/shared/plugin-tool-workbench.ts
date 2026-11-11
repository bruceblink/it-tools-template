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
export type PluginToolResultKind = 'text' | 'json' | 'table';

export type PluginToolTableCell = string | number | boolean | null;

export interface PluginToolTableColumn {
  readonly id: string;
  readonly label: string;
}

export interface PluginToolTableValue {
  readonly columns: readonly PluginToolTableColumn[];
  readonly rows: readonly (readonly PluginToolTableCell[])[];
}

/** 限制宿主表格的列、行和单元格大小，避免插件返回无界结果。 */
export const pluginToolTableLimits = Object.freeze({
  maximumColumns: 64,
  maximumRows: 1000,
  maximumColumnIdLength: 64,
  maximumColumnLabelLength: 120,
  maximumCellTextLength: 4096,
});

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

/** 插件命令只能返回宿主审核的文本、JSON 或表格，避免把任意 HTML 交给宿主渲染。 */
export type PluginToolCommandResult =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'json'; readonly value: PluginToolJsonValue }
  | { readonly kind: 'table'; readonly value: PluginToolTableValue };

/** 在 IPC、扩展宿主和渲染器入口统一校验表格结构。 */
export function isPluginToolCommandResult(value: unknown): value is PluginToolCommandResult {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === 'text') {
    return typeof value.value === 'string';
  }
  if (value.kind === 'json') {
    return isPluginToolJsonValue(value.value);
  }
  return value.kind === 'table' && isPluginToolTableValue(value.value);
}

// 校验列定义和每行宽度，确保表格结果可由宿主安全复用。
function isPluginToolTableValue(value: unknown): value is PluginToolTableValue {
  if (!isRecord(value) || !hasExactKeys(value, ['columns', 'rows'])) {
    return false;
  }
  const columns = value.columns;
  const rows = value.rows;
  if (!Array.isArray(columns)
    || !Array.isArray(rows)
    || columns.length === 0
    || columns.length > pluginToolTableLimits.maximumColumns
    || rows.length > pluginToolTableLimits.maximumRows) {
    return false;
  }
  const tableColumns: unknown[] = columns;
  const tableRows: unknown[] = rows;
  const columnIds = new Set<string>();
  for (const column of tableColumns) {
    if (!isRecord(column)
      || !hasExactKeys(column, ['id', 'label'])
      || typeof column.id !== 'string'
      || !/^[a-z][a-z0-9_-]{0,63}$/.test(column.id)
      || column.id.length > pluginToolTableLimits.maximumColumnIdLength
      || typeof column.label !== 'string'
      || !column.label.trim()
      || column.label.length > pluginToolTableLimits.maximumColumnLabelLength
      || columnIds.has(column.id)) {
      return false;
    }
    columnIds.add(column.id);
  }
  return tableRows.every(row => Array.isArray(row)
    && row.length === tableColumns.length
    && row.every(cell => isPluginToolTableCell(cell)));
}

// 表格单元格只允许可序列化的基础值，并限制文本长度。
function isPluginToolTableCell(value: unknown): value is PluginToolTableCell {
  return value === null
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length <= pluginToolTableLimits.maximumCellTextLength);
}

function isPluginToolJsonValue(value: unknown, depth = 0): value is PluginToolJsonValue {
  if (depth > 16 || value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value === null || typeof value === 'string' || typeof value === 'boolean';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(item => isPluginToolJsonValue(item, depth + 1));
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(item => isPluginToolJsonValue(item, depth + 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => key in value);
}

export type PluginToolCommandExecutor = (
  request: PluginToolCommandRequest,
  signal: AbortSignal,
) => Promise<PluginToolCommandResult>;
