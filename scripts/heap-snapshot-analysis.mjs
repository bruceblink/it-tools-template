const commonNodeTypes = new Set(['string', 'number', 'symbol', 'bigint', 'code']);

/** Summarize retained heap objects and find strong paths from V8's GC root. */
export function analyzeHeapSnapshot(snapshot, {
  baselineNodeIds,
  maximumRetainerPaths = 12,
} = {}) {
  const layout = readLayout(snapshot);
  const nodeCount = snapshot.nodes.length / layout.nodeFieldCount;
  const nodeIds = new Set();
  const groups = new Map();
  const newlyRetainedGroups = new Map();
  const edgeStarts = new Uint32Array(nodeCount);
  let edgeOffset = 0;
  let selfSizeBytes = 0;
  let matchedBaselineNodeCount = 0;
  let newlyRetainedNodeCount = 0;

  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const nodeOffset = nodeIndex * layout.nodeFieldCount;
    edgeStarts[nodeIndex] = edgeOffset;
    const type = layout.nodeTypes[snapshot.nodes[nodeOffset + layout.nodeTypeIndex]] ?? 'unknown';
    const name = snapshot.strings[snapshot.nodes[nodeOffset + layout.nodeNameIndex]] ?? 'unknown';
    const id = snapshot.nodes[nodeOffset + layout.nodeIdIndex];
    const size = snapshot.nodes[nodeOffset + layout.nodeSelfSizeIndex];
    const edgeCount = snapshot.nodes[nodeOffset + layout.nodeEdgeCountIndex];
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(size) || !Number.isSafeInteger(edgeCount) || edgeCount < 0) {
      throw new Error('The V8 heap snapshot contains an invalid node record.');
    }
    edgeOffset += edgeCount * layout.edgeFieldCount;
    if (edgeOffset > snapshot.edges.length) {
      throw new Error('The V8 heap snapshot edge table is truncated.');
    }

    const groupName = commonNodeTypes.has(type) ? type : `${type}:${name}`;
    const group = groups.get(groupName) ?? { count: 0, selfSizeBytes: 0 };
    group.count += 1;
    group.selfSizeBytes += size;
    groups.set(groupName, group);
    selfSizeBytes += size;

    if (nodeIds.has(id)) {
      throw new Error('The V8 heap snapshot contains a repeated node ID.');
    }
    nodeIds.add(id);

    if (baselineNodeIds?.has(id)) {
      matchedBaselineNodeCount += 1;
    }
    if (!baselineNodeIds || baselineNodeIds.has(id)) {
      continue;
    }
    newlyRetainedNodeCount += 1;
    const retainedGroup = newlyRetainedGroups.get(groupName) ?? {
      count: 0,
      selfSizeBytes: 0,
      representativeNodeIndex: nodeIndex,
      type,
      name,
    };
    retainedGroup.count += 1;
    retainedGroup.selfSizeBytes += size;
    newlyRetainedGroups.set(groupName, retainedGroup);
  }

  if (edgeOffset !== snapshot.edges.length) {
    throw new Error('The V8 heap snapshot edge table does not match its node records.');
  }

  const retainedGroups = [...newlyRetainedGroups.entries()]
    .map(([group, value]) => ({ group, ...value }))
    .sort((left, right) => right.selfSizeBytes - left.selfSizeBytes || right.count - left.count);
  const pathTargets = retainedGroups.slice(0, maximumRetainerPaths);
  const retainerPaths = findStrongRetainerPaths(snapshot, layout, edgeStarts, pathTargets);

  return {
    nodeCount,
    selfSizeBytes,
    groups: Object.fromEntries(groups),
    nodeIds,
    matchedBaselineNodeCount,
    newlyRetainedNodeCount,
    newRetainedGroups: retainedGroups.map(({ representativeNodeIndex: _index, type: _type, name: _name, ...group }) => group),
    retainerPaths,
  };
}

function readLayout(snapshot) {
  if (
    !snapshot
    || !Array.isArray(snapshot.nodes)
    || !Array.isArray(snapshot.edges)
    || !Array.isArray(snapshot.strings)
    || !snapshot.snapshot?.meta
  ) {
    throw new Error('The V8 heap snapshot data is incomplete.');
  }

  const nodeFields = snapshot.snapshot.meta.node_fields;
  const edgeFields = snapshot.snapshot.meta.edge_fields;
  const nodeTypeNames = snapshot.snapshot.meta.node_types;
  const edgeTypeNames = snapshot.snapshot.meta.edge_types;
  if (!Array.isArray(nodeFields) || !Array.isArray(edgeFields) || !Array.isArray(nodeTypeNames) || !Array.isArray(edgeTypeNames)) {
    throw new Error('The V8 heap snapshot metadata is incomplete.');
  }
  const nodeTypes = nodeTypeNames[nodeFields.indexOf('type')];
  const edgeTypes = edgeTypeNames[edgeFields.indexOf('type')];
  const nodeFieldCount = nodeFields.length;
  const edgeFieldCount = edgeFields.length;
  if (
    nodeFieldCount === 0
    || edgeFieldCount === 0
    || snapshot.nodes.length % nodeFieldCount !== 0
    || snapshot.edges.length % edgeFieldCount !== 0
    || !Array.isArray(nodeTypes)
    || !Array.isArray(edgeTypes)
  ) {
    throw new Error('The V8 heap snapshot has an unsupported field layout.');
  }

  const layout = {
    nodeFieldCount,
    edgeFieldCount,
    nodeTypeIndex: nodeFields.indexOf('type'),
    nodeNameIndex: nodeFields.indexOf('name'),
    nodeIdIndex: nodeFields.indexOf('id'),
    nodeSelfSizeIndex: nodeFields.indexOf('self_size'),
    nodeEdgeCountIndex: nodeFields.indexOf('edge_count'),
    edgeTypeIndex: edgeFields.indexOf('type'),
    edgeNameIndex: edgeFields.indexOf('name_or_index'),
    edgeTargetIndex: edgeFields.indexOf('to_node'),
    nodeTypes,
    edgeTypes,
  };
  if (Object.values(layout).some((value, index) => index < 10 && typeof value === 'number' && value < 0)) {
    throw new Error('The V8 heap snapshot is missing required node or edge fields.');
  }
  return layout;
}

