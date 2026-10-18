import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const dataDirectory = resolve(scriptDirectory, '../node_modules/oui-data');
const outputDirectory = resolve(scriptDirectory, '../public/assets/oui-data');
const licensePath = resolve(scriptDirectory, '../docs/licenses/oui-data-BSD-2-Clause.txt');

export const DEFAULT_SHARD_GZIP_TARGET_BYTES = 200 * 1024;
export const DEFAULT_MAX_PREFIX_LENGTH = 3;

/** Validate one registry file and return normalized, sorted records. */
export function normalizeOuiRecords(value, expectedPrefixLength) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('OUI registry data must be a JSON object.');
  }

  const records = {};
  for (const [prefix, vendor] of Object.entries(value)) {
    if (!new RegExp(`^[0-9A-F]{${expectedPrefixLength}}$`).test(prefix)) {
      throw new Error(`Invalid ${expectedPrefixLength}-character OUI prefix: ${prefix}`);
    }
    if (typeof vendor !== 'string' || vendor.trim() === '') {
      throw new Error(`OUI vendor value must be a non-empty string: ${prefix}`);
    }
    records[prefix] = vendor;
  }
  return Object.fromEntries(Object.entries(records).sort(([left], [right]) => left.localeCompare(right)));
}

function serializeRecords(records) {
  return `${JSON.stringify(Object.fromEntries(Object.entries(records).sort(([left], [right]) => left.localeCompare(right))))}\n`;
}

/** Split data by the shortest leading hex prefix that stays near the gzip target. */
export function createAdaptiveShards(records, {
  targetGzipBytes = DEFAULT_SHARD_GZIP_TARGET_BYTES,
  maxPrefixLength = DEFAULT_MAX_PREFIX_LENGTH,
} = {}) {
  if (!Number.isInteger(targetGzipBytes) || targetGzipBytes < 1) {
    throw new RangeError('Shard gzip target must be a positive integer.');
  }
  if (!Number.isInteger(maxPrefixLength) || maxPrefixLength < 1 || maxPrefixLength > 3) {
    throw new RangeError('Maximum shard prefix length must be between 1 and 3.');
  }

  const entries = Object.entries(records);
  if (entries.some(([prefix]) => !/^[0-9A-F]{6}(?:[0-9A-F]|[0-9A-F]{3})?$/.test(prefix))) {
    throw new Error('Shard records must use six, seven, or nine uppercase hexadecimal characters.');
  }

  const shards = [];
  function split(prefix, shardEntries) {
    if (shardEntries.length === 0) {
      return;
    }
    const shardRecords = Object.fromEntries(shardEntries);
    const content = serializeRecords(shardRecords);
    const gzipBytes = gzipSync(content).byteLength;
    if (gzipBytes <= targetGzipBytes || prefix.length === maxPrefixLength || shardEntries.length === 1) {
      shards.push({ prefix, records: shardRecords, content, gzipBytes });
      return;
    }

    const groups = new Map();
    for (const entry of shardEntries) {
      const childPrefix = entry[0].slice(0, prefix.length + 1);
      const group = groups.get(childPrefix) ?? [];
      group.push(entry);
      groups.set(childPrefix, group);
    }
    for (const [childPrefix, group] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
      split(childPrefix, group);
    }
  }

  const roots = new Map();
  for (const entry of entries) {
    const root = entry[0][0];
    const group = roots.get(root) ?? [];
    group.push(entry);
    roots.set(root, group);
  }
  for (const [prefix, group] of [...roots].sort(([left], [right]) => left.localeCompare(right))) {
    split(prefix, group);
  }
  return shards;
}

/** Build deterministic content-addressed shard files and a small runtime index. */
export function buildOuiArtifacts(records, dataVersion, options = {}) {
  const shards = createAdaptiveShards(records, options);
  const files = shards.map(({ prefix, content, records: shardRecords, gzipBytes }) => {
    const sha256 = createHash('sha256').update(content).digest('hex');
    return {
      prefix,
      file: `oui-${prefix}-${sha256.slice(0, 16)}.json`,
      sha256,
      recordCount: Object.keys(shardRecords).length,
      rawBytes: Buffer.byteLength(content),
      gzipBytes,
      content,
    };
  });
  return {
    files,
    manifest: {
      schemaVersion: 1,
      dataVersion,
      recordCount: Object.keys(records).length,
      shards: files.map(({ prefix, file, sha256, recordCount, rawBytes, gzipBytes }) => ({
        prefix,
        file,
        sha256,
        recordCount,
        rawBytes,
        gzipBytes,
      })),
    },
  };
}

async function readRegistryFile(file, prefixLength) {
  return normalizeOuiRecords(JSON.parse(await readFile(resolve(dataDirectory, file), 'utf8')), prefixLength);
}

async function main() {
  const packageInfo = JSON.parse(await readFile(resolve(dataDirectory, 'package.json'), 'utf8'));
  if (packageInfo.name !== 'oui-data' || packageInfo.license !== 'BSD-2-Clause') {
    throw new Error('Expected oui-data with a BSD-2-Clause license.');
  }

  const registries = await Promise.all([
    readRegistryFile('index.json', 6),
    readRegistryFile('index-m.json', 7),
    readRegistryFile('index-s.json', 9),
  ]);
  const records = Object.assign({}, ...registries);
  const artifacts = buildOuiArtifacts(records, packageInfo.version);
  const generatedFiles = new Set(artifacts.files.map(file => file.file));
  await mkdir(outputDirectory, { recursive: true });

  for (const file of artifacts.files) {
    await writeFile(resolve(outputDirectory, file.file), file.content, 'utf8');
  }
  await writeFile(resolve(outputDirectory, 'LICENSE-ouidata.txt'), await readFile(licensePath));
  await writeFile(resolve(outputDirectory, 'manifest.json'), `${JSON.stringify(artifacts.manifest, null, 2)}\n`, 'utf8');

  // Remove only files created by this generator; keep unknown files in the output directory.
  for (const entry of await readdir(outputDirectory, { withFileTypes: true })) {
    if (entry.isFile() && /^oui-[0-9A-F]{1,3}-[a-f0-9]{16}\.json$/.test(entry.name) && !generatedFiles.has(entry.name)) {
      await rm(resolve(outputDirectory, entry.name));
    }
  }

  const largestShard = Math.max(...artifacts.manifest.shards.map(shard => shard.gzipBytes));
  console.log(`[OUI] ${artifacts.manifest.recordCount} records in ${artifacts.manifest.shards.length} shards; largest gzip shard ${(largestShard / 1024).toFixed(2)} KiB.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
