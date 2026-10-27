/** Stable renderer and host API version exposed by the Electron plugin bridge. */
export const pluginApiV1Version = '1.3.0' as const;

export type PluginApiV1Version = typeof pluginApiV1Version;
