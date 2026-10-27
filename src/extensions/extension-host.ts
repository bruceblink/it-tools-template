import { createValidatedToolRegistry, validateToolRegistry } from '@/tools/tool-registry';
import type { ToolCapability, ToolCategory, ToolDefinition, ToolPlatform } from '@/tools/tools.types';
import { firstPartyExtensionCapabilityIds } from '@/shared/plugin-capabilities';
import { isNamespacedContributionId, validateExtensionManifest } from './extension-manifest';
import { createExtensionSettingStorage } from './extension-storage';
import type {
  ExtensionCommand,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionContributions,
  ExtensionDataProvider,
  ExtensionDataSnapshot,
  ExtensionDisposable,
  ExtensionLifecycleState,
  ExtensionManifest,
  ExtensionSettingCatalogDefinition,
  ExtensionSettingDefinition,
  ExtensionSettingMigrationStatus,
  ExtensionSettingSnapshot,
  ExtensionSettingValue,
  ExtensionSettingsPackageSnapshot,
  ExtensionSearchCommand,
  ExtensionStatus,
  FirstPartyExtensionPackage,
  ExtensionToolCategory,
} from './extension.types';
import type { ExtensionSettingStorage } from './extension-storage';

const maxProviderBytes = 8 * 1024 * 1024;
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const knownCapabilities = new Set<ToolCapability>(firstPartyExtensionCapabilityIds);

export interface ExtensionHostOptions {
  apiVersion: string
  platform: ToolPlatform
  grantedCapabilities?: Readonly<Record<string, readonly ToolCapability[]>>
  settingsStorage?: ExtensionSettingStorage
}

interface ExtensionRecord {
  package: FirstPartyExtensionPackage
  state: ExtensionLifecycleState
  failure?: ExtensionStatus['failure']
  module?: Awaited<ReturnType<FirstPartyExtensionPackage['load']>>
  contributions?: ExtensionContributions
  controller?: AbortController
  activation?: Promise<ExtensionContributions>
  disposables: ExtensionDisposable[]
  settings: Map<string, ExtensionSettingValue>
  settingMigrationStatuses: Map<string, ExtensionSettingMigrationStatus>
}

interface StoredExtensionSetting {
  schemaVersion: number
  value: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getSettingSchemaVersion(setting: ExtensionSettingDefinition): number {
  return setting.schemaVersion ?? 1;
}

function isStoredExtensionSetting(value: unknown): value is StoredExtensionSetting {
  return isRecord(value)
    && Number.isSafeInteger(value.schemaVersion)
    && (value.schemaVersion as number) >= 1
    && 'value' in value;
}

function getDeclaredIds(manifest: ExtensionManifest, kind: keyof ExtensionManifest['contributions']): readonly string[] {
  return manifest.contributions[kind];
}

function assertExactContributionIds(
  pluginId: string,
  kind: string,
  declared: readonly string[],
  actual: readonly { id: string }[],
): void {
  const ids = actual.map((value) => {
    if (typeof value !== 'object' || value === null || !('id' in value)) {
      return undefined;
    }
    return value.id;
  });
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    throw new Error(`Extension ${pluginId} returned invalid or duplicate ${kind} IDs.`);
  }
  const receivedIds = ids as string[];
  const expected = [...declared].sort();
  const received = [...receivedIds].sort();
  if (expected.length !== received.length || expected.some((id, index) => id !== received[index])) {
    throw new Error(`Extension ${pluginId} returned ${kind} that do not match its manifest.`);
  }
}

function isSettingValueOfType(type: ExtensionSettingDefinition['type'], value: unknown): value is ExtensionSettingValue {
  if (type === 'string') {
    return typeof value === 'string';
  }
  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  return typeof value === 'boolean';
}

