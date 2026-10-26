type ExternalPluginSnapshotStatus = 'installed' | 'active' | 'invalid';

export interface ExternalPluginSnapshotLike {
  pluginId: string;
  version: string;
  status: ExternalPluginSnapshotStatus;
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
