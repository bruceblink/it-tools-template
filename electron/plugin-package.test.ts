import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getPluginPackageSigningPayload,
  PluginPackageError,
  stagePluginPackageArchive,
  type PluginPackageFile,
  type PluginPackageUnsignedManifest,
  type PluginPackageSigningKey,
} from './plugin-package';

interface ZipFixtureEntry {
  path: string;
  contents: Buffer | string;
  mode?: number;
  compression?: 0 | 8;
}

interface SignedArchiveOptions {
  signedFiles?: Record<string, string>;
  archivedFiles?: Record<string, string>;
  apiVersion?: PluginPackageUnsignedManifest['apiVersion'];
  signingKey?: KeyObject;
  compressedFiles?: ReadonlySet<string>;
}

const temporaryDirectories: string[] = [];
const signingPair = generateKeyPairSync('ed25519');
const otherSigningPair = generateKeyPairSync('ed25519');
const trustedKey: PluginPackageSigningKey = {
  publicKey: signingPair.publicKey,
  allowedPluginIds: ['org.example.sandbox'],
};
const trustedSigningKeys = new Map([['test-key', trustedKey]]);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('Electron plugin package staging', () => {
  it('verifies the signed manifest and every file before atomically staging prebuilt assets', async () => {
    const root = await createTemporaryDirectory();
    const archivePath = join(root, 'sample.itplugin');
    const files = {
      'index.html': '<!doctype html><main>Safe plugin</main>',
      'install.js': 'globalThis.__pluginInstallScriptRan = true; throw new Error("must not run");',
      'package.json': JSON.stringify({ scripts: { postinstall: 'node install.js' } }),
    };
    await writeFile(archivePath, makeSignedArchive({ signedFiles: files }));

    const result = await stagePluginPackageArchive({
      archivePath,
      installRoot: join(root, 'installed'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    });

    expect(result.manifest.id).toBe('org.example.sandbox');
    expect(result.manifest.requestedCapabilities).toEqual([]);
    expect(await readFile(join(result.packageRoot, 'index.html'), 'utf8')).toContain('Safe plugin');
    expect(await readFile(join(result.packageRoot, 'plugin.json'), 'utf8')).toContain('org.example.sandbox');
    expect((globalThis as Record<string, unknown>).__pluginInstallScriptRan).toBeUndefined();
    expect(result.expandedBytes).toBeGreaterThan(Buffer.byteLength(files['index.html']!));
  });

  it('rejects a changed file and removes the incomplete staging directory', async () => {
    const root = await createTemporaryDirectory();
    const archivePath = join(root, 'tampered.itplugin');
    await writeFile(archivePath, makeSignedArchive({
      signedFiles: { 'index.html': '<main>Signed content</main>' },
      archivedFiles: { 'index.html': '<main>Changed content</main>' },
    }));

    await expect(stagePluginPackageArchive({
      archivePath,
      installRoot: join(root, 'installed'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'file-hash-mismatch' });

    const installRoot = join(root, 'installed');
    await expect(readdir(installRoot)).resolves.toEqual([]);
  });

  it('rejects files that are not covered by the signed manifest', async () => {
    const root = await createTemporaryDirectory();
    const archivePath = join(root, 'unlisted.itplugin');
    await writeFile(archivePath, makeSignedArchive({
      signedFiles: { 'index.html': '<main>Signed</main>' },
      archivedFiles: {
        'index.html': '<main>Signed</main>',
        'extra.js': 'globalThis.extra = true;',
      },
    }));

    await expect(stagePluginPackageArchive({
      archivePath,
      installRoot: join(root, 'installed'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'invalid-package' });
  });

  it('rejects untrusted signing keys and incompatible host API versions', async () => {
    const root = await createTemporaryDirectory();
    const untrustedArchivePath = join(root, 'untrusted.itplugin');
    await writeFile(untrustedArchivePath, makeSignedArchive());

    await expect(stagePluginPackageArchive({
      archivePath: untrustedArchivePath,
      installRoot: join(root, 'untrusted'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys: new Map(),
    })).rejects.toMatchObject({ code: 'untrusted-signature' });

    const invalidSignaturePath = join(root, 'invalid-signature.itplugin');
    await writeFile(invalidSignaturePath, makeSignedArchive({ signingKey: otherSigningPair.privateKey }));
    await expect(stagePluginPackageArchive({
      archivePath: invalidSignaturePath,
      installRoot: join(root, 'invalid-signature'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'untrusted-signature' });

    const incompatibleArchivePath = join(root, 'incompatible.itplugin');
    await writeFile(incompatibleArchivePath, makeSignedArchive({
      apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    }));
    await expect(stagePluginPackageArchive({
      archivePath: incompatibleArchivePath,
      installRoot: join(root, 'incompatible'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'invalid-package' });
  });

  it('rejects traversal paths, symlinks, duplicate entries and case collisions', async () => {
    const root = await createTemporaryDirectory();
    const traversalPath = join(root, 'traversal.itplugin');
    await writeFile(traversalPath, makeZip([
      { path: 'plugin.json', contents: '{}' },
      { path: '../escape.txt', contents: 'outside' },
    ]));
    await expect(stagePluginPackageArchive({
      archivePath: traversalPath,
      installRoot: join(root, 'traversal-install'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toBeInstanceOf(PluginPackageError);

    const symlinkPath = join(root, 'symlink.itplugin');
    await writeFile(symlinkPath, makeZip([
      { path: 'plugin.json', contents: '{}' },
      { path: 'assets/escape.js', contents: '../outside.js', mode: 0o120777 },
    ]));
    await expect(stagePluginPackageArchive({
      archivePath: symlinkPath,
      installRoot: join(root, 'symlink-install'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'unsafe-archive-entry' });

    const duplicatePath = join(root, 'duplicate.itplugin');
    await writeFile(duplicatePath, makeZip([
      { path: 'plugin.json', contents: '{}' },
      { path: 'index.html', contents: 'first' },
      { path: 'index.html', contents: 'second' },
    ]));
    await expect(stagePluginPackageArchive({
      archivePath: duplicatePath,
      installRoot: join(root, 'duplicate-install'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'unsafe-archive-entry' });

    const collisionPath = join(root, 'case-collision.itplugin');
    await writeFile(collisionPath, makeZip([
      { path: 'plugin.json', contents: '{}' },
      { path: 'assets/Logo.svg', contents: 'one' },
      { path: 'assets/logo.svg', contents: 'two' },
    ]));
    await expect(stagePluginPackageArchive({
      archivePath: collisionPath,
      installRoot: join(root, 'collision-install'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'unsafe-archive-entry' });

    const windowsPath = join(root, 'windows-path.itplugin');
    await writeFile(windowsPath, makeZip([
      { path: 'plugin.json', contents: '{}' },
      { path: 'CON.txt', contents: 'reserved' },
    ]));
    await expect(stagePluginPackageArchive({
      archivePath: windowsPath,
      installRoot: join(root, 'windows-path-install'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'unsafe-archive-entry' });

    const fileDirectoryConflictPath = join(root, 'file-directory-conflict.itplugin');
    await writeFile(fileDirectoryConflictPath, makeZip([
      { path: 'plugin.json', contents: '{}' },
      { path: 'assets', contents: 'file' },
      { path: 'assets/icon.svg', contents: '<svg />' },
    ]));
    await expect(stagePluginPackageArchive({
      archivePath: fileDirectoryConflictPath,
      installRoot: join(root, 'file-directory-conflict-install'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'unsafe-archive-entry' });
  });

  it('rejects compression bombs and does not overwrite an installed version', async () => {
    const root = await createTemporaryDirectory();
    const largeArchivePath = join(root, 'large.itplugin');
    const largePayload = 'A'.repeat(2 * 1024 * 1024);
    await writeFile(largeArchivePath, makeSignedArchive({
      signedFiles: { 'index.html': '<main />', 'large.txt': largePayload },
      compressedFiles: new Set(['large.txt']),
    }));
    await expect(stagePluginPackageArchive({
      archivePath: largeArchivePath,
      installRoot: join(root, 'large-install'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'resource-limit' });

    const validArchivePath = join(root, 'valid.itplugin');
    await writeFile(validArchivePath, makeSignedArchive());
    const installRoot = join(root, 'valid-install');
    const first = await stagePluginPackageArchive({
      archivePath: validArchivePath,
      installRoot,
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    });
    await expect(stagePluginPackageArchive({
      archivePath: validArchivePath,
      installRoot,
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'already-installed' });
    await expect(readFile(join(first.packageRoot, 'index.html'), 'utf8')).resolves.toContain('Safe plugin');
  });

  it('rejects archives above the compressed size limit before parsing them', async () => {
    const root = await createTemporaryDirectory();
    const archivePath = join(root, 'oversized.itplugin');
    await writeFile(archivePath, Buffer.alloc(64 * 1024 * 1024 + 1));
    await expect(stagePluginPackageArchive({
      archivePath,
      installRoot: join(root, 'installed'),
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'resource-limit' });
  });

  it('refuses plugin install directories that are symlinks outside the install root', async () => {
    const root = await createTemporaryDirectory();
    const archivePath = join(root, 'sample.itplugin');
    const installRoot = join(root, 'installed');
    const outsideDirectory = join(root, 'outside');
    await writeFile(archivePath, makeSignedArchive());
    await mkdir(installRoot);
    await mkdir(outsideDirectory);
    await symlink(outsideDirectory, join(installRoot, 'org.example.sandbox'), 'dir');

    await expect(stagePluginPackageArchive({
      archivePath,
      installRoot,
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'unsafe-archive-entry' });
    await expect(readdir(outsideDirectory)).resolves.toEqual([]);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-package-'));
  temporaryDirectories.push(directory);
  return directory;
}

function makeSignedArchive(options: SignedArchiveOptions = {}): Buffer {
  const signedFiles = options.signedFiles ?? { 'index.html': '<!doctype html><main>Safe plugin</main>' };
  const archivedFiles = options.archivedFiles ?? signedFiles;
  const files: PluginPackageFile[] = Object.entries(signedFiles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, contents]) => ({
      path,
      sha256: createHash('sha256').update(contents).digest('hex'),
    }));
  const unsignedManifest: PluginPackageUnsignedManifest = {
    formatVersion: 1,
    id: 'org.example.sandbox',
    name: 'Sandbox fixture',
    version: '1.0.0',
    apiVersion: options.apiVersion ?? { minInclusive: '1.0.0', maxExclusive: '2.0.0' },
    entrypoint: 'index.html',
    requestedCapabilities: [],
    files,
  };
  const signature = sign(
    null,
    Buffer.from(getPluginPackageSigningPayload(unsignedManifest), 'utf8'),
    options.signingKey ?? signingPair.privateKey,
  ).toString('base64');
  const manifest = {
    ...unsignedManifest,
    signature: { algorithm: 'Ed25519', keyId: 'test-key', value: signature },
  };
  const archiveEntries: ZipFixtureEntry[] = [
    { path: 'plugin.json', contents: JSON.stringify(manifest) },
    ...Object.entries(archivedFiles).map(([path, contents]) => ({
      path,
      contents,
      ...(options.compressedFiles?.has(path) ? { compression: 8 as const } : {}),
    })),
  ];
  return makeZip(archiveEntries);
}

function makeZip(entries: readonly ZipFixtureEntry[]): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const contents = Buffer.isBuffer(entry.contents) ? entry.contents : Buffer.from(entry.contents, 'utf8');
    const method = entry.compression ?? 0;
    const compressed = method === 8 ? deflateRawSync(contents) : contents;
    const crc = crc32(contents);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([localHeader, name, compressed]);
    localRecords.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(((entry.mode ?? 0o100644) * 0x10000) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    const centralRecord = Buffer.concat([centralHeader, name]);
    centralRecords.push(centralRecord);
    localOffset += localRecord.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
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
