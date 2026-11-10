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
import { createStoredZip } from './test-helpers/wasm-module-fixtures';

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
      const archive = createStoredZip([
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

  it('rejects a changed v2 entry file before creating an installed package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-plugin-v2-hash-'));
    try {
      const signedSource = 'export const activate = () => undefined;';
      const manifest = createUnsignedManifest({
        files: [{
          path: 'extension.mjs',
          sha256: createHash('sha256').update(signedSource).digest('hex'),
        }],
      });
      const archivePath = join(root, 'tampered.itxs');
      await writeFile(archivePath, createStoredZip([
        { path: 'plugin.json', contents: JSON.stringify(signManifest(manifest)) },
        { path: 'extension.mjs', contents: 'export const activate = () => { throw new Error("tampered"); };' },
      ]));

      await expect(stageExternalPluginV2PackageArchive({
        archivePath,
        installRoot: join(root, 'installed'),
        hostApiVersion: '2.0.0',
        trustedSigningKeys,
      })).rejects.toMatchObject({ code: 'file-hash-mismatch' });
      await expect(readFile(join(root, 'installed', pluginId, '1.0.0', 'extension.mjs'), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    }
    finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an archive file that is not declared by the v2 manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-plugin-v2-files-'));
    try {
      const source = 'export const activate = () => undefined;';
      const manifest = createUnsignedManifest({
        files: [{ path: 'extension.mjs', sha256: createHash('sha256').update(source).digest('hex') }],
      });
      const archivePath = join(root, 'extra-file.itxs');
      await writeFile(archivePath, createStoredZip([
        { path: 'plugin.json', contents: JSON.stringify(signManifest(manifest)) },
        { path: 'extension.mjs', contents: source },
        { path: 'README.md', contents: 'not declared by the signed manifest' },
      ]));

      await expect(stageExternalPluginV2PackageArchive({
        archivePath,
        installRoot: join(root, 'installed'),
        hostApiVersion: '2.0.0',
        trustedSigningKeys,
      })).rejects.toMatchObject({ code: 'invalid-package' });
    }
    finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
