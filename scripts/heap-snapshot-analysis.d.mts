export interface HeapSnapshotInput {
  snapshot: {
    meta: {
      node_fields: string[];
      node_types: string[][];
      edge_fields: string[];
      edge_types: string[][];
    };
  };
  nodes: number[];
  edges: number[];
  strings: string[];
}

export interface RetainedHeapGroup {
  group: string;
  count: number;
  selfSizeBytes: number;
}

export interface HeapRetainerPath {
  group: string;
  path: Array<{ node: string; via: string | null }> | null;
  pathNodeCount?: number;
  pathTruncated?: boolean;
  reason?: string;
}

export interface HeapSnapshotAnalysis {
  nodeCount: number;
  selfSizeBytes: number;
  groups: Record<string, { count: number; selfSizeBytes: number }>;
  nodeIds: Set<number>;
  matchedBaselineNodeCount: number;
  newlyRetainedNodeCount: number;
  newRetainedGroups: RetainedHeapGroup[];
  retainerPaths: HeapRetainerPath[];
}

export function analyzeHeapSnapshot(
  snapshot: HeapSnapshotInput,
  options?: { baselineNodeIds?: ReadonlySet<number>; maximumRetainerPaths?: number },
): HeapSnapshotAnalysis;
