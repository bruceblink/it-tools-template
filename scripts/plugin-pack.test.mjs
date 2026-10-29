import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildPluginPackage, generatePluginSigningKey, getPluginPackageSigningPayload, validatePluginSource } from './plugin-pack.mjs';
import { crc32 } from './stored-zip.mjs';

const require = createRequire(import.meta.url);
const yauzl = require('yauzl');
const packageScript = fileURLToPath(new URL('./plugin-pack.mjs', import.meta.url));
const sampleRoot = resolve('plugins/capability-demo');
const repositoryRoot = resolve('.');

test('calculates the standard ZIP CRC-32 known vector', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('builds a deterministic package that verifies with the documented Ed25519 format', async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'it-tools-plugin-pack-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const keyDirectory = join(temporaryRoot, 'keys');
  const generated = spawnSync(process.execPath, [
    packageScript,
    'keygen',
    '--key-id',
    'capability-demo-publisher',
    '--output-directory',
    keyDirectory,
  ], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  assert.match(generated.stdout, /Fingerprint: SHA256:(?:[A-F0-9]{2}:){31}[A-F0-9]{2}/);
  assert.doesNotMatch(generated.stdout, /BEGIN PRIVATE KEY/);

  const privateKey = await readFile(join(keyDirectory, 'capability-demo-publisher.private.pem'));
  const publicKeyBytes = await readFile(join(keyDirectory, 'capability-demo-publisher.public.pem'), 'utf8');
  const sourceDirectory = join(temporaryRoot, 'sample');
  await cp(sampleRoot, sourceDirectory, { recursive: true });
  const validated = await validatePluginSource({ sourceDirectory });
  assert.equal(validated.manifest.id, 'org.it-tools.capability-demo');
  assert.equal(validated.files.length, 3);
  assert.equal(validated.expandedBytes, validated.files.reduce((total, entry) => total + entry.contents.length, 0));
  const validatedCli = spawnSync(process.execPath, [
    packageScript,
    'validate',
    '--source',
    sourceDirectory,
  ], { encoding: 'utf8' });
  assert.equal(validatedCli.status, 0, validatedCli.stderr);
  assert.match(validatedCli.stdout, /Valid plugin source: org\.it-tools\.capability-demo 1\.0\.0 \(3 files, \d+ bytes\)/);
  const { archive, manifest } = await buildPluginPackage({
    sourceDirectory,
    signingKey: createPrivateKey(privateKey),
    keyId: 'capability-demo-publisher',
  });
  const repeatedBuild = await buildPluginPackage({
    sourceDirectory,
    signingKey: createPrivateKey(privateKey),
    keyId: 'capability-demo-publisher',
  });
  assert.deepEqual(repeatedBuild.archive, archive);
  assert.equal(archive.readUInt16LE(10), 0);
  assert.equal(archive.readUInt16LE(12), 0x0021);
  const centralDirectoryOffset = archive.readUInt32LE(archive.length - 22 + 16);
  assert.equal(archive.readUInt16LE(centralDirectoryOffset + 12), 0);
  assert.equal(archive.readUInt16LE(centralDirectoryOffset + 14), 0x0021);

  const publicKey = createPublicKey(publicKeyBytes);
  const { signature, ...unsignedManifest } = manifest;
  assert.equal(signature.algorithm, 'Ed25519');
  assert.equal(signature.keyId, 'capability-demo-publisher');
  assert.equal(verify(
    null,
    Buffer.from(getPluginPackageSigningPayload(unsignedManifest), 'utf8'),
    publicKey,
    Buffer.from(signature.value, 'base64'),
  ), true);
  const fingerprintHex = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .toUpperCase();
  assert.ok(generated.stdout.includes(`Fingerprint: SHA256:${fingerprintHex.match(/.{2}/g).join(':')}`));

  const cliOutputPath = join(temporaryRoot, 'capability-demo.itplugin');
  const packed = spawnSync(process.execPath, [
    packageScript,
    'pack',
    '--source',
    sourceDirectory,
    '--private-key',
    join(keyDirectory, 'capability-demo-publisher.private.pem'),
    '--key-id',
    'capability-demo-publisher',
    '--output',
    cliOutputPath,
  ], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  assert.deepEqual(await readFile(cliOutputPath), archive);

  const archiveEntries = await readZipEntries(archive);
  assert.deepEqual([...archiveEntries.keys()], [...archiveEntries.keys()].sort());
  assert.equal(archiveEntries.has('plugin.source.json'), false);
  assert.equal(archiveEntries.has('plugin.json'), true);
  const packageManifest = JSON.parse(archiveEntries.get('plugin.json').toString('utf8'));
  assert.equal(packageManifest.id, manifest.id);
  assert.deepEqual(packageManifest.contributions, {
    tools: [{
      id: 'org.it-tools.capability-demo/capability-demo',
      title: 'Capability demo',
      description: 'Review the capabilities and persistent settings granted to this plugin.',
      keywords: ['plugin', 'capability', 'settings'],
      dataProcessing: 'local-data',
      offline: 'available',
      capabilities: ['runtime.info'],
    }],
  });
  for (const file of manifest.files) {
    assert.equal(createHash('sha256').update(archiveEntries.get(file.path)).digest('hex'), file.sha256);
  }
});

test('rejects repository signing keys, private key material in sources, and package overwrite', async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'it-tools-plugin-pack-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const forbiddenKeyDirectory = join(repositoryRoot, `.plugin-key-test-${process.pid}`);
  const blockedKeygen = spawnSync(process.execPath, [
    packageScript,
    'keygen',
    '--key-id',
    'test-publisher',
    '--output-directory',
    forbiddenKeyDirectory,
  ], { encoding: 'utf8' });
  assert.notEqual(blockedKeygen.status, 0);
  assert.match(blockedKeygen.stderr, /outside the repository/);

  const keyDirectory = join(temporaryRoot, 'keys');
  const generated = await generatePluginSigningKey({ outputDirectory: keyDirectory, keyId: 'test-publisher' });
  const privateKey = await readFile(generated.privateKeyPath);
  const sourceDirectory = join(temporaryRoot, 'sample');
  await cp(sampleRoot, sourceDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, 'accidental.pem'), '-----BEGIN PRIVATE KEY----- test fixture marker');
  await assert.rejects(buildPluginPackage({
    sourceDirectory,
    signingKey: createPrivateKey(privateKey),
    keyId: generated.keyId,
  }), /private key material/);

  const cleanSourceDirectory = join(temporaryRoot, 'clean-sample');
  await cp(sampleRoot, cleanSourceDirectory, { recursive: true });
  const archivePath = join(temporaryRoot, 'capability-demo.itplugin');
  await writeFile(archivePath, 'preserve existing package');
  await assert.rejects((await import('./plugin-pack.mjs')).packPluginPackage({
    sourceDirectory: cleanSourceDirectory,
    privateKeyPath: generated.privateKeyPath,
    keyId: generated.keyId,
    outputPath: archivePath,
  }), /without overwriting/);
  assert.equal(await readFile(archivePath, 'utf8'), 'preserve existing package');
});

