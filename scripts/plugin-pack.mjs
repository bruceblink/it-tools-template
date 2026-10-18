#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { open, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStoredZip } from './stored-zip.mjs';

export const pluginPackageLimits = Object.freeze({
  maximumArchiveBytes: 64 * 1024 * 1024,
  maximumExpandedBytes: 128 * 1024 * 1024,
  maximumAssetBytes: 16 * 1024 * 1024,
  maximumManifestBytes: 1024 * 1024,
  maximumFiles: 512,
  maximumPathSegments: 32,
});

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const signatureDomain = 'IT Tools Electron Plugin Package v1';
const supportedHostApiVersion = '1.2.0';
const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const knownCapabilities = new Set([
  'clipboard.write',
  'data.oui',
  'device.camera',
  'file.read',
  'file.save',
  'runtime.info',
]);
const privateKeyMarker = /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/;
const maximumPrivateKeyBytes = 16 * 1024;
const maximumPluginSourceManifestBytes = 64 * 1024;

/** Generate the canonical payload shared with the Electron package verifier. */
export function getPluginPackageSigningPayload(manifest) {
  return `${signatureDomain}\n${canonicalJson(manifest)}`;
}

/** Build a bounded signed package from static files without executing package code. */
export async function buildPluginPackage({
  sourceDirectory,
  signingKey,
  keyId,
}) {
  assertKeyId(keyId);
  if (!signingKey || signingKey.type !== 'private' || signingKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('The package signer must be an Ed25519 private key.');
  }

  const packageRoot = await assertSourceRoot(sourceDirectory);
  const sourceManifestPath = resolve(packageRoot, 'plugin.source.json');
  const sourceManifestMetadata = await lstat(sourceManifestPath).catch(() => null);
  if (
    !sourceManifestMetadata
    || !sourceManifestMetadata.isFile()
    || sourceManifestMetadata.isSymbolicLink()
    || sourceManifestMetadata.nlink !== 1
    || sourceManifestMetadata.size > maximumPluginSourceManifestBytes
  ) {
    throw new Error('The plugin source manifest must be a bounded regular plugin.source.json file.');
  }

  const sourceManifest = parseSourceManifest(await readBoundedRegularFile(
    sourceManifestPath,
    maximumPluginSourceManifestBytes,
    'The plugin source manifest must be a bounded regular file.',
  ));
  const fileEntries = await collectPluginFiles(packageRoot);
  if (!fileEntries.some(entry => entry.path === sourceManifest.entrypoint)) {
    throw new Error('The configured plugin entrypoint is not present in the source directory.');
  }
  const fileManifest = fileEntries
    .map(entry => ({ path: entry.path, sha256: createHash('sha256').update(entry.contents).digest('hex') }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const unsignedManifest = {
    formatVersion: 1,
    id: sourceManifest.id,
    name: sourceManifest.name,
    version: sourceManifest.version,
    apiVersion: sourceManifest.apiVersion,
    entrypoint: sourceManifest.entrypoint,
    requestedCapabilities: sourceManifest.requestedCapabilities,
    files: fileManifest,
  };
  const signature = sign(
    null,
    Buffer.from(getPluginPackageSigningPayload(unsignedManifest), 'utf8'),
    signingKey,
  ).toString('base64');
  const manifest = {
    ...unsignedManifest,
    signature: { algorithm: 'Ed25519', keyId, value: signature },
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  if (manifestBytes.length > pluginPackageLimits.maximumManifestBytes) {
    throw new Error('The generated plugin manifest exceeds the 1 MiB package limit.');
  }

  const zipEntries = [
    ...fileEntries.map(entry => ({ path: entry.path, contents: entry.contents })),
    { path: 'plugin.json', contents: manifestBytes },
  ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const archive = createStoredZip(zipEntries);
  if (archive.length > pluginPackageLimits.maximumArchiveBytes) {
    throw new Error('The generated package exceeds the 64 MiB archive limit.');
  }
  return { archive, manifest };
}

/** Load a bounded external signing key, then write the package without replacing an existing file. */
export async function packPluginPackage({ sourceDirectory, privateKeyPath, keyId, outputPath }) {
  assertKeyId(keyId);
  const privatePath = await assertExternalPrivateKey(privateKeyPath);
  const appRealRoot = await realpath(repositoryRoot);
  if (isContainedPath(appRealRoot, privatePath)) {
    throw new Error('Keep plugin signing keys outside the repository.');
  }
  const keyMetadata = await lstat(privatePath);
  if (!keyMetadata.isFile() || keyMetadata.isSymbolicLink() || keyMetadata.nlink !== 1 || keyMetadata.size > maximumPrivateKeyBytes) {
    throw new Error('The signing key must be a bounded regular file outside the repository.');
  }
  let privateKey;
  try {
    privateKey = createPrivateKey(await readBoundedRegularFile(
      privatePath,
      maximumPrivateKeyBytes,
      'The signing key file exceeds 16 KiB.',
    ));
  }
  catch (error) {
    throw new Error('The signing key could not be read as a private key.', { cause: error });
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('The package signer must use Ed25519.');
  }

  const output = resolve(outputPath);
  if (extname(output).toLowerCase() !== '.itplugin') {
    throw new Error('The output filename must use the .itplugin extension.');
  }
  if (isContainedPath(await realpath(sourceDirectory), output)) {
    throw new Error('The output package must be outside the plugin source directory.');
  }
  const { archive, manifest } = await buildPluginPackage({ sourceDirectory, signingKey: privateKey, keyId });
  await writeExclusive(output, archive, 0o600);
  return { outputPath: output, pluginId: manifest.id, version: manifest.version, archiveBytes: archive.length };
}

/** Create a user-owned signing key pair in a directory outside the source repository. */
export async function generatePluginSigningKey({ outputDirectory, keyId, appRoot = repositoryRoot }) {
  assertKeyId(keyId);
  const appRealRoot = await realpath(appRoot);
  const output = resolve(outputDirectory);
  if (isContainedPath(appRealRoot, output)) {
    throw new Error('Store generated signing keys outside the repository.');
  }
  await mkdir(output, { recursive: true, mode: 0o700 });
  const realOutput = await realpath(output);
  if (isContainedPath(appRealRoot, realOutput)) {
    throw new Error('Store generated signing keys outside the repository.');
  }
  const privateKeyPath = resolve(realOutput, `${keyId}.private.pem`);
  const publicKeyPath = resolve(realOutput, `${keyId}.public.pem`);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateBytes = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const publicBytes = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }));
  let privateCreated = false;
  try {
    await writeExclusive(privateKeyPath, privateBytes, 0o600);
    privateCreated = true;
    await writeExclusive(publicKeyPath, publicBytes, 0o644);
  }
  catch (error) {
    if (privateCreated) {
      await rm(privateKeyPath, { force: true });
    }
    throw error;
  }
  const fingerprintHex = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').toUpperCase();
  const fingerprint = `SHA256:${fingerprintHex.match(/.{2}/g).join(':')}`;
  return { keyId, privateKeyPath, publicKeyPath, fingerprint };
}

async function assertSourceRoot(sourceDirectory) {
  const sourcePath = resolve(sourceDirectory);
  const sourceMetadata = await lstat(sourcePath);
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) {
    throw new Error('The plugin source must be a regular directory.');
  }
  return realpath(sourcePath);
}