function validateSettingDefinition(setting: ExtensionSettingDefinition): void {
  if (!setting || typeof setting !== 'object' || typeof setting.id !== 'string' || !setting.id) {
    throw new Error('Extension returned an invalid setting definition.');
  }
  const schemaVersion = getSettingSchemaVersion(setting);
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 1000) {
    throw new Error(`Extension setting ${setting.id} has an invalid schema version.`);
  }
  if (
    (setting.type === 'string' && typeof setting.defaultValue !== 'string')
    || (setting.type === 'number' && (typeof setting.defaultValue !== 'number' || !Number.isFinite(setting.defaultValue)))
    || (setting.type === 'boolean' && typeof setting.defaultValue !== 'boolean')
  ) {
    throw new Error(`Extension setting ${setting.id} has a default value with the wrong type.`);
  }
  if (!['string', 'number', 'boolean'].includes(setting.type)) {
    throw new Error(`Extension setting ${setting.id} declares an unsupported value type.`);
  }
  if (setting.integer !== undefined && typeof setting.integer !== 'boolean') {
    throw new Error(`Extension setting ${setting.id} declares an invalid integer flag.`);
  }
  if (setting.type === 'number') {
    if (
      (setting.minimum !== undefined && !Number.isFinite(setting.minimum))
      || (setting.maximum !== undefined && !Number.isFinite(setting.maximum))
      || (setting.minimum !== undefined && setting.maximum !== undefined && setting.minimum > setting.maximum)
      || (typeof setting.defaultValue === 'number' && setting.minimum !== undefined && setting.defaultValue < setting.minimum)
      || (typeof setting.defaultValue === 'number' && setting.maximum !== undefined && setting.defaultValue > setting.maximum)
      || (setting.integer === true && (
        !Number.isSafeInteger(setting.defaultValue)
        || (setting.minimum !== undefined && !Number.isSafeInteger(setting.minimum))
        || (setting.maximum !== undefined && !Number.isSafeInteger(setting.maximum))
      ))
    ) {
      throw new Error(`Extension setting ${setting.id} has an invalid numeric range.`);
    }
  }
  else if (setting.minimum !== undefined || setting.maximum !== undefined || setting.integer !== undefined) {
    throw new Error(`Extension setting ${setting.id} uses numeric options for a non-numeric value.`);
  }
  if (setting.type === 'string') {
    const maxLength = setting.maxLength ?? 1024;
    if (
      !Number.isSafeInteger(maxLength)
      || maxLength < 1
      || maxLength > 4096
      || (typeof setting.defaultValue === 'string' && setting.defaultValue.length > maxLength)
    ) {
      throw new Error(`Extension setting ${setting.id} has an invalid string length limit.`);
    }
  }
  else if (setting.maxLength !== undefined) {
    throw new Error(`Extension setting ${setting.id} uses a string limit for a non-string value.`);
  }

  const migrations = setting.migrations ?? [];
  if (!Array.isArray(migrations)) {
    throw new Error(`Extension setting ${setting.id} declares an invalid migration list.`);
  }
  const migrationsByVersion = new Map<number, (typeof migrations)[number]>();
  for (const migration of migrations) {
    if (
      !migration
      || !Number.isSafeInteger(migration.fromVersion)
      || migration.fromVersion < 1
      || migration.fromVersion >= schemaVersion
      || typeof migration.migrate !== 'function'
      || migrationsByVersion.has(migration.fromVersion)
    ) {
      throw new Error(`Extension setting ${setting.id} declares an invalid or duplicate migration.`);
    }
    migrationsByVersion.set(migration.fromVersion, migration);
  }
  for (let version = 1; version < schemaVersion; version++) {
    if (!migrationsByVersion.has(version)) {
      throw new Error(`Extension setting ${setting.id} is missing migration from schema version ${version}.`);
    }
  }

  if (setting.presentation !== undefined) {
    const presentation: unknown = setting.presentation;
    if (!isRecord(presentation) || !isRecord(presentation.en)) {
      throw new Error(`Extension setting ${setting.id} has invalid presentation text.`);
    }
    const translations = [presentation.en, presentation.zh].filter(value => value !== undefined);
    for (const translation of translations) {
      if (
        !isRecord(translation)
        || typeof translation.label !== 'string'
        || !translation.label.trim()
        || translation.label.length > 120
        || typeof translation.description !== 'string'
        || translation.description.length > 240
      ) {
        throw new Error(`Extension setting ${setting.id} has invalid presentation text.`);
      }
    }
  }
}