/** Walk strong edges only so weak caches are not reported as ownership paths. */
function findStrongRetainerPaths(snapshot, layout, edgeStarts, targets) {
  if (targets.length === 0) {
    return [];
  }
  const nodeCount = snapshot.nodes.length / layout.nodeFieldCount;
  const parentNodes = new Int32Array(nodeCount);
  parentNodes.fill(-2);
  const parentEdges = new Int32Array(nodeCount);
  parentEdges.fill(-1);
  const queue = new Uint32Array(nodeCount);
  const targetGroups = new Map(targets.map(target => [target.representativeNodeIndex, target.group]));
  const foundTargets = new Set();
  let head = 0;
  let tail = 1;
  queue[0] = 0;
  parentNodes[0] = -1;

  while (head < tail && foundTargets.size < targetGroups.size) {
    const sourceNodeIndex = queue[head++];
    const sourceNodeOffset = sourceNodeIndex * layout.nodeFieldCount;
    const edgeCount = snapshot.nodes[sourceNodeOffset + layout.nodeEdgeCountIndex];
    const start = edgeStarts[sourceNodeIndex];
    for (let edgeOffset = start; edgeOffset < start + edgeCount * layout.edgeFieldCount; edgeOffset += layout.edgeFieldCount) {
      const edgeType = layout.edgeTypes[snapshot.edges[edgeOffset + layout.edgeTypeIndex]] ?? 'unknown';
      if (edgeType === 'weak') {
        continue;
      }
      const targetNodeOffset = snapshot.edges[edgeOffset + layout.edgeTargetIndex];
      if (
        !Number.isSafeInteger(targetNodeOffset)
        || targetNodeOffset < 0
        || targetNodeOffset % layout.nodeFieldCount !== 0
        || targetNodeOffset >= snapshot.nodes.length
      ) {
        throw new Error('The V8 heap snapshot contains an invalid edge target.');
      }
      const targetNodeIndex = targetNodeOffset / layout.nodeFieldCount;
      if (parentNodes[targetNodeIndex] !== -2) {
        continue;
      }
      parentNodes[targetNodeIndex] = sourceNodeIndex;
      parentEdges[targetNodeIndex] = edgeOffset;
      queue[tail++] = targetNodeIndex;
      if (targetGroups.has(targetNodeIndex)) {
        foundTargets.add(targetNodeIndex);
      }
    }
  }

  const paths = [];
  for (const target of targets) {
    if (!foundTargets.has(target.representativeNodeIndex)) {
      paths.push({ group: target.group, path: null, reason: 'no-strong-path-from-gc-root' });
      continue;
    }
    const reversePath = [];
    let nodeIndex = target.representativeNodeIndex;
    while (parentNodes[nodeIndex] !== -1) {
      const nodeOffset = nodeIndex * layout.nodeFieldCount;
      const type = layout.nodeTypes[snapshot.nodes[nodeOffset + layout.nodeTypeIndex]] ?? 'unknown';
      const rawName = snapshot.strings[snapshot.nodes[nodeOffset + layout.nodeNameIndex]] ?? 'unknown';
      const parentNodeIndex = parentNodes[nodeIndex];
      const edgeOffset = parentEdges[nodeIndex];
      reversePath.push({
        node: formatNodeName(type, rawName),
        via: formatEdgeName(snapshot, layout, edgeOffset),
      });
      nodeIndex = parentNodeIndex;
    }

    const rootOffset = nodeIndex * layout.nodeFieldCount;
    const rootType = layout.nodeTypes[snapshot.nodes[rootOffset + layout.nodeTypeIndex]] ?? 'unknown';
    const rootName = snapshot.strings[snapshot.nodes[rootOffset + layout.nodeNameIndex]] ?? 'unknown';
    const fullPath = [{ node: formatNodeName(rootType, rootName), via: null }, ...reversePath.reverse()];
    const maximumPathNodes = 20;
    const path = fullPath.length <= maximumPathNodes
      ? fullPath
      : [...fullPath.slice(0, 5), { node: '…', via: 'path-truncated' }, ...fullPath.slice(-(maximumPathNodes - 6))];
    paths.push({
      group: target.group,
      path,
      pathNodeCount: fullPath.length,
      pathTruncated: fullPath.length > maximumPathNodes,
    });
  }
  return paths;
}

function formatNodeName(type, name) {
  const safeName = type === 'string' ? '<string contents omitted>' : name.slice(0, 120);
  return `${type}:${safeName}`;
}

function formatEdgeName(snapshot, layout, edgeOffset) {
  const type = layout.edgeTypes[snapshot.edges[edgeOffset + layout.edgeTypeIndex]] ?? 'unknown';
  const nameOrIndex = snapshot.edges[edgeOffset + layout.edgeNameIndex];
  if (type === 'element') {
    return `${type}:${nameOrIndex}`;
  }
  const name = snapshot.strings[nameOrIndex];
  return `${type}:${typeof name === 'string' ? name.slice(0, 120) : nameOrIndex}`;
}
