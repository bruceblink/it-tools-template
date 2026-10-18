export const extensionSdkApiVersion = '0.1.0' as const;

export { FirstPartyExtensionHost } from './extension-host';
export { createBrowserExtensionSettingStorage, createExtensionSettingStorage } from './extension-storage';
export type { ExtensionSettingStorage, ExtensionStorageAdapter } from './extension-storage';
export type {
  ExtensionApiVersionRange,
  ExtensionActivationEvent,
  ExtensionCommand,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionContributions,
  ExtensionContributionDeclarations,
  ExtensionDataProvider,
  ExtensionDataSnapshot,
  ExtensionDisposable,
  ExtensionSettingCatalogDefinition,
  ExtensionManifest,
  ExtensionSettingDefinition,
  ExtensionSettingMigration,
  ExtensionSettingMigrationStatus,
  ExtensionSettingPresentation,
  ExtensionSettingSnapshot,
  ExtensionSettingValue,
  ExtensionSettingsPackageSnapshot,
  ExtensionSearchCommand,
  ExtensionSearchCommandDeclaration,
  ExtensionStatus,
  ExtensionToolCategory,
  FirstPartyExtensionModule,
  FirstPartyExtensionPackage,
} from './extension.types';
