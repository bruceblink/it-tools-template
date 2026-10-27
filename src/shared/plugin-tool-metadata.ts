import type { ToolDataProcessing, ToolOfflineSupport } from '../tools/tools.types';

/** Governance values shared by built-in and external tool metadata. */
export const toolDataProcessingValues = Object.freeze([
  'memory-only',
  'local-data',
  'user-selected-files',
  'network',
  'unspecified',
] as const satisfies readonly ToolDataProcessing[]);

export const toolOfflineSupportValues = Object.freeze([
  'available',
  'requires-network',
  'conditional',
  'unknown',
] as const satisfies readonly ToolOfflineSupport[]);

const dataProcessingValues = new Set<string>(toolDataProcessingValues);
const offlineSupportValues = new Set<string>(toolOfflineSupportValues);

export function isToolDataProcessing(value: unknown): value is ToolDataProcessing {
  return typeof value === 'string' && dataProcessingValues.has(value);
}

export function isToolOfflineSupport(value: unknown): value is ToolOfflineSupport {
  return typeof value === 'string' && offlineSupportValues.has(value);
}
