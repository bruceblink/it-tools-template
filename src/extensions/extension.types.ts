import type { ToolCapability, ToolDefinition, ToolPlatform } from '@/tools/tools.types';

export interface ExtensionApiVersionRange {
  minInclusive: string
  maxExclusive: string
}

export type ExtensionActivationEvent =
  | `onTool:${string}`
  | `onCommand:${string}`
  | `onSetting:${string}`
  | `onData:${string}`;

export interface ExtensionContributionDeclarations {
  tools: readonly string[]
  commands: readonly string[]
  settings: readonly string[]
  dataProviders: readonly string[]
}

export interface ExtensionSearchCommandDeclaration {
  id: string
  translations: {
    en: { title: string; description: string }
    zh?: { title: string; description: string }
  }
  keywords: readonly string[]
  targetPath: string
}

/** Metadata is trusted first-party package data; it does not make package code safe to execute. */
export interface ExtensionManifest {
  id: string
  name: string
  version: string
  apiVersion: ExtensionApiVersionRange
  platforms: readonly ToolPlatform[]
  entrypoints: Partial<Record<ToolPlatform, string>>
  activationEvents: readonly ExtensionActivationEvent[]
  requestedCapabilities: readonly ToolCapability[]
  contributions: ExtensionContributionDeclarations
  searchCommands?: readonly ExtensionSearchCommandDeclaration[]
}

export type ExtensionDisposable = () => void | Promise<void>;

export interface ExtensionContext {
  readonly pluginId: string
  readonly apiVersion: string
  readonly signal: AbortSignal
  hasCapability(capability: ToolCapability): boolean
  registerDisposable(disposable: ExtensionDisposable): void
}

export interface ExtensionCommand {
  id: string
  title: string
  requiredCapabilities: readonly ToolCapability[]
  execute(input: unknown, context: ExtensionCommandContext): unknown | Promise<unknown>
}

/** Command execution can read only the settings declared by its own package. */
export interface ExtensionCommandContext extends ExtensionContext {
  getSetting(settingId: string): ExtensionSettingValue
}

export type ExtensionSettingValue = string | number | boolean;

export interface ExtensionSettingMigration {
  fromVersion: number
  migrate(value: unknown): unknown
}

export interface ExtensionSettingPresentation {
  en: { label: string; description: string }
  zh?: { label: string; description: string }
}

export interface ExtensionSettingDefinition {
  id: string
  type: 'string' | 'number' | 'boolean'
  defaultValue: ExtensionSettingValue
  schemaVersion?: number
  integer?: boolean
  minimum?: number
  maximum?: number
  maxLength?: number
  migrations?: readonly ExtensionSettingMigration[]
  presentation?: ExtensionSettingPresentation
}

export type ExtensionSettingCatalogDefinition = Omit<ExtensionSettingDefinition, 'migrations'>;
export type ExtensionSettingMigrationStatus = 'default' | 'current' | 'migrated' | 'migration-failed' | 'newer-version';

export interface ExtensionSettingSnapshot {
  pluginId: string
  packageName: string
  definition: ExtensionSettingCatalogDefinition
  value: ExtensionSettingValue
  migrationStatus: ExtensionSettingMigrationStatus
}

export interface ExtensionSettingsPackageSnapshot {
  pluginId: string
  name: string
  state: ExtensionLifecycleState
  unavailable: boolean
  settings: ExtensionSettingSnapshot[]
}

export interface ExtensionDataProvider {
  id: string
  version: string
  schemaVersion: number
  maxBytes: number
  load(signal: AbortSignal, query?: unknown): unknown | Promise<unknown>
}

export interface ExtensionContributions {
  tools: readonly ToolDefinition[]
  commands: readonly ExtensionCommand[]
  settings: readonly ExtensionSettingDefinition[]
  dataProviders: readonly ExtensionDataProvider[]
}

/** Static category and route metadata is checked before the package implementation is loaded. */
export interface ExtensionToolCategory {
  id: string
  name: string
  components: readonly ToolDefinition[]
}

export interface FirstPartyExtensionModule {
  activate(context: ExtensionContext): ExtensionContributions | Promise<ExtensionContributions>
  deactivate?(): void | Promise<void>
}

export interface FirstPartyExtensionPackage {
  manifest: ExtensionManifest
  toolCategories?: readonly ExtensionToolCategory[]
  load(): Promise<FirstPartyExtensionModule>
}

export type ExtensionLifecycleState = 'registered' | 'activating' | 'active' | 'failed' | 'disabled';

export interface ExtensionStatus {
  id: string
  state: ExtensionLifecycleState
  failure?: 'activation' | 'command' | 'cleanup'
}

export interface ExtensionSearchCommand extends ExtensionSearchCommandDeclaration {
  pluginId: string
}

export interface ExtensionDataSnapshot {
  pluginId: string
  id: string
  version: string
  schemaVersion: number
  value: unknown
}
