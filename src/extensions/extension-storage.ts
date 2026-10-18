export interface ExtensionSettingStorage {
  read(pluginId: string, settingId: string): unknown
  write(pluginId: string, settingId: string, value: string | number | boolean, schemaVersion?: number): void
}

export interface ExtensionStorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const storageKeyPrefix = 'it-tools.extension-setting.v1';

function getStorageKey(pluginId: string, settingId: string): string {
  return `${storageKeyPrefix}:${encodeURIComponent(pluginId)}:${encodeURIComponent(settingId)}`;
}

/** Namespace preference values and keep a process-memory fallback when browser storage is blocked. */
export function createExtensionSettingStorage(storage?: ExtensionStorageAdapter): ExtensionSettingStorage {
  const memoryValues = new Map<string, string>();

  return {
    read(pluginId, settingId) {
      const key = getStorageKey(pluginId, settingId);
      let serialized: string | null | undefined;
      try {
        serialized = storage?.getItem(key);
      }
      catch {
        serialized = undefined;
      }
      serialized ??= memoryValues.get(key);
      if (serialized === null || serialized === undefined) {
        return undefined;
      }
      try {
        return JSON.parse(serialized) as unknown;
      }
      catch {
        return undefined;
      }
    },
    write(pluginId, settingId, value, schemaVersion = 1) {
      const key = getStorageKey(pluginId, settingId);
      const serialized = JSON.stringify({ schemaVersion, value });
      memoryValues.set(key, serialized);
      try {
        storage?.setItem(key, serialized);
      }
      catch {
        // A storage error keeps the setting available for this process only.
      }
    },
  };
}

/** Resolve localStorage lazily because its getter can throw in restricted browser contexts. */
export function createBrowserExtensionSettingStorage(): ExtensionSettingStorage {
  try {
    return createExtensionSettingStorage(globalThis.localStorage);
  }
  catch {
    return createExtensionSettingStorage();
  }
}