test('rejects an invalid plugin source manifest before writing an archive', async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'it-tools-plugin-pack-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const keyDirectory = join(temporaryRoot, 'keys');
  const generated = await generatePluginSigningKey({ outputDirectory: keyDirectory, keyId: 'test-publisher' });
  const privateKey = await readFile(generated.privateKeyPath);
  const sourceDirectory = join(temporaryRoot, 'sample');
  await cp(sampleRoot, sourceDirectory, { recursive: true });
  const manifestPath = join(sourceDirectory, 'plugin.source.json');
  const sourceManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  sourceManifest.requestedCapabilities = ['clipboard.erase'];
  await writeFile(manifestPath, JSON.stringify(sourceManifest));
  await assert.rejects(validatePluginSource({ sourceDirectory }), /requested plugin capability list/);
  const invalidCli = spawnSync(process.execPath, [
    packageScript,
    'validate',
    '--source',
    sourceDirectory,
  ], { encoding: 'utf8' });
  assert.notEqual(invalidCli.status, 0);
  assert.match(invalidCli.stderr, /requested plugin capability list/);
  await assert.rejects(buildPluginPackage({
    sourceDirectory,
    signingKey: createPrivateKey(privateKey),
    keyId: generated.keyId,
  }), /requested plugin capability list/);
});

test('rejects plugin source manifests that do not support the current host API', async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'it-tools-plugin-pack-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const keyDirectory = join(temporaryRoot, 'keys');
  const generated = await generatePluginSigningKey({ outputDirectory: keyDirectory, keyId: 'test-publisher' });
  const privateKey = await readFile(generated.privateKeyPath);
  const sourceDirectory = join(temporaryRoot, 'sample');
  await cp(sampleRoot, sourceDirectory, { recursive: true });
  const manifestPath = join(sourceDirectory, 'plugin.source.json');
  const sourceManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  sourceManifest.apiVersion = { minInclusive: '2.0.0', maxExclusive: '3.0.0' };
  await writeFile(manifestPath, JSON.stringify(sourceManifest));
  await assert.rejects(buildPluginPackage({
    sourceDirectory,
    signingKey: createPrivateKey(privateKey),
    keyId: generated.keyId,
  }), /does not support the current host API version/);
});

function readZipEntries(buffer) {
  return new Promise((resolveEntries, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError ?? new Error('The package archive could not be opened.'));
        return;
      }
      const entries = new Map();
      zipFile.on('error', reject);
      zipFile.on('end', () => resolveEntries(entries));
      zipFile.on('entry', (entry) => {
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            reject(streamError ?? new Error('The package entry stream could not be opened.'));
            return;
          }
          const chunks = [];
          stream.on('error', reject);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zipFile.readEntry();
          });
        });
      });
      zipFile.readEntry();
    });
  });
}