function validateProvider(provider: ExtensionDataProvider): void {
  if (!provider || typeof provider !== 'object' || typeof provider.id !== 'string' || !provider.id) {
    throw new Error('Extension returned an invalid data provider.');
  }
  if (typeof provider.version !== 'string' || !stableVersionPattern.test(provider.version)) {
    throw new Error(`Extension data provider ${provider.id} must use a stable semantic version.`);
  }
  if (!Number.isSafeInteger(provider.schemaVersion) || provider.schemaVersion < 1) {
    throw new Error(`Extension data provider ${provider.id} has an invalid schema version.`);
  }
  if (!Number.isSafeInteger(provider.maxBytes) || provider.maxBytes < 1 || provider.maxBytes > maxProviderBytes) {
    throw new Error(`Extension data provider ${provider.id} exceeds the supported size limit.`);
  }
  if (typeof provider.load !== 'function') {
    throw new Error(`Extension data provider ${provider.id} must provide a loader.`);
  }
}

function assertCapabilityList(pluginId: string, capabilities: readonly ToolCapability[]): void {
  if (!Array.isArray(capabilities) || new Set(capabilities).size !== capabilities.length) {
    throw new Error(`Extension ${pluginId} returned invalid capability metadata.`);
  }
  if (capabilities.some(capability => !knownCapabilities.has(capability))) {
    throw new Error(`Extension ${pluginId} returned an unknown capability.`);
  }
}

function validateCommand(pluginId: string, manifest: ExtensionManifest, command: ExtensionCommand): void {
  if (
    !command
    || typeof command !== 'object'
    || typeof command.id !== 'string'
    || !isNamespacedContributionId(pluginId, command.id)
    || typeof command.title !== 'string'
    || !command.title.trim()
    || typeof command.execute !== 'function'
  ) {
    throw new Error(`Extension ${pluginId} returned an invalid command.`);
  }
  assertCapabilityList(pluginId, command.requiredCapabilities);
  if (command.requiredCapabilities.some(capability => !manifest.requestedCapabilities.includes(capability))) {
    throw new Error(`Extension command ${command.id} requires an undeclared capability.`);
  }
}

function createExtensionContext(
  record: ExtensionRecord,
  apiVersion: string,
  grantedCapabilities: ReadonlySet<ToolCapability>,
): ExtensionContext {
  const controller = record.controller;
  if (!controller) {
    throw new Error(`Extension ${record.package.manifest.id} has no active lifecycle.`);
  }
  return {
    pluginId: record.package.manifest.id,
    apiVersion,
    signal: controller.signal,
    hasCapability: capability => record.package.manifest.requestedCapabilities.includes(capability) && grantedCapabilities.has(capability),
    registerDisposable: (disposable) => {
      if (controller.signal.aborted) {
        throw new Error(`Extension ${record.package.manifest.id} cannot register resources after deactivation.`);
      }
      if (typeof disposable !== 'function') {
        throw new TypeError('Extension resources must provide a cleanup function.');
      }
      record.disposables.push(disposable);
    },
  };
}

function toToolCategories(categories: readonly ExtensionToolCategory[] | undefined): ToolCategory[] {
  return (categories ?? []).map(({ id, name, components }) => ({ id, name, components: [...components] }));
}

function mergeToolCategories(categories: readonly ToolCategory[]): ToolCategory[] {
  const merged = new Map<string, ToolCategory>();
  for (const category of categories) {
    const existing = merged.get(category.id ?? '');
    if (existing) {
      if (existing.name !== category.name) {
        throw new Error(`Tool category ${category.id} has conflicting display names.`);
      }
      existing.components.push(...category.components);
    }
    else {
      merged.set(category.id ?? '', { ...category, components: [...category.components] });
    }
  }
  return [...merged.values()];
}

function getPackageTools(extensionPackage: FirstPartyExtensionPackage): ToolDefinition[] {
  return (extensionPackage.toolCategories ?? []).flatMap(({ components }) => [...components]);
}

function getRegisteredCategories(record: ExtensionRecord, tools: readonly ToolDefinition[]): ToolCategory[] {
  if (tools.length === 0) {
    return [];
  }
  const toolsById = new Map(tools.flatMap(tool => typeof tool.id === 'string' ? [[tool.id, tool] as const] : []));
  return toToolCategories(record.package.toolCategories).map((category) => {
    const components = category.components.map((tool) => {
      if (typeof tool.id !== 'string') {
        throw new Error(`Extension ${record.package.manifest.id} registered a tool without an ID.`);
      }
      const activeTool = toolsById.get(tool.id);
      if (!activeTool) {
        throw new Error(`Extension ${record.package.manifest.id} did not activate registered tool ${tool.id}.`);
      }
      return activeTool;
    });
    return { ...category, components };
  }).filter(category => category.components.length > 0);
}

