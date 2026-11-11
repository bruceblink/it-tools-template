import type { PluginV2JsonValue } from './plugin-v2-json';
import type { PluginV2CommandResult } from './plugin-v2-manifest';

export interface PluginV2RuntimeInfo {
  readonly platform: string;
  readonly appVersion: string;
}

export interface PluginV2CapabilityContext {
  readonly runtimeInfo?: PluginV2RuntimeInfo;
}

export interface PluginV2WasmRequest {
  readonly commandId: string;
  readonly input: PluginV2JsonValue;
  readonly capabilityContext?: PluginV2CapabilityContext;
}

export interface PluginV2WasmExports {
  readonly alloc: (size: number) => number;
  readonly execute: (pointer: number, length: number) => bigint;
  readonly free: (pointer: number, length: number) => void;
}

/** v2 WASM 入口的导出函数和结果描述。 */
export interface PluginV2WasmAbi {
  readonly importModule: 'env';
  readonly memoryImport: 'memory';
  readonly allocateExport: 'alloc';
  readonly executeExport: 'execute';
  readonly freeExport: 'free';
}

export type PluginV2WasmResult = PluginV2CommandResult;

export declare const pluginV2WasmAbi: PluginV2WasmAbi;
