/** JSON 值类型，供 v2 清单、WASM 请求和命令结果共用。 */
export type PluginV2JsonValue =
  | string
  | number
  | boolean
  | null
  | PluginV2JsonValue[]
  | { readonly [key: string]: PluginV2JsonValue };

/** 宿主表格只接受这些基础单元格值。 */
export type PluginV2TableCell = string | number | boolean | null;

export interface PluginV2TableColumn {
  readonly id: string;
  readonly label: string;
}

export interface PluginV2TableValue {
  readonly columns: readonly PluginV2TableColumn[];
  readonly rows: readonly (readonly PluginV2TableCell[])[];
}
