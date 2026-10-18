import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOuiArtifacts, createAdaptiveShards, normalizeOuiRecords } from './generate-oui-data.mjs';

test('validates registry prefixes and non-empty vendor names', () => {
  assert.deepEqual(normalizeOuiRecords({ FFFFFF: ' Example Vendor ' }, 6), { FFFFFF: ' Example Vendor ' });
  assert.throws(() => normalizeOuiRecords({ short: 'Vendor' }, 6), /Invalid 6-character OUI prefix/);
  assert.throws(() => normalizeOuiRecords({ FFFFFF: '' }, 6), /non-empty string/);
  assert.throws(() => normalizeOuiRecords([], 6), /JSON object/);
});

test('creates non-overlapping adaptive shards under a small test budget', () => {
  const records = Object.fromEntries(Array.from({ length: 48 }, (_, index) => [
    `${(index % 16).toString(16).toUpperCase()}${Math.floor(index / 16).toString(16).toUpperCase()}ABCD`,
    `Vendor ${index} with repeatable registry address text`,
  ]));
  const shards = createAdaptiveShards(records, { targetGzipBytes: 1, maxPrefixLength: 3 });

  assert(shards.length > 1);
  assert(shards.every(shard => shard.prefix.length <= 3));
  assert.equal(shards.reduce((count, shard) => count + Object.keys(shard.records).length, 0), Object.keys(records).length);
  for (let left = 0; left < shards.length; left++) {
    for (let right = left + 1; right < shards.length; right++) {
      assert(!shards[left].prefix.startsWith(shards[right].prefix));
      assert(!shards[right].prefix.startsWith(shards[left].prefix));
    }
  }
});

test('artifact names and manifest are deterministic and content addressed', () => {
  const records = { '203706': 'Example Vendor', '2037061': 'Example M Vendor', '203706123': 'Example S Vendor' };
  const first = buildOuiArtifacts(records, '1.2.0');
  const second = buildOuiArtifacts(records, '1.2.0');

  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(first.files.map(({ file, content }) => ({ file, content })), second.files.map(({ file, content }) => ({ file, content })));
  assert.equal(first.manifest.recordCount, 3);
  assert(first.manifest.shards.every(shard => shard.file.includes(shard.sha256.slice(0, 16))));
});
