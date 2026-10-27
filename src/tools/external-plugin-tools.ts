import type { ToolCapability, ToolDataProcessing, ToolOfflineSupport } from './tools.types';
import { isPluginCapabilityId } from '../shared/plugin-capabilities';
import { getExternalPluginToolRoute } from '../shared/plugin-tool-route';

type ExternalPluginSnapshotStatus = 'installed' | 'active' | 'invalid';

export interface ExternalPluginSnapshotLike {
  pluginId: string;
  version: string;
  status: ExternalPluginSnapshotStatus;
}

export interface ExternalPluginToolContributionLike {
  id: string;
  title: string;
  description: string;
  keywords: readonly string[];
  route: string;
  dataProcessing: ToolDataProcessing;
  offline: ToolOfflineSupport;
  capabilities: readonly ToolCapability[];
}

const dataProcessingPolicies = new Set<ToolDataProcessing>([
  'memory-only',
  'local-data',
  'user-selected-files',
  'network',
  'unspecified',
]);
const offlineSupportLevels = new Set<ToolOfflineSupport>([
  'available',
  'requires-network',
  'conditional',
  'unknown',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/** Rebuild and validate host-owned route metadata before it enters the tool registry. */
export function isExternalPluginToolContributionTrusted(
  plugin: Pick<ExternalPluginSnapshotLike, 'pluginId' | 'version'>,
  value: unknown,
): value is ExternalPluginToolContributionLike {
  if (!isRecord(value)) {
    return false;
  }
  const { id, title, description, keywords, route, dataProcessing, offline, capabilities } = value;
  if (
    typeof id !== 'string'
    || typeof title !== 'string'
    || typeof description !== 'string'
    || !title.trim()
    || !description.trim()
    || !isStringList(keywords)
    || !isStringList(capabilities)
    || typeof route !== 'string'
    || typeof dataProcessing !== 'string'
    || typeof offline !== 'string'
    || !dataProcessingPolicies.has(dataProcessing as ToolDataProcessing)
    || !offlineSupportLevels.has(offline as ToolOfflineSupport)
    || new Set(capabilities).size !== capabilities.length
    || capabilities.some(capability => !isPluginCapabilityId(capability))
  ) {
    return false;
  }

  try {
    return route === getExternalPluginToolRoute(plugin.pluginId, plugin.version, id);
  }
  catch {
    return false;
  }
}

function parseStableVersion(version: string): readonly [number, number, number] {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) {
    return [0, 0, 0];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return left.localeCompare(right);
}

function compareSnapshots(left: ExternalPluginSnapshotLike, right: ExternalPluginSnapshotLike): number {
  const leftActive = left.status === 'active' ? 1 : 0;
  const rightActive = right.status === 'active' ? 1 : 0;
  if (leftActive !== rightActive) {
    return rightActive - leftActive;
  }
  return compareVersions(right.version, left.version);
}

/** Keep one package version per plugin so rollback versions do not duplicate Home tools. */
export function selectExternalPluginSnapshots<T extends ExternalPluginSnapshotLike>(
  snapshots: readonly T[],
): T[] {
  const selected = new Map<string, T>();
  for (const snapshot of snapshots) {
    if (snapshot.status === 'invalid') {
      continue;
    }
    const previous = selected.get(snapshot.pluginId);
    if (!previous || compareSnapshots(snapshot, previous) < 0) {
      selected.set(snapshot.pluginId, snapshot);
    }
  }
  return [...selected.values()].sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}
