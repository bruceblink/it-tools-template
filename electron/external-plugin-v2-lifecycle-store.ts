import { randomUUID } from 'node:crypto';
import { open, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const maximumPlugins = 128;
const maximumStoreBytes = 64 * 1024;

export type ExternalPluginV2LifecycleStoreErrorCode = 'store-unavailable' | 'invalid-store' | 'resource-limit';

export class ExternalPluginV2LifecycleStoreError extends Error {
  constructor(
    readonly code: ExternalPluginV2LifecycleStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ExternalPluginV2LifecycleStoreError';
  }
}

export interface ExternalPluginV2LifecycleState {
  readonly activeVersion: string;
  readonly enabled: boolean;
}

interface StoredLifecycleState {
  readonly schemaVersion: 1;
  readonly plugins: Record<string, ExternalPluginV2LifecycleState>;
}

/** 保存 v2 插件的活动版本和启用状态；写入采用临时文件加原子改名。 */
export class ExternalPluginV2LifecycleStore {
  private readonly statePath: string;
  private readonly values = new Map<string, ExternalPluginV2LifecycleState>();
  private operationQueue: Promise<void> = Promise.resolve();
  private loaded = false;

  constructor(statePath: string) {
    this.statePath = resolve(statePath);
  }

  async load(): Promise<void> {
    await this.runExclusive(async () => {
      if (this.loaded) {
        return;
      }
      await this.ensureParentDirectory();
      const metadata = await lstat(this.statePath).catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return undefined;
        }
        throw new ExternalPluginV2LifecycleStoreError(
          'store-unavailable',
          'The plugin lifecycle store could not be inspected.',
          { cause: error },
        );
      });
      if (!metadata) {
        this.loaded = true;
        return;
      }
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > maximumStoreBytes) {
        throw new ExternalPluginV2LifecycleStoreError(
          'invalid-store',
          'The plugin lifecycle store is not a bounded regular file.',
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(this.statePath))) as unknown;
      }
      catch (error) {
        throw new ExternalPluginV2LifecycleStoreError(
          'invalid-store',
          'The plugin lifecycle store is not valid UTF-8 JSON.',
          { cause: error },
        );
      }
      const state = validateStoredState(parsed);
      this.values.clear();
      for (const [pluginId, lifecycle] of Object.entries(state.plugins)) {
        this.values.set(pluginId, lifecycle);
      }
      this.loaded = true;
    });
  }

  async get(pluginId: string): Promise<ExternalPluginV2LifecycleState | undefined> {
    return this.runExclusive(async () => {
      this.assertLoaded();
      assertPluginId(pluginId);
      const value = this.values.get(pluginId);
      return value === undefined ? undefined : { ...value };
    });
  }

  async set(pluginId: string, lifecycle: ExternalPluginV2LifecycleState): Promise<void> {
    await this.runExclusive(async () => {
      this.assertLoaded();
      assertPluginId(pluginId);
      assertLifecycleState(lifecycle);
      const next = new Map(this.values);
      next.set(pluginId, { ...lifecycle });
      if (next.size > maximumPlugins) {
        throw new ExternalPluginV2LifecycleStoreError(
          'resource-limit',
          'The plugin lifecycle store has too many plugins.',
        );
      }
      await this.writeState(next);
      this.values.clear();
      for (const [id, value] of next) {
        this.values.set(id, value);
      }
    });
  }

  async delete(pluginId: string): Promise<void> {
    await this.runExclusive(async () => {
      this.assertLoaded();
      assertPluginId(pluginId);
      if (!this.values.has(pluginId)) {
        return;
      }
      const next = new Map(this.values);
      next.delete(pluginId);
      await this.writeState(next);
      this.values.clear();
      for (const [id, value] of next) {
        this.values.set(id, value);
      }
    });
  }

  private async ensureParentDirectory(): Promise<void> {
    const parent = dirname(this.statePath);
    await mkdir(parent, { recursive: true, mode: 0o700 }).catch((error: unknown) => {
      throw new ExternalPluginV2LifecycleStoreError(
        'store-unavailable',
        'The plugin lifecycle store directory could not be created.',
        { cause: error },
      );
    });
    const metadata = await lstat(parent).catch((error: unknown) => {
      throw new ExternalPluginV2LifecycleStoreError(
        'store-unavailable',
        'The plugin lifecycle store directory could not be inspected.',
        { cause: error },
      );
    });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new ExternalPluginV2LifecycleStoreError(
        'invalid-store',
        'The plugin lifecycle store directory must be a real directory.',
      );
    }
  }

  private async writeState(values: ReadonlyMap<string, ExternalPluginV2LifecycleState>): Promise<void> {
    const plugins: Record<string, ExternalPluginV2LifecycleState> = {};
    for (const pluginId of [...values.keys()].sort()) {
      const lifecycle = values.get(pluginId)!;
      plugins[pluginId] = { ...lifecycle };
    }
    const bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, plugins } satisfies StoredLifecycleState)}\n`, 'utf8');
    if (bytes.length > maximumStoreBytes) {
      throw new ExternalPluginV2LifecycleStoreError(
        'resource-limit',
        'The plugin lifecycle store exceeds its size limit.',
      );
    }

    const temporaryPath = resolve(dirname(this.statePath), `.plugin-lifecycle-${randomUUID()}.tmp`);
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
      throw new ExternalPluginV2LifecycleStoreError(
        'store-unavailable',
        'The plugin lifecycle store could not be saved.',
        { cause: error },
      );
    }
    finally {
      await fileHandle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
    }
  }

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new ExternalPluginV2LifecycleStoreError(
        'store-unavailable',
        'The plugin lifecycle store has not been loaded.',
      );
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    }
    finally {
      release();
    }
  }
}

function validateStoredState(value: unknown): StoredLifecycleState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExternalPluginV2LifecycleStoreError('invalid-store', 'The plugin lifecycle store must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.plugins !== 'object' || record.plugins === null || Array.isArray(record.plugins)) {
    throw new ExternalPluginV2LifecycleStoreError('invalid-store', 'The plugin lifecycle store schema is invalid.');
  }
  const entries = Object.entries(record.plugins as Record<string, unknown>);
  if (entries.length > maximumPlugins) {
    throw new ExternalPluginV2LifecycleStoreError('resource-limit', 'The plugin lifecycle store has too many plugins.');
  }
  const plugins: Record<string, ExternalPluginV2LifecycleState> = {};
  for (const [pluginId, lifecycle] of entries) {
    assertPluginId(pluginId);
    assertLifecycleState(lifecycle);
    plugins[pluginId] = { ...lifecycle };
  }
  return { schemaVersion: 1, plugins };
}

function assertPluginId(pluginId: string): void {
  if (!pluginIdPattern.test(pluginId) || pluginId.length > 128) {
    throw new ExternalPluginV2LifecycleStoreError('invalid-store', 'The plugin lifecycle store contains an invalid plugin ID.');
  }
}

function assertLifecycleState(value: unknown): asserts value is ExternalPluginV2LifecycleState {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'activeVersion' && key !== 'enabled')
    || typeof (value as Record<string, unknown>).activeVersion !== 'string'
    || !versionPattern.test((value as Record<string, unknown>).activeVersion as string)
    || typeof (value as Record<string, unknown>).enabled !== 'boolean'
  ) {
    throw new ExternalPluginV2LifecycleStoreError('invalid-store', 'The plugin lifecycle state is invalid.');
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