async function collectPluginFiles(packageRoot) {
  const files = [];
  const lowerPaths = new Set();
  let expandedBytes = 0;

  async function visit(directory, segments) {
    if (segments.length > pluginPackageLimits.maximumPathSegments) {
      throw new Error('The plugin source exceeds the package path depth limit.');
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const entryPath = resolve(directory, entry.name);
      const entrySegments = [...segments, entry.name];
      const relativePath = entrySegments.join('/');
      if (relativePath.toLowerCase() === 'plugin.source.json') {
        if (relativePath !== 'plugin.source.json') {
          throw new Error('The plugin source manifest must use the exact plugin.source.json filename.');
        }
        continue;
      }
      if (relativePath.toLowerCase() === 'plugin.json') {
        throw new Error('The generated plugin.json name is reserved for the signed manifest.');
      }
      normalizePackagePath(relativePath);
      if (entry.isSymbolicLink()) {
        throw new Error('Plugin source directories cannot contain symbolic links.');
      }
      if (entry.isDirectory()) {
        await visit(entryPath, entrySegments);
        continue;
      }
      const metadata = await lstat(entryPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
        throw new Error('Plugin packages can contain only regular files without hard links.');
      }
      if (/^(?:\.env(?:\..*)?|[^/]+\.(?:key|p12|pfx))$/i.test(entry.name)) {
        throw new Error('Plugin source cannot include environment or private key files.');
      }
      const contents = await readBoundedRegularFile(
        entryPath,
        pluginPackageLimits.maximumAssetBytes,
        'A plugin source file exceeds the 16 MiB asset limit.',
      );
      expandedBytes += contents.length;
      if (expandedBytes > pluginPackageLimits.maximumExpandedBytes) {
        throw new Error('The plugin source exceeds the 128 MiB expanded package limit.');
      }
      if (privateKeyMarker.test(contents.toString('utf8'))) {
        throw new Error('A plugin source file appears to contain private key material.');
      }
      const lowerPath = relativePath.toLowerCase();
      if (lowerPaths.has(lowerPath)) {
        throw new Error('Plugin source paths must remain unique on case-insensitive file systems.');
      }
      lowerPaths.add(lowerPath);
      files.push({ path: relativePath, contents });
      if (files.length > pluginPackageLimits.maximumFiles) {
        throw new Error('The plugin source exceeds the 512 file limit.');
      }
    }
  }

  await visit(packageRoot, []);
  if (files.length === 0) {
    throw new Error('The plugin source does not contain any package files.');
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return files;
}

function parseSourceManifest(bytes) {
  if (bytes.length === 0 || bytes.length > maximumPluginSourceManifestBytes) {
    throw new Error('The plugin source manifest is empty or exceeds 64 KiB.');
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  catch (error) {
    throw new Error('The plugin source manifest must be valid UTF-8 JSON.', { cause: error });
  }
  assertExactKeys(value, ['formatVersion', 'id', 'name', 'version', 'apiVersion', 'entrypoint', 'requestedCapabilities']);
  if (value.formatVersion !== 1 || typeof value.id !== 'string' || !pluginIdPattern.test(value.id) || value.id.length > 128) {
    throw new Error('The plugin source format version or ID is invalid.');
  }
  if (typeof value.name !== 'string' || value.name.trim() === '' || value.name.length > 120) {
    throw new Error('The plugin source name is invalid.');
  }
  parseStableVersion(value.version, 'Plugin version');
  assertExactKeys(value.apiVersion, ['minInclusive', 'maxExclusive']);
  const minimum = parseStableVersion(value.apiVersion.minInclusive, 'Plugin API minimum');
  const maximum = parseStableVersion(value.apiVersion.maxExclusive, 'Plugin API maximum');
  if (compareVersions(minimum, maximum) >= 0) {
    throw new Error('The plugin API compatibility range is empty.');
  }
  const hostApiVersion = parseStableVersion(supportedHostApiVersion, 'Current host API version');
  if (compareVersions(hostApiVersion, minimum) < 0 || compareVersions(hostApiVersion, maximum) >= 0) {
    throw new Error(`The plugin does not support the current host API version ${supportedHostApiVersion}.`);
  }
  if (typeof value.entrypoint !== 'string') {
    throw new Error('The plugin entrypoint must be a package path.');
  }
  normalizePackagePath(value.entrypoint);
  if (!value.entrypoint.toLowerCase().endsWith('.html')) {
    throw new Error('The plugin entrypoint must be an HTML file.');
  }
  if (
    !Array.isArray(value.requestedCapabilities)
    || value.requestedCapabilities.some(capability => typeof capability !== 'string')
    || new Set(value.requestedCapabilities).size !== value.requestedCapabilities.length
    || value.requestedCapabilities.some(capability => !knownCapabilities.has(capability))
  ) {
    throw new Error('The requested plugin capability list is invalid.');
  }
  return {
    formatVersion: 1,
    id: value.id,
    name: value.name.trim(),
    version: value.version,
    apiVersion: { minInclusive: value.apiVersion.minInclusive, maxExclusive: value.apiVersion.maxExclusive },
    entrypoint: value.entrypoint,
    requestedCapabilities: [...value.requestedCapabilities],
  };
}

function normalizePackagePath(path) {
  if (
    path.length === 0
    || path.length > 1024
    || path.includes('\0')
    || path.includes('\\')
    || path.includes(':')
    || path.includes('%')
    || path.includes('?')
    || path.includes('#')
    || path.startsWith('/')
    || path.normalize('NFC') !== path
  ) {
    throw new Error('The plugin source contains an unsafe package path.');
  }
  const segments = path.split('/');
  if (segments.some(segment => (
    segment === ''
    || segment === '.'
    || segment === '..'
    || segment.length > 255
    || segment.endsWith('.')
    || segment.endsWith(' ')
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
    || [...segment].some(character => character.charCodeAt(0) < 0x20)
  )) || segments.length > pluginPackageLimits.maximumPathSegments) {
    throw new Error('The plugin source contains an unsafe package path.');
  }
  return path;
}

async function assertExternalPrivateKey(privateKeyPath) {
  const absolutePath = resolve(privateKeyPath);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error('The signing key path must name a regular file without links.');
  }
  return realpath(absolutePath);
}

/** Read a regular file incrementally so a source file that grows during packing stays bounded. */
async function readBoundedRegularFile(path, maximumBytes, errorMessage) {
  let handle;
  try {
    handle = await open(path, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > maximumBytes) {
      throw new Error(errorMessage);
    }
    const stream = handle.createReadStream({ autoClose: false });
    const chunks = [];
    let bytesRead = 0;
    for await (const chunk of stream) {
      bytesRead += chunk.length;
      if (bytesRead > maximumBytes) {
        stream.destroy();
        throw new Error(errorMessage);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, bytesRead);
  }
  finally {
    await handle?.close();
  }
}

async function writeExclusive(path, contents, mode) {
  await mkdir(dirname(path), { recursive: true });
  let handle;
  let created = false;
  try {
    handle = await open(path, 'wx', mode);
    created = true;
    await handle.writeFile(contents);
    await handle.sync();
  }
  catch (error) {
    if (created) {
      await handle?.close();
      handle = undefined;
      try {
        await rm(path, { force: true });
      }
      catch (cleanupError) {
        throw new Error('The output failed and its incomplete file could not be removed.', {
          cause: new AggregateError([error, cleanupError]),
        });
      }
    }
    throw new Error('The output file could not be created without overwriting an existing file.', { cause: error });
  }
  finally {
    await handle?.close();
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const fields = Object.keys(value).sort().map((key) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error('The plugin manifest contains a reserved JSON key.');
      }
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    });
    return `{${fields.join(',')}}`;
  }
  throw new Error('The plugin manifest contains an unsupported JSON value.');
}

function assertExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A plugin manifest object has an invalid shape.');
  }
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) {
    throw new Error('A plugin manifest object has missing or unknown fields.');
  }
}

function parseStableVersion(version, label) {
  if (typeof version !== 'string') {
    throw new Error(`${label} must use MAJOR.MINOR.PATCH format.`);
  }
  const match = stableVersionPattern.exec(version);
  if (!match) {
    throw new Error(`${label} must use MAJOR.MINOR.PATCH format.`);
  }
  const parts = match.slice(1).map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) {
    throw new Error(`${label} contains an unsafe numeric component.`);
  }
  return parts;
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function assertKeyId(keyId) {
  if (typeof keyId !== 'string' || !keyIdPattern.test(keyId)) {
    throw new Error('The signer key ID is invalid.');
  }
}

function isContainedPath(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
}

function parseFlags(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--') || flag in result) {
      throw new Error('Plugin package commands require unique --name value arguments.');
    }
    result[flag.slice(2)] = value;
    index += 1;
  }
  return result;
}

function assertFlags(flags, required) {
  if (Object.keys(flags).length !== required.length || required.some(name => !flags[name])) {
    throw new Error(`Expected exactly these arguments: ${required.map(name => `--${name}`).join(' ')}`);
  }
}

async function runCli(argv) {
  const [command, ...arguments_] = argv;
  if (command === '--help' || command === 'help' || command === undefined || arguments_.join('') === '--help') {
    process.stdout.write(getUsage());
    return;
  }

  const flags = parseFlags(arguments_);
  if (command === 'keygen') {
    assertFlags(flags, ['key-id', 'output-directory']);
    const result = await generatePluginSigningKey({ keyId: flags['key-id'], outputDirectory: flags['output-directory'] });
    process.stdout.write([
      `Signer key ID: ${result.keyId}`,
      `Private key file: ${result.privateKeyPath}`,
      `Public key file: ${result.publicKeyPath}`,
      `Fingerprint: ${result.fingerprint}`,
      'Register only the public key and keep a protected offline backup of the private key.',
      '',
    ].join('\n'));
    return;
  }
  if (command === 'pack') {
    assertFlags(flags, ['source', 'private-key', 'key-id', 'output']);
    const result = await packPluginPackage({
      sourceDirectory: flags.source,
      privateKeyPath: flags['private-key'],
      keyId: flags['key-id'],
      outputPath: flags.output,
    });
    process.stdout.write(`Signed ${result.pluginId} ${result.version} (${result.archiveBytes} bytes): ${result.outputPath}\n`);
    return;
  }
  throw new Error('Unknown plugin package command. Run `pnpm run plugin:pack -- --help` for usage.');
}

function getUsage() {
  return [
    'IT Tools signed Electron plugin package commands',
    '  pnpm run plugin:keygen -- --key-id <publisher> --output-directory <outside-repo-directory>',
    '  pnpm run plugin:pack -- --source <plugin-directory> --private-key <external.pem> --key-id <publisher> --output <package.itplugin>',
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Plugin package creation failed.'}\n`);
    process.exitCode = 1;
  });
}
