import type { Tool, ToolCapability, ToolDataProcessing, ToolDefinition, ToolOfflineSupport, ToolPlatform } from '@/tools/tools.types';

export interface ExtensionToolMetadata {
  categoryId: string
  platforms: ToolPlatform[]
  dataProcessing: ToolDataProcessing
  offline: ToolOfflineSupport
  capabilities: ToolCapability[]
}

function hasSameCapabilities(actual: readonly ToolCapability[] | undefined, expected: readonly ToolCapability[]): boolean {
  return actual !== undefined
    && actual.length === expected.length
    && actual.every((capability, index) => capability === expected[index]);
}

/** Give a reviewed tool a package-owned ID while preserving its public route and category. */
export function scopeTool(pluginId: string, slug: string, source: Tool, metadata: ExtensionToolMetadata): ToolDefinition {
  if (import.meta.env.DEV && source.id !== undefined && (
    source.categoryId !== metadata.categoryId
    || source.platforms?.length !== metadata.platforms.length
    || !source.platforms?.every((platform, index) => platform === metadata.platforms[index])
    || source.dataProcessing !== metadata.dataProcessing
    || source.offline !== metadata.offline
    || !hasSameCapabilities(source.capabilities, metadata.capabilities)
    || !source.extensionOwned
  )) {
    throw new Error(`Built-in tool ${source.path} does not match its reviewed extension metadata.`);
  }

  return {
    ...source,
    id: `${pluginId}/${slug}`,
    categoryId: metadata.categoryId,
    translationKey: source.translationKey,
    path: source.path,
    aliases: source.aliases ? [...source.aliases] : undefined,
    redirectFrom: source.redirectFrom ? [...source.redirectFrom] : undefined,
    platforms: [...metadata.platforms],
    dataProcessing: metadata.dataProcessing,
    offline: metadata.offline,
    capabilities: [...metadata.capabilities],
    extensionOwned: true,
  };
}
