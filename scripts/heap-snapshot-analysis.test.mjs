import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeHeapSnapshot } from './heap-snapshot-analysis.mjs';

test('finds strong retaining paths for newly retained objects and ignores weak edges', () => {
  const snapshot = {
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
        node_types: [['hidden', 'object', 'string']],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['property', 'element', 'weak']],
      },
    },
    nodes: [
      0, 0, 1, 0, 1,
      1, 1, 2, 8, 2,
      1, 2, 3, 32, 0,
      1, 3, 4, 16, 0,
    ],
    edges: [
      0, 4, 5,
      0, 5, 10,
      2, 6, 15,
    ],
    strings: ['(GC roots)', 'Window', 'TaskRecord', 'WeakOnly', 'window', 'task', 'weakTarget'],
  };

  const analysis = analyzeHeapSnapshot(snapshot, {
    baselineNodeIds: new Set([1, 2]),
  });

  assert.equal(analysis.nodeCount, 4);
  assert.equal(analysis.matchedBaselineNodeCount, 2);
  assert.equal(analysis.newlyRetainedNodeCount, 2);
  assert.deepEqual(analysis.newRetainedGroups.map(group => group.group), [
    'object:TaskRecord',
    'object:WeakOnly',
  ]);
  assert.deepEqual(analysis.retainerPaths[0]?.path, [
    { node: 'hidden:(GC roots)', via: null },
    { node: 'object:Window', via: 'property:window' },
    { node: 'object:TaskRecord', via: 'property:task' },
  ]);
  assert.equal(analysis.retainerPaths[1]?.reason, 'no-strong-path-from-gc-root');
});

test('rejects a heap snapshot with a truncated edge table', () => {
  const snapshot = {
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
        node_types: [['hidden', 'object']],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['property', 'weak']],
      },
    },
    nodes: [0, 0, 1, 0, 1],
    edges: [],
    strings: ['(GC roots)'],
  };

  assert.throws(() => analyzeHeapSnapshot(snapshot), /edge table is truncated/);
});
