import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getExternalPluginV2PackageSigningPayload,
  parseExternalPluginV2PackageManifest,
  validateExternalPluginV2PackageManifest,
  type ExternalPluginV2UnsignedPackageManifest,
} from './plugin-package-v2';
import { stageExternalPluginV2PackageArchive } from './plugin-package';
import type { PluginPackageSigningKey } from './plugin-package-manifest';

const pluginId = 'org.example.json-tools';
const signingPair = generateKeyPairSync('ed25519');
const trustedSigningKeys = new Map<string, PluginPackageSigningKey>([
  ['test-key', { publicKey: signingPair.publicKey, allowedPluginIds: [pluginId] }],
]);

function createUnsignedManifest(overrides: Partial<ExternalPluginV2UnsignedPackageManifest> = {}): ExternalPluginV2UnsignedPackageManifest {
  return {
    formatVersion: 2,
    id: pluginId,
    name: 'JSON Tools',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    runtime: 'process',
    entrypoint: 'extension.mjs',
    requestedCapabilities: [],
    activationEvents: [
      `onTool:${pluginId}/summary`,
      `onCommand:${pluginId}/summarize`,
    ],
    contributions: {
      tools: [{
        id: `${pluginId}/summary`,
        title: 'JSON summary',
        description: 'Summarize a JSON document.',
        keywords: ['json', 'summary'],
        categoryId: 'development',
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: [],
        inputs: [{ id: 'input', kind: 'text', multiline: true, label: 'JSON input', required: true }],
        output: { kind: 'json' },
      }],
      commands: [{
        id: `${pluginId}/summarize`,
        title: 'Summarize JSON',
        description: 'Summarize a JSON document.',
        keywords: ['json'],
        toolId: `${pluginId}/summary`,
      }],
    },
    files: [
      { path: 'README.md', sha256: 'a'.repeat(64) },
      { path: 'extension.mjs', sha256: 'b'.repeat(64) },
    ],
    ...overrides,
  };
}

function signManifest(manifest: ExternalPluginV2UnsignedPackageManifest, privateKey: KeyObject = signingPair.privateKey): Record<string, unknown> {
  return {
    ...manifest,
    signature: {
      algorithm: 'Ed25519',
      keyId: 'test-key',
      value: sign(null, Buffer.from(getExternalPluginV2PackageSigningPayload(manifest), 'utf8'), privateKey).toString('base64'),
    },
  };
}

describe('external plugin v2 package manifest', () => {
  it('accepts a signed process package and preserves static contributions', () => {
    const manifest = validateExternalPluginV2PackageManifest(
      signManifest(createUnsignedManifest()),
      '2.0.0',
      trustedSigningKeys,
    );

    expect(manifest.runtime).toBe('process');
    expect(manifest.entrypoint).toBe('extension.mjs');
    expect(manifest.contributions.tools[0]?.id).toBe(`${pluginId}/summary`);
    expect(manifest.signature.algorithm).toBe('Ed25519');
  });

  it('parses bounded UTF-8 JSON and rejects an old v1 manifest', () => {
    const signed = signManifest(createUnsignedManifest());
    const parsed = parseExternalPluginV2PackageManifest(
      Buffer.from(JSON.stringify(signed), 'utf8'),
      '2.0.0',
      trustedSigningKeys,
    );
    expect(parsed.id).toBe(pluginId);

    expect(() => parseExternalPluginV2PackageManifest(
      Buffer.from(JSON.stringify({ formatVersion: 1 }), 'utf8'),
      '2.0.0',
      trustedSigningKeys,
    )).toThrow(/missing or unknown fields/);
  });

  it('rejects runtime and signature changes before installation', () => {
    const invalidRuntime = createUnsignedManifest({ runtime: 'process', entrypoint: 'extension.wasm' });
    expect(() => validateExternalPluginV2PackageManifest(
      signManifest(invalidRuntime),
      '2.0.0',
      trustedSigningKeys,
    )).toThrow(/entrypoint extension/);

    const signed = signManifest(createUnsignedManifest());
    signed.name = 'Tampered package';
    expect(() => validateExternalPluginV2PackageManifest(signed, '2.0.0', trustedSigningKeys))
      .toThrow(/signature is invalid/);
  });

  it('requires sorted file hashes and excludes plugin.json from package files', () => {
    const unsorted = createUnsignedManifest({
      files: [
        { path: 'extension.mjs', sha256: 'b'.repeat(64) },
        { path: 'README.md', sha256: 'a'.repeat(64) },
      ],
    });
    expect(() => validateExternalPluginV2PackageManifest(
      signManifest(unsorted),
      '2.0.0',
      trustedSigningKeys,
    )).toThrow(/sorted and unique/);

    const withManifestFile = createUnsignedManifest({
      files: [
        { path: 'extension.mjs', sha256: 'a'.repeat(64) },
        { path: 'plugin.json', sha256: 'b'.repeat(64) },
      ],
    });
    expect(() => validateExternalPluginV2PackageManifest(
      signManifest(withManifestFile),
      '2.0.0',
      trustedSigningKeys,
    )).toThrow(/file path is invalid/);
  });

  it('stages a signed v2 package without executing its process entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-plugin-v2-'));
    try {
      const source = 'export const activate = () => { throw new Error("must not run"); };';
      const manifest = createUnsignedManifest({
        files: [{ path: 'extension.mjs', sha256: createHash('sha256').update(source).digest('hex') }],
      });
      const archive = makeZip([
        { path: 'plugin.json', contents: JSON.stringify(signManifest(manifest)) },
        { path: 'extension.mjs', contents: source },
      ]);
      const archivePath = join(root, 'sample.itxs');
      await writeFile(archivePath, archive);

      const staged = await stageExternalPluginV2PackageArchive({
        archivePath,
        installRoot: join(root, 'installed'),
        hostApiVersion: '2.0.0',
        trustedSigningKeys,
      });
      expect(staged.manifest.runtime).toBe('process');
      await expect(readFile(join(staged.packageRoot, 'extension.mjs'), 'utf8')).resolves.toBe(source);
    }
    finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

interface ZipEntry {
  readonly path: string;
  readonly contents: string;
}

function makeZip(entries: readonly ZipEntry[]): Buffer {
  const records = entries.map(({ path, contents }) => {
    const name = Buffer.from(path, 'utf8');
    const body = Buffer.from(contents, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(crc32(body), 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, name, body]);
  });
  const central = entries.map(({ path, contents }, index) => {
    const name = Buffer.from(path, 'utf8');
    const body = Buffer.from(contents, 'utf8');
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE((3 << 8) | 20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt32LE(crc32(body), 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(body.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(entries.slice(0, index).reduce((total, entry) => total + 30 + Buffer.byteLength(entry.path) + Buffer.byteLength(entry.contents), 0), 42);
    return Buffer.concat([header, name]);
  });
  const localBytes = records.reduce((total, record) => total + record.length, 0);
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localBytes, 16);
  return Buffer.concat([...records, centralBytes, end]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
