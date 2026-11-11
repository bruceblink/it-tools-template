/** Capability IDs that a signed package or tool definition may declare. */
export type PluginCapabilityId =
  | 'clipboard.write'
  | 'data.oui'
  | 'device.camera'
  | 'file.read'
  | 'file.save'
  | 'runtime.info'
  | 'settings.read'
  | 'settings.write';

/** Keep package metadata and built-in tool declarations on one known ID list. */
export const pluginCapabilityIds: readonly PluginCapabilityId[] = Object.freeze([
  'clipboard.write',
  'data.oui',
  'device.camera',
  'file.read',
  'file.save',
  'runtime.info',
  'settings.read',
  'settings.write',
]);

/** Capability IDs currently implemented by the Electron host broker. */
export type PluginHostCapability = Extract<
  PluginCapabilityId,
  'runtime.info' | 'clipboard.write' | 'settings.read' | 'settings.write'
>;

export const pluginHostCapabilityIds: readonly PluginHostCapability[] = Object.freeze([
  'runtime.info',
  'clipboard.write',
  'settings.read',
  'settings.write',
]);

/** 隔离的 v2 WASM 宿主当前支持的能力 ID。 */
export type PluginV2HostCapability = Extract<
  PluginCapabilityId,
  'runtime.info' | 'settings.read' | 'data.oui'
>;

/** Capabilities currently exposed to the trusted first-party extension host. */
export type FirstPartyExtensionCapability = Extract<
  PluginCapabilityId,
  'clipboard.write' | 'file.read' | 'file.save' | 'device.camera' | 'runtime.info' | 'data.oui'
>;

export const firstPartyExtensionCapabilityIds: readonly FirstPartyExtensionCapability[] = Object.freeze([
  'clipboard.write',
  'file.read',
  'file.save',
  'device.camera',
  'runtime.info',
  'data.oui',
]);

const knownCapabilities = new Set<PluginCapabilityId>(pluginCapabilityIds);

export function isPluginCapabilityId(value: string): value is PluginCapabilityId {
  return knownCapabilities.has(value as PluginCapabilityId);
}