function sameStringList(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && left.length === right.length && left.every((value, index) => value === right[index]);
}

function matchesRegisteredTool(actual: ToolDefinition, registered: ToolDefinition): boolean {
  return actual.id === registered.id
    && actual.categoryId === registered.categoryId
    && actual.path === registered.path
    && actual.name === registered.name
    && actual.translationKey === registered.translationKey
    && actual.description === registered.description
    && sameStringList(actual.keywords, registered.keywords)
    && sameStringList(actual.aliases, registered.aliases)
    && sameStringList(actual.redirectFrom, registered.redirectFrom)
    && actual.component === registered.component
    && actual.icon === registered.icon
    && sameStringList(actual.platforms, registered.platforms)
    && actual.dataProcessing === registered.dataProcessing
    && actual.offline === registered.offline
    && sameStringList(actual.capabilities, registered.capabilities)
    && actual.isNew === registered.isNew
    && actual.createdAt?.getTime() === registered.createdAt?.getTime();
}

/** Own first-party package activation and resources without granting third-party isolation. */
export class FirstPartyExtensionHost {
  private readonly records = new Map<string, ExtensionRecord>();
  private readonly grants: Readonly<Record<string, readonly ToolCapability[]>>;
  private readonly settingsStorage: ExtensionSettingStorage;
  private disposed = false;

  constructor(private readonly options: ExtensionHostOptions) {
    this.grants = options.grantedCapabilities ?? {};
    this.settingsStorage = options.settingsStorage ?? createExtensionSettingStorage();
    if (!stableVersionPattern.test(options.apiVersion)) {
      throw new Error('Host API version must use stable semantic version format MAJOR.MINOR.PATCH.');
    }
  }

  /** Register static metadata only; package code remains unloaded until a declared event occurs. */
  register(extensionPackage: FirstPartyExtensionPackage): void {
    this.assertUsable();
    if (!extensionPackage || typeof extensionPackage !== 'object' || !extensionPackage.manifest) {
      throw new Error('Extension package must provide a manifest.');
    }
    validateExtensionManifest(extensionPackage.manifest, this.options.apiVersion, this.options.platform);
    if (typeof extensionPackage.load !== 'function') {
      throw new Error(`Extension ${extensionPackage.manifest.id} must provide a package loader.`);
    }
    const pluginId = extensionPackage.manifest.id;
    if (this.records.has(pluginId)) {
      throw new Error(`Extension ${pluginId} is already registered.`);
    }
    const packageCategories = toToolCategories(extensionPackage.toolCategories);
    const packageTools = getPackageTools(extensionPackage);
    assertExactContributionIds(pluginId, 'tools', getDeclaredIds(extensionPackage.manifest, 'tools'), packageTools);
    validateToolRegistry(packageCategories, 'extension');
    for (const tool of packageTools) {
      if (!isNamespacedContributionId(pluginId, tool.id)) {
        throw new Error(`Extension ${pluginId} registered tool ${tool.id} outside its namespace.`);
      }
      if (tool.platforms.some(platform => !extensionPackage.manifest.platforms.includes(platform))) {
        throw new Error(`Extension tool ${tool.id} targets a platform absent from its manifest.`);
      }
      assertCapabilityList(pluginId, tool.capabilities);
      if (tool.capabilities.some(capability => !extensionPackage.manifest.requestedCapabilities.includes(capability))) {
        throw new Error(`Extension tool ${tool.id} requires an undeclared capability.`);
      }
    }
    const allPackageCategories = [...this.records.values()]
      .flatMap(record => toToolCategories(record.package.toolCategories));
    createValidatedToolRegistry(mergeToolCategories([...allPackageCategories, ...packageCategories]), 'extension');
    this.records.set(pluginId, {
      package: extensionPackage,
      state: 'registered',
      disposables: [],
      settings: new Map(),
      settingMigrationStatuses: new Map(),
    });
  }

  getStatus(pluginId: string): ExtensionStatus {
    const record = this.requireRecord(pluginId);
    return { id: pluginId, state: record.state, failure: record.failure };
  }

