import { randomUUID } from 'node:crypto';
import { open, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const settingKeyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
export const pluginSettingsLimits = Object.freeze({
  maximumStoredPlugins: 128,
  maximumKeyCharacters: 64,
  maximumStringCharacters: 4_096,
  maximumValuesPerPlugin: 128,
  maximumPluginBytes: 64 * 1024,
  maximumStoreBytes: 512 * 1024,
});

export type PluginSettingValue = string | number | boolean | null;

export type PluginSettingsStoreErrorCode =
  | 'store-unavailable'
  | 'invalid-store'
  | 'invalid-key'
  | 'invalid-value'
  | 'resource-limit';

export class PluginSettingsStoreError extends Error {
  constructor(
    readonly code: PluginSettingsStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginSettingsStoreError';
  }
}

interface StoredSettingsState {
  schemaVersion: 1;
  plugins: Record<string, Record<string, PluginSettingValue>>;
}

/** Persist non-secret plugin preferences in a host-owned, plugin-namespaced file. */
export class PluginSettingsStore {
  private readonly statePath: string;
  private readonly values = new Map<string, Map<string, PluginSettingValue>>();
  private operationQueue: Promise<void> = Promise.resolve();
  private loaded = false;
  private available = false;

  constructor(statePath: string) {
    this.statePath = resolve(statePath);
  }

  async load(): Promise<void> {
    await this.runExclusive(async () => {
      this.loaded = false;
      this.available = false;
      this.values.clear();
      await this.ensureParentDirectory();
      const fileMetadata = await lstat(this.statePath).catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') {
          this.loaded = true;
          this.available = true;
          return undefined;
        }
        throw new PluginSettingsStoreError('store-unavailable', 'The plugin settings store could not be inspected.', { cause: error });
      });
      if (!fileMetadata) {
        return;
      }
      if (
        !fileMetadata.isFile()
        || fileMetadata.isSymbolicLink()
        || fileMetadata.nlink !== 1
        || fileMetadata.size > pluginSettingsLimits.maximumStoreBytes
      ) {
        throw new PluginSettingsStoreError('invalid-store', 'The plugin settings store is not a bounded regular file.');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(this.statePath))) as unknown;
      }
      catch (error) {
        throw new PluginSettingsStoreError('invalid-store', 'The plugin settings store is not valid UTF-8 JSON.', { cause: error });
      }
      const state = validateStoredState(parsed);
      this.replaceValues(new Map(
        Object.entries(state.plugins).map(([pluginId, pluginValues]) => [pluginId, new Map(Object.entries(pluginValues))]),
      ));
      this.loaded = true;
      this.available = true;
    });
  }

  async read(pluginId: string, key: string): Promise<PluginSettingValue | undefined> {
    return this.runExclusive(async () => {
      this.assertAvailable();
      assertPluginId(pluginId);
      assertSettingKey(key);
      return this.values.get(pluginId)?.get(key);
    });
  }

  async write(pluginId: string, key: string, value: PluginSettingValue): Promise<{ written: true }> {
    return this.runExclusive(async () => {
      this.assertAvailable();
      assertPluginId(pluginId);
      assertSettingKey(key);
      assertSettingValue(value);
      const current = this.values.get(pluginId) ?? new Map<string, PluginSettingValue>();
      const nextPluginValues = new Map(current);
      nextPluginValues.set(key, value);
      if (nextPluginValues.size > pluginSettingsLimits.maximumValuesPerPlugin) {
        throw new PluginSettingsStoreError('resource-limit', 'The plugin has too many stored settings.');
      }

      const nextValues = new Map(this.values);
      nextValues.set(pluginId, nextPluginValues);
      if (nextValues.size > pluginSettingsLimits.maximumStoredPlugins) {
        throw new PluginSettingsStoreError('resource-limit', 'The plugin settings store has too many plugins.');
      }
      await this.writeState(nextValues);
      this.replaceValues(nextValues);
      return { written: true } as const;
    });
  }

  async delete(pluginId: string, key: string): Promise<{ deleted: boolean }> {
    return this.runExclusive(async () => {
      this.assertAvailable();
      assertPluginId(pluginId);
      assertSettingKey(key);
      const current = this.values.get(pluginId);
      if (!current?.has(key)) {
        return { deleted: false } as const;
      }

      const nextValues = new Map(this.values);
      const nextPluginValues = new Map(current);
      nextPluginValues.delete(key);
      if (nextPluginValues.size === 0) {
        nextValues.delete(pluginId);
      }
      else {
        nextValues.set(pluginId, nextPluginValues);
      }
      await this.writeState(nextValues);
      this.replaceValues(nextValues);
      return { deleted: true } as const;
    });
  }

  private async ensureParentDirectory(): Promise<void> {
    const parentDirectory = dirname(this.statePath);
    await mkdir(parentDirectory, { recursive: true, mode: 0o700 }).catch((error: unknown) => {
      throw new PluginSettingsStoreError('store-unavailable', 'The plugin settings directory could not be created.', { cause: error });
    });
    const metadata = await lstat(parentDirectory).catch((error: unknown) => {
      throw new PluginSettingsStoreError('store-unavailable', 'The plugin settings directory could not be inspected.', { cause: error });
    });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new PluginSettingsStoreError('invalid-store', 'The plugin settings directory must be a real directory.');
    }
  }

  private async writeState(values: ReadonlyMap<string, ReadonlyMap<string, PluginSettingValue>>): Promise<void> {
    if (values.size > pluginSettingsLimits.maximumStoredPlugins) {
      throw new PluginSettingsStoreError('resource-limit', 'The plugin settings store has too many plugins.');
    }
    const existing = await lstat(this.statePath).catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return undefined;
      }
      throw new PluginSettingsStoreError('store-unavailable', 'The plugin settings store could not be inspected.', { cause: error });
    });
    if (
      existing
      && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || existing.size > pluginSettingsLimits.maximumStoreBytes)
    ) {
      throw new PluginSettingsStoreError('invalid-store', 'The plugin settings store is not a bounded regular file.');
    }

    const plugins: Record<string, Record<string, PluginSettingValue>> = {};
    for (const pluginId of [...values.keys()].sort()) {
      const pluginValues = values.get(pluginId)!;
      const entries: Record<string, PluginSettingValue> = {};
      for (const key of [...pluginValues.keys()].sort()) {
        entries[key] = pluginValues.get(key)!;
      }
      const pluginBytes = Buffer.byteLength(JSON.stringify(entries), 'utf8');
      if (pluginBytes > pluginSettingsLimits.maximumPluginBytes) {
        throw new PluginSettingsStoreError('resource-limit', 'The plugin settings exceed their size limit.');
      }
      plugins[pluginId] = entries;
    }

    const state: StoredSettingsState = { schemaVersion: 1, plugins };
    const bytes = Buffer.from(`${JSON.stringify(state)}\n`, 'utf8');
    if (bytes.length > pluginSettingsLimits.maximumStoreBytes) {
      throw new PluginSettingsStoreError('resource-limit', 'The plugin settings store exceeds its size limit.');
    }

    const temporaryPath = resolve(dirname(this.statePath), `.plugin-settings-${randomUUID()}.tmp`);
    let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      fileHandle = await open(temporaryPath, 'wx', 0o600);
      await fileHandle.writeFile(bytes);
      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = undefined;
      await rename(temporaryPath, this.statePath);
    }
    catch (error) {
      throw new PluginSettingsStoreError('store-unavailable', 'The plugin settings store could not be saved.', { cause: error });
    }
    finally {
      await fileHandle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
    }
  }

  private replaceValues(values: ReadonlyMap<string, ReadonlyMap<string, PluginSettingValue>>): void {
    this.values.clear();
    for (const [pluginId, pluginValues] of values) {
      this.values.set(pluginId, new Map(pluginValues));
    }
  }

  private assertAvailable(): void {
    if (!this.loaded || !this.available) {
      throw new PluginSettingsStoreError('store-unavailable', 'The plugin settings store is not available.');
    }
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function assertPluginSettingKey(key: string): void {
  assertSettingKey(key);
}

export function isPluginSettingKey(key: unknown): key is string {
  return typeof key === 'string'
    && key.length <= pluginSettingsLimits.maximumKeyCharacters
    && settingKeyPattern.test(key);
}

export function isPluginSettingValue(value: unknown): value is PluginSettingValue {
  return value === null
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length <= pluginSettingsLimits.maximumStringCharacters);
}

