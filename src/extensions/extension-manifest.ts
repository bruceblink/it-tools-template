import type { ToolCapability, ToolPlatform } from '@/tools/tools.types';
import { firstPartyExtensionCapabilityIds } from '@/shared/plugin-capabilities';
import type { ExtensionManifest } from './extension.types';

const extensionIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){2,}$/;
const contributionIdSuffixPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const supportedPlatforms = new Set<ToolPlatform>(['web', 'electron']);
const knownCapabilities = new Set<ToolCapability>(firstPartyExtensionCapabilityIds);
const contributionKinds = ['tools', 'commands', 'settings', 'dataProviders'] as const;

type StableVersion = readonly [major: number, minor: number, patch: number];

function parseStableVersion(value: unknown, label: string): StableVersion {
  if (typeof value !== 'string') {
    throw new Error(`${label} must use stable semantic version format MAJOR.MINOR.PATCH.`);
  }
  const match = stableVersionPattern.exec(value);
  if (!match) {
    throw new Error(`${label} must use stable semantic version format MAJOR.MINOR.PATCH.`);
  }

  const parts = match.slice(1).map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) {
    throw new Error(`${label} contains a version number outside the safe integer range.`);
  }
  return parts as unknown as StableVersion;
}

function compareVersions(left: StableVersion, right: StableVersion): number {
  for (let index = 0; index < left.length; index++) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertContributionIds(manifest: ExtensionManifest): void {
  if (!isRecord(manifest.contributions)) {
    throw new Error(`Extension ${manifest.id} must declare its contributions.`);
  }
  const declaredIds = new Set<string>();
  for (const kind of contributionKinds) {
    const ids: unknown = manifest.contributions[kind];
    if (!Array.isArray(ids)) {
      throw new Error(`Extension ${manifest.id} must declare a ${kind} list.`);
    }
    for (const id of ids) {
      if (typeof id !== 'string' || !isNamespacedContributionId(manifest.id, id)) {
        throw new Error(`Extension ${manifest.id} declares an invalid ${kind} ID.`);
      }
      if (declaredIds.has(id)) {
        throw new Error(`Extension ${manifest.id} declares contribution ID ${id} more than once.`);
      }
      declaredIds.add(id);
    }
  }
}

function getActivationTarget(event: unknown): { kind: typeof contributionKinds[number]; id: string } | undefined {
  if (typeof event !== 'string') {
    return undefined;
  }
  const separator = event.indexOf(':');
  if (separator < 0) {
    return undefined;
  }
  const prefix = event.slice(0, separator);
  const id = event.slice(separator + 1);
  const kind = prefix === 'onTool'
    ? 'tools'
    : prefix === 'onCommand'
      ? 'commands'
      : prefix === 'onSetting'
        ? 'settings'
        : prefix === 'onData'
          ? 'dataProviders'
          : undefined;
  return kind && id ? { kind, id } : undefined;
}

function assertActivationEvents(manifest: ExtensionManifest): void {
  if (!Array.isArray(manifest.activationEvents) || manifest.activationEvents.length === 0) {
    throw new Error(`Extension ${manifest.id} must declare at least one activation event.`);
  }

  const seenEvents = new Set<string>();
  const activatedContributions = new Set<string>();
  for (const event of manifest.activationEvents) {
    const target = getActivationTarget(event);
    if (!target || !isNamespacedContributionId(manifest.id, target.id)) {
      throw new Error(`Extension ${manifest.id} declares an invalid activation event: ${event}.`);
    }
    const declared = manifest.contributions[target.kind];
    const eventKey = `${target.kind}:${target.id}`;
    if (!declared.includes(target.id)) {
      throw new Error(`Extension ${manifest.id} activates undeclared contribution ${target.id}.`);
    }
    if (seenEvents.has(eventKey)) {
      throw new Error(`Extension ${manifest.id} declares activation event ${event} more than once.`);
    }
    seenEvents.add(eventKey);
    activatedContributions.add(eventKey);
  }

  for (const kind of contributionKinds) {
    for (const id of manifest.contributions[kind]) {
      if (!activatedContributions.has(`${kind}:${id}`)) {
        throw new Error(`Extension ${manifest.id} must declare an activation event for ${id}.`);
      }
    }
  }
}

function assertSearchCommands(manifest: ExtensionManifest): void {
  const searchCommands: unknown = manifest.searchCommands ?? [];
  if (!Array.isArray(searchCommands)) {
    throw new Error(`Extension ${manifest.id} must declare a valid searchable command list.`);
  }
  const seenIds = new Set<string>();
  for (const command of searchCommands) {
    if (!isRecord(command) || typeof command.id !== 'string' || !isNamespacedContributionId(manifest.id, command.id)) {
      throw new Error(`Extension ${manifest.id} declares an invalid searchable command.`);
    }
    if (!manifest.contributions.commands.includes(command.id)) {
      throw new Error(`Extension ${manifest.id} searches for undeclared command ${command.id}.`);
    }
    if (seenIds.has(command.id)) {
      throw new Error(`Extension ${manifest.id} declares searchable command ${command.id} more than once.`);
    }
    seenIds.add(command.id);
    if (!isRecord(command.translations) || !isRecord(command.translations.en)) {
      throw new Error(`Extension command ${command.id} must declare English search text.`);
    }
    const english = command.translations.en;
    if (
      typeof english.title !== 'string'
      || !english.title.trim()
      || english.title.length > 120
      || typeof english.description !== 'string'
      || english.description.length > 240
    ) {
      throw new Error(`Extension command ${command.id} has invalid English search text.`);
    }
    if (command.translations.zh !== undefined) {
      if (!isRecord(command.translations.zh)) {
        throw new Error(`Extension command ${command.id} has invalid Chinese search text.`);
      }
      const chinese = command.translations.zh;
      if (
        typeof chinese.title !== 'string'
        || !chinese.title.trim()
        || chinese.title.length > 120
        || typeof chinese.description !== 'string'
        || chinese.description.length > 240
      ) {
        throw new Error(`Extension command ${command.id} has invalid Chinese search text.`);
      }
    }
    if (
      !Array.isArray(command.keywords)
      || command.keywords.some(keyword => typeof keyword !== 'string' || keyword.length === 0 || keyword.length > 80)
    ) {
      throw new Error(`Extension command ${command.id} must declare searchable keywords.`);
    }
    if (
      typeof command.targetPath !== 'string'
      || !command.targetPath.startsWith('/')
      || command.targetPath.startsWith('//')
      || /[?#\\%\s]/.test(command.targetPath)
      || command.targetPath.split('/').some((segment, index) => index > 0 && (!segment || segment === '.' || segment === '..'))
      || !/^\/[a-z0-9/-]+$/.test(command.targetPath)
    ) {
      throw new Error(`Extension command ${command.id} must use a safe local target path.`);
    }
  }
}

function assertEntrypoints(manifest: ExtensionManifest): void {
  if (!isRecord(manifest.entrypoints)) {
    throw new Error(`Extension ${manifest.id} must declare platform entrypoints.`);
  }

  for (const platform of Object.keys(manifest.entrypoints)) {
    if (!supportedPlatforms.has(platform as ToolPlatform)) {
      throw new Error(`Extension ${manifest.id} declares an unsupported entrypoint platform.`);
    }
  }

  for (const platform of manifest.platforms) {
    const entrypoint = manifest.entrypoints[platform];
    if (
      typeof entrypoint !== 'string'
      || !entrypoint.startsWith('./')
      || entrypoint.includes('\\')
      || entrypoint.includes('?')
      || entrypoint.includes('#')
      || entrypoint.split('/').some(segment => segment === '..' || segment === '')
      || !/\.(?:[cm]?ts|mjs?)$/.test(entrypoint)
    ) {
      throw new Error(`Extension ${manifest.id} must provide a safe relative ${platform} entrypoint.`);
    }
  }
}

export function isNamespacedContributionId(pluginId: string, contributionId: string): boolean {
  const prefix = `${pluginId}/`;
  return contributionId.startsWith(prefix)
    && contributionId.slice(prefix.length).length > 0
    && contributionIdSuffixPattern.test(contributionId.slice(prefix.length));
}

/** Validate stable package metadata before a first-party loader can run. */
export function validateExtensionManifest(
  manifest: ExtensionManifest,
  hostApiVersion: string,
  platform: ToolPlatform,
): void {
  if (!isRecord(manifest) || typeof manifest.id !== 'string' || !extensionIdPattern.test(manifest.id)) {
    throw new Error(`Invalid extension ID: ${String(manifest?.id ?? '')}.`);
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 120) {
    throw new Error(`Extension ${manifest.id} must have a name of at most 120 characters.`);
  }

  parseStableVersion(manifest.version, `Extension ${manifest.id} version`);
  const hostVersion = parseStableVersion(hostApiVersion, 'Host API version');
  if (!isRecord(manifest.apiVersion)) {
    throw new Error(`Extension ${manifest.id} must declare an API compatibility range.`);
  }
  const minimum = parseStableVersion(manifest.apiVersion.minInclusive, `Extension ${manifest.id} API minimum`);
  const maximum = parseStableVersion(manifest.apiVersion.maxExclusive, `Extension ${manifest.id} API maximum`);
  if (compareVersions(minimum, maximum) >= 0) {
    throw new Error(`Extension ${manifest.id} declares an empty API compatibility range.`);
  }
  if (compareVersions(hostVersion, minimum) < 0 || compareVersions(hostVersion, maximum) >= 0) {
    throw new Error(`Extension ${manifest.id} does not support host API ${hostApiVersion}.`);
  }

  if (!Array.isArray(manifest.platforms) || manifest.platforms.length === 0 || new Set(manifest.platforms).size !== manifest.platforms.length) {
    throw new Error(`Extension ${manifest.id} must declare unique supported platforms.`);
  }
  if (manifest.platforms.some(candidate => !supportedPlatforms.has(candidate))) {
    throw new Error(`Extension ${manifest.id} declares an unsupported platform.`);
  }
  if (!manifest.platforms.includes(platform)) {
    throw new Error(`Extension ${manifest.id} does not support platform ${platform}.`);
  }

  assertEntrypoints(manifest);
  assertContributionIds(manifest);
  assertActivationEvents(manifest);
  assertSearchCommands(manifest);

  if (!Array.isArray(manifest.requestedCapabilities)) {
    throw new Error(`Extension ${manifest.id} must declare requested capabilities.`);
  }
  if (new Set(manifest.requestedCapabilities).size !== manifest.requestedCapabilities.length) {
    throw new Error(`Extension ${manifest.id} declares duplicate capabilities.`);
  }
  if (manifest.requestedCapabilities.some(capability => !knownCapabilities.has(capability))) {
    throw new Error(`Extension ${manifest.id} requests an unknown capability.`);
  }
}