  /** Return static search entries without loading extension implementation modules. */
  getSearchableCommands(): ExtensionSearchCommand[] {
    this.assertUsable();
    return [...this.records.values()]
      .filter(record => record.state !== 'disabled')
      .flatMap((record) => {
        const pluginId = record.package.manifest.id;
        return (record.package.manifest.searchCommands ?? []).map(command => ({
          ...command,
          pluginId,
          translations: {
            en: { ...command.translations.en },
            zh: command.translations.zh ? { ...command.translations.zh } : undefined,
          },
          keywords: [...command.keywords],
        }));
      });
  }

  /** Activate one package only when the exact event appears in its manifest. */
  async activate(pluginId: string, event: string): Promise<ExtensionContributions> {
    this.assertUsable();
    const record = this.requireRecord(pluginId);
    if (record.state === 'disabled') {
      throw new Error(`Extension ${pluginId} is disabled.`);
    }
    if (!record.package.manifest.activationEvents.some(activationEvent => activationEvent === event)) {
      throw new Error(`Extension ${pluginId} does not declare activation event ${event}.`);
    }
    if (record.state === 'active' && record.contributions) {
      return record.contributions;
    }
    if (record.activation) {
      return record.activation;
    }

    const activation = this.performActivation(record);
    record.activation = activation;
    try {
      return await activation;
    }
    finally {
      if (record.activation === activation) {
        record.activation = undefined;
      }
    }
  }

  async executeCommand(pluginId: string, commandId: string, input: unknown): Promise<unknown> {
    const contributions = await this.activate(pluginId, `onCommand:${commandId}`);
    const command = contributions.commands.find(candidate => candidate.id === commandId);
    if (!command) {
      throw new Error(`Extension ${pluginId} did not provide command ${commandId}.`);
    }
    const granted = this.getGrantedCapabilities(pluginId);
    if (command.requiredCapabilities.some(capability => !granted.has(capability))) {
      throw new Error(`Extension command ${commandId} is missing a granted capability.`);
    }

    const record = this.requireRecord(pluginId);
    const context: ExtensionCommandContext = {
      ...createExtensionContext(record, this.options.apiVersion, granted),
      getSetting: (settingId) => {
        if (!isNamespacedContributionId(pluginId, settingId) || !record.package.manifest.contributions.settings.includes(settingId)) {
          throw new Error(`Extension command ${commandId} cannot read undeclared setting ${settingId}.`);
        }
        const definition = record.contributions?.settings.find(setting => setting.id === settingId);
        if (!definition || !record.settings.has(settingId)) {
          throw new Error(`Extension setting ${settingId} is not available to command ${commandId}.`);
        }
        return record.settings.get(settingId)!;
      },
    };
    try {
      const result = await command.execute(input, context);
      if (context.signal.aborted) {
        throw new Error(`Extension command ${commandId} was cancelled.`);
      }
      return result;
    }
    catch (error) {
      if (!context.signal.aborted) {
        await this.failRecord(record, 'command');
      }
      throw error;
    }
  }

  async getSetting(pluginId: string, settingId: string): Promise<ExtensionSettingValue> {
    return (await this.getSettingState(pluginId, settingId)).value;
  }

  async getSettingState(pluginId: string, settingId: string): Promise<ExtensionSettingSnapshot> {
    const contributions = await this.activate(pluginId, `onSetting:${settingId}`);
    const definition = contributions.settings.find(setting => setting.id === settingId);
    if (!definition) {
      throw new Error(`Extension ${pluginId} did not provide setting ${settingId}.`);
    }
    const record = this.requireRecord(pluginId);
    this.restoreSetting(record, definition);
    const catalogDefinition: ExtensionSettingCatalogDefinition = {
      id: definition.id,
      type: definition.type,
      defaultValue: definition.defaultValue,
      schemaVersion: getSettingSchemaVersion(definition),
      integer: definition.integer,
      minimum: definition.minimum,
      maximum: definition.maximum,
      maxLength: definition.maxLength,
      presentation: definition.presentation ? {
        en: { ...definition.presentation.en },
        zh: definition.presentation.zh ? { ...definition.presentation.zh } : undefined,
      } : undefined,
    };
    return {
      pluginId,
      packageName: record.package.manifest.name,
      definition: catalogDefinition,
      value: record.settings.get(settingId)!,
      migrationStatus: record.settingMigrationStatuses.get(settingId) ?? 'default',
    };
  }