function validateStoredState(value: unknown): StoredSettingsState {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'plugins']) || value.schemaVersion !== 1 || !isRecord(value.plugins)) {
    throw new PluginSettingsStoreError('invalid-store', 'The plugin settings store has an unsupported format.');
  }
  const pluginIds = Object.keys(value.plugins);
  if (pluginIds.length > pluginSettingsLimits.maximumStoredPlugins) {
    throw new PluginSettingsStoreError('resource-limit', 'The plugin settings store has too many plugins.');
  }
  const plugins: Record<string, Record<string, PluginSettingValue>> = {};
  for (const pluginId of pluginIds) {
    assertPluginId(pluginId);
    const rawValues = value.plugins[pluginId];
    if (!isRecord(rawValues)) {
      throw new PluginSettingsStoreError('invalid-store', 'A plugin settings entry is invalid.');
    }
    const keys = Object.keys(rawValues);
    if (keys.length > pluginSettingsLimits.maximumValuesPerPlugin) {
      throw new PluginSettingsStoreError('resource-limit', 'A plugin has too many stored settings.');
    }
    const normalized: Record<string, PluginSettingValue> = {};
    for (const key of keys) {
      assertSettingKey(key);
      const settingValue = rawValues[key];
      assertSettingValue(settingValue);
      normalized[key] = settingValue;
    }
    if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > pluginSettingsLimits.maximumPluginBytes) {
      throw new PluginSettingsStoreError('resource-limit', 'A plugin settings entry exceeds its size limit.');
    }
    plugins[pluginId] = normalized;
  }
  return { schemaVersion: 1, plugins };
}

function assertPluginId(pluginId: string): void {
  if (typeof pluginId !== 'string' || pluginId.length > 128 || !pluginIdPattern.test(pluginId)) {
    throw new PluginSettingsStoreError('invalid-key', 'The plugin settings namespace is invalid.');
  }
}

function assertSettingKey(key: string): void {
  if (typeof key !== 'string' || key.length > pluginSettingsLimits.maximumKeyCharacters || !settingKeyPattern.test(key)) {
    throw new PluginSettingsStoreError('invalid-key', 'The plugin setting key is invalid.');
  }
}

function assertSettingValue(value: unknown): asserts value is PluginSettingValue {
  if (!isPluginSettingValue(value)) {
    throw new PluginSettingsStoreError('invalid-value', 'The plugin setting value is invalid or too large.');
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
