/** Stable renderer and host API version exposed by the Electron plugin bridge. */
export const pluginApiV1Version = '1.4.0' as const;

export type PluginApiV1Version = typeof pluginApiV1Version;