  /** Activate only packages that declare settings and report failures per package. */
  async getSettingsCatalog(): Promise<ExtensionSettingsPackageSnapshot[]> {
    this.assertUsable();
    const packages: ExtensionSettingsPackageSnapshot[] = [];
    for (const record of this.records.values()) {
      const settingIds = getDeclaredIds(record.package.manifest, 'settings');
      if (settingIds.length === 0) {
        continue;
      }
      const settings: ExtensionSettingSnapshot[] = [];
      let unavailable = record.state === 'disabled';
      if (!unavailable) {
        for (const settingId of settingIds) {
          try {
            settings.push(await this.getSettingState(record.package.manifest.id, settingId));
          }
          catch {
            unavailable = true;
            break;
          }
        }
      }
      packages.push({
        pluginId: record.package.manifest.id,
        name: record.package.manifest.name,
        state: record.state,
        unavailable,
        settings,
      });
    }
    return packages;
  }

  async setSetting(pluginId: string, settingId: string, value: unknown): Promise<void> {
    const contributions = await this.activate(pluginId, `onSetting:${settingId}`);
    const definition = contributions.settings.find(setting => setting.id === settingId);
    if (!definition) {
      throw new Error(`Extension ${pluginId} did not provide setting ${settingId}.`);
    }
    this.assertSettingValue(definition, value);
    this.settingsStorage.write(pluginId, settingId, value, getSettingSchemaVersion(definition));
    const record = this.requireRecord(pluginId);
    record.settings.set(settingId, value);
    record.settingMigrationStatuses.set(settingId, 'current');
  }

