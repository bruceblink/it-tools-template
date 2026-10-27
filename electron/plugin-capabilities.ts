/** Capabilities that the current Electron host can execute for plugin windows. */
export type PluginCapability = 'runtime.info' | 'clipboard.write' | 'settings.read' | 'settings.write';

/**
 * Keep the host capability contract in one place so the broker, lifecycle and
 * renderer-facing snapshots cannot silently drift apart.
 */
export const pluginHostCapabilities: readonly PluginCapability[] = Object.freeze([
  'runtime.info',
  'clipboard.write',
  'settings.read',
  'settings.write',
]);

const supportedCapabilities = new Set<PluginCapability>(pluginHostCapabilities);

/** Return whether the current host can execute a declared plugin capability. */
export function isSupportedPluginCapability(value: string): value is PluginCapability {
  return supportedCapabilities.has(value as PluginCapability);
}

/** Keep package declarations compatible with the capability API exposed by this host. */
export function filterSupportedPluginCapabilities(
  capabilities: readonly string[],
): PluginCapability[] {
  return capabilities.filter(isSupportedPluginCapability);
}