  async readData(pluginId: string, providerId: string, query?: unknown): Promise<ExtensionDataSnapshot> {
    const contributions = await this.activate(pluginId, `onData:${providerId}`);
    const provider = contributions.dataProviders.find(candidate => candidate.id === providerId);
    if (!provider) {
      throw new Error(`Extension ${pluginId} did not provide data source ${providerId}.`);
    }
    const record = this.requireRecord(pluginId);
    const context = createExtensionContext(record, this.options.apiVersion, this.getGrantedCapabilities(pluginId));
    const value = await provider.load(context.signal, query);
    if (context.signal.aborted) {
      throw new Error(`Extension data request ${providerId} was cancelled.`);
    }
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).byteLength > provider.maxBytes) {
      throw new Error(`Extension data source ${providerId} returned unsupported or oversized data.`);
    }
    return {
      pluginId,
      id: provider.id,
      version: provider.version,
      schemaVersion: provider.schemaVersion,
      value,
    };
  }

  /** Validate the combined active tool set before a caller publishes it to navigation or routing. */
  getToolRegistry() {
    this.assertUsable();
    const categories = mergeToolCategories([...this.records.values()]
      .filter(record => record.state === 'active' && record.contributions)
      .flatMap(record => getRegisteredCategories(record, record.contributions!.tools)));
    return createValidatedToolRegistry(categories, 'extension');
  }

  async deactivate(pluginId: string): Promise<void> {
    const record = this.requireRecord(pluginId);
    if (record.state === 'disabled') {
      return;
    }
    if (record.activation) {
      record.controller?.abort();
      try {
        await record.activation;
      }
      catch {
        // Activation already records the failure and performs resource cleanup.
      }
    }
    try {
      await this.releaseResources(record);
      record.failure = undefined;
      record.state = 'registered';
    }
    catch (error) {
      record.failure = 'cleanup';
      record.state = 'failed';
      throw error;
    }
  }

  async disable(pluginId: string): Promise<void> {
    const record = this.requireRecord(pluginId);
    let cleanupFailure: unknown;
    try {
      await this.deactivate(pluginId);
    }
    catch (error) {
      cleanupFailure = error;
    }
    record.state = 'disabled';
    if (cleanupFailure) {
      throw cleanupFailure;
    }
  }

  enable(pluginId: string): void {
    this.assertUsable();
    const record = this.requireRecord(pluginId);
    if (record.state === 'disabled') {
      record.state = 'registered';
      record.failure = undefined;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const failures: unknown[] = [];
    for (const record of this.records.values()) {
      try {
        if (record.activation) {
          record.controller?.abort();
          await record.activation.catch(() => undefined);
        }
        await this.releaseResources(record);
        record.state = 'disabled';
      }
      catch (error) {
        record.state = 'failed';
        record.failure = 'cleanup';
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more extensions failed to clean up.');
    }
  }

  private async performActivation(record: ExtensionRecord): Promise<ExtensionContributions> {
    const manifest = record.package.manifest;
    const pluginId = manifest.id;
    record.state = 'activating';
    record.failure = undefined;
    record.controller = new AbortController();
    const context = createExtensionContext(record, this.options.apiVersion, this.getGrantedCapabilities(pluginId));
    try {
      const module = await record.package.load();
      if (record.controller.signal.aborted) {
        throw new Error(`Extension ${pluginId} activation was cancelled.`);
      }
      record.module = module;
      const contributions = await module.activate(context);
      if (record.controller.signal.aborted) {
        throw new Error(`Extension ${pluginId} activation was cancelled.`);
      }
      this.validateContributions(record, contributions);
      this.assertCombinedToolsValid(record, contributions);
      record.contributions = contributions;
      for (const setting of contributions.settings) {
        this.restoreSetting(record, setting);
      }
      record.state = 'active';
      return contributions;
    }
    catch (error) {
      try {
        await this.releaseResources(record);
      }
      catch (cleanupError) {
        record.failure = 'cleanup';
        record.state = 'failed';
        throw new AggregateError([error, cleanupError], `Extension ${pluginId} failed to activate and clean up.`);
      }
      record.failure = 'activation';
      record.state = 'failed';
      throw error;
    }
  }

  private validateContributions(record: ExtensionRecord, contributions: ExtensionContributions): void {
    const manifest = record.package.manifest;
    const pluginId = manifest.id;
    if (!contributions || typeof contributions !== 'object') {
      throw new Error(`Extension ${pluginId} returned invalid contributions.`);
    }
    for (const key of ['tools', 'commands', 'settings', 'dataProviders'] as const) {
      if (!Array.isArray(contributions[key])) {
        throw new Error(`Extension ${pluginId} returned an invalid ${key} list.`);
      }
      assertExactContributionIds(pluginId, key, getDeclaredIds(manifest, key), contributions[key]);
    }

    const registeredTools = new Map(getPackageTools(record.package).map(tool => [tool.id, tool]));
    for (const tool of contributions.tools) {
      const registeredTool = registeredTools.get(tool.id);
      if (!registeredTool || !matchesRegisteredTool(tool, registeredTool)) {
        throw new Error(`Extension tool ${tool.id} differs from its registered route metadata.`);
      }
      if (tool.platforms?.some(platform => !manifest.platforms.includes(platform))) {
        throw new Error(`Extension tool ${tool.id} targets a platform absent from its manifest.`);
      }
      assertCapabilityList(pluginId, tool.capabilities ?? []);
      if (tool.capabilities?.some(capability => !manifest.requestedCapabilities.includes(capability))) {
        throw new Error(`Extension tool ${tool.id} requires an undeclared capability.`);
      }
    }
    for (const command of contributions.commands) {
      validateCommand(pluginId, manifest, command);
    }
    for (const setting of contributions.settings) {
      validateSettingDefinition(setting);
    }
    for (const provider of contributions.dataProviders) {
      validateProvider(provider);
    }
  }

  private assertCombinedToolsValid(candidate: ExtensionRecord, contributions: ExtensionContributions): void {
    const categories = [...this.records.values()]
      .filter(record => record !== candidate && record.state === 'active' && record.contributions)
      .flatMap(record => getRegisteredCategories(record, record.contributions!.tools));
    categories.push(...getRegisteredCategories(candidate, contributions.tools));
    createValidatedToolRegistry(mergeToolCategories(categories), 'extension');
  }

  private async failRecord(record: ExtensionRecord, failure: NonNullable<ExtensionStatus['failure']>): Promise<void> {
    try {
      await this.releaseResources(record);
      record.failure = failure;
      record.state = 'failed';
    }
    catch (error) {
      record.failure = 'cleanup';
      record.state = 'failed';
      throw error;
    }
  }

  private async releaseResources(record: ExtensionRecord): Promise<void> {
    record.controller?.abort();
    const module = record.module;
    record.module = undefined;
    record.contributions = undefined;
    record.controller = undefined;
    const disposables = record.disposables.splice(0).reverse();
    const failures: unknown[] = [];

    try {
      await module?.deactivate?.();
    }
    catch (error) {
      failures.push(error);
    }
    for (const dispose of disposables) {
      try {
        await dispose();
      }
      catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `Extension ${record.package.manifest.id} resource cleanup failed.`);
    }
  }

  private assertSettingValue(setting: ExtensionSettingDefinition, value: unknown): asserts value is ExtensionSettingValue {
    if (!isSettingValueOfType(setting.type, value)) {
      throw new Error(`Setting ${setting.id} must use the ${setting.type} value type.`);
    }
    if (setting.type === 'number' && setting.integer === true && !Number.isSafeInteger(value)) {
      throw new Error(`Setting ${setting.id} must use a safe integer.`);
    }
    if (setting.type === 'number' && typeof value === 'number' && (
      (setting.minimum !== undefined && value < setting.minimum)
      || (setting.maximum !== undefined && value > setting.maximum)
    )) {
      throw new Error(`Setting ${setting.id} is outside its allowed range.`);
    }
    if (setting.type === 'string' && typeof value === 'string' && value.length > (setting.maxLength ?? 1024)) {
      throw new Error(`Setting ${setting.id} exceeds its allowed string length.`);
    }
  }

  private restoreSetting(record: ExtensionRecord, setting: ExtensionSettingDefinition): void {
    if (record.settings.has(setting.id)) {
      return;
    }
    const pluginId = record.package.manifest.id;
    const targetVersion = getSettingSchemaVersion(setting);
    let storedValue: unknown;
    try {
      storedValue = this.settingsStorage.read(pluginId, setting.id);
    }
    catch {
      storedValue = undefined;
    }
    if (storedValue === undefined) {
      record.settings.set(setting.id, setting.defaultValue);
      record.settingMigrationStatuses.set(setting.id, 'default');
      return;
    }

    let isVersioned = false;
    let storedVersion = 1;
    let migratedValue: unknown = storedValue;
    if (isStoredExtensionSetting(storedValue)) {
      isVersioned = true;
      storedVersion = storedValue.schemaVersion;
      migratedValue = storedValue.value;
    }
    const useDefault = (status: ExtensionSettingMigrationStatus) => {
      record.settings.set(setting.id, setting.defaultValue);
      record.settingMigrationStatuses.set(setting.id, status);
    };

    if (storedVersion > targetVersion) {
      useDefault('newer-version');
      return;
    }

    let currentVersion = storedVersion;
    while (currentVersion < targetVersion) {
      const migration = setting.migrations?.find(candidate => candidate.fromVersion === currentVersion);
      if (!migration) {
        useDefault('migration-failed');
        return;
      }
      try {
        migratedValue = migration.migrate(migratedValue);
      }
      catch {
        useDefault('migration-failed');
        return;
      }
      currentVersion++;
    }

    try {
      this.assertSettingValue(setting, migratedValue);
    }
    catch {
      useDefault('migration-failed');
      return;
    }

    record.settings.set(setting.id, migratedValue);
    const requiresRewrite = !isVersioned || storedVersion < targetVersion;
    record.settingMigrationStatuses.set(setting.id, requiresRewrite ? 'migrated' : 'current');
    if (requiresRewrite) {
      try {
        this.settingsStorage.write(pluginId, setting.id, migratedValue, targetVersion);
      }
      catch {
        record.settingMigrationStatuses.set(setting.id, 'migration-failed');
      }
    }
  }

  private getGrantedCapabilities(pluginId: string): ReadonlySet<ToolCapability> {
    const requested = new Set(this.requireRecord(pluginId).package.manifest.requestedCapabilities);
    return new Set((this.grants[pluginId] ?? []).filter(capability => requested.has(capability) && knownCapabilities.has(capability)));
  }

  private requireRecord(pluginId: string): ExtensionRecord {
    const record = this.records.get(pluginId);
    if (!record) {
      throw new Error(`Extension ${pluginId} is not registered.`);
    }
    return record;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error('Extension host has been disposed.');
    }
  }
}
