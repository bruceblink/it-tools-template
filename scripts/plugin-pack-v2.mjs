#!/usr/bin/env node
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { open, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStoredZip } from './stored-zip.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const signatureDomain = 'IT Tools Electron Plugin Package v2';
const supportedHostApiVersion = '2.0.0';
const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const maximumSourceManifestBytes = 64 * 1024;
const maximumPrivateKeyBytes = 16 * 1024;
const pluginPackageLimits = Object.freeze({
  maximumArchiveBytes: 64 * 1024 * 1024,
  maximumExpandedBytes: 128 * 1024 * 1024,
  maximumAssetBytes: 16 * 1024 * 1024,
  maximumManifestBytes: 1024 * 1024,
  maximumPathSegments: 32,
});
const privateKeyMarker = /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/;
let externalPluginV2ValidatorPromise;

/** 生成与 Electron v2 验签器一致的规范化签名负载。 */
export function getExternalPluginV2PackageSigningPayload(manifest) {
  return `${signatureDomain}\n${canonicalJson(manifest)}`;
}

/** 读取已有 v2 清单和 WASM 文件，生成带文件哈希与 Ed25519 签名的安装包。 */
export async function buildExternalPluginV2Package({ manifestPath, wasmPath, entrypoint, signingKey, keyId }) {
  assertKeyId(keyId);
  if (!signingKey || signingKey.type !== 'private' || signingKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('The package signer must be an Ed25519 private key.');
  }

  const sourceManifest = await validateSourceManifest(await readSourceManifest(manifestPath));
  const packageEntrypoint = normalizeWasmEntrypoint(entrypoint);
  const wasmBytes = await readBoundedRegularFile(
    wasmPath,
    pluginPackageLimits.maximumAssetBytes,
    'The WASM entrypoint must be a non-empty regular file no larger than 16 MiB.',
  );
  if (privateKeyMarker.test(wasmBytes.toString('utf8'))) {
    throw new Error('The WASM entrypoint appears to contain private key material.');
  }

  const unsignedManifest = {
    ...sourceManifest,
    runtime: 'wasm',
    entrypoint: packageEntrypoint,
    files: [{ path: packageEntrypoint, sha256: createHash('sha256').update(wasmBytes).digest('hex') }],
  };
  const signature = sign(
    null,
    Buffer.from(getExternalPluginV2PackageSigningPayload(unsignedManifest), 'utf8'),
    signingKey,
  ).toString('base64');
  const manifest = {
    ...unsignedManifest,
    signature: { algorithm: 'Ed25519', keyId, value: signature },
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  if (manifestBytes.length > pluginPackageLimits.maximumManifestBytes) {
    throw new Error('The generated v2 package manifest exceeds the 1 MiB package limit.');
  }

  const archive = createStoredZip([
    { path: 'plugin.json', contents: manifestBytes },
    { path: packageEntrypoint, contents: wasmBytes },
  ].sort(comparePaths));
  if (archive.length > pluginPackageLimits.maximumArchiveBytes) {
    throw new Error('The generated v2 package exceeds the 64 MiB archive limit.');
  }
  if (wasmBytes.length + manifestBytes.length > pluginPackageLimits.maximumExpandedBytes) {
    throw new Error('The generated v2 package exceeds the 128 MiB expanded package limit.');
  }
  return { archive, manifest };
}

/** 验证外部私钥路径后写入包文件；已有文件不会被覆盖。 */
export async function packExternalPluginV2Package({ manifestPath, wasmPath, entrypoint, privateKeyPath, keyId, outputPath }) {
  assertKeyId(keyId);
  const privatePath = await assertExternalPrivateKey(privateKeyPath);
  const appRealRoot = await realpath(repositoryRoot);
  if (isContainedPath(appRealRoot, privatePath)) {
    throw new Error('Keep plugin signing keys outside the repository.');
  }
  const privateKeyBytes = await readBoundedRegularFile(
    privatePath,
    maximumPrivateKeyBytes,
    'The signing key must be a bounded regular file no larger than 16 KiB.',
  );
  let signingKey;
  try {
    signingKey = createPrivateKey(privateKeyBytes);
  }
  catch (error) {
    throw new Error('The signing key could not be read as a private key.', { cause: error });
  }
  if (signingKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('The package signer must use Ed25519.');
  }

  const output = resolve(outputPath);
  if (extname(output).toLowerCase() !== '.itxs') {
    throw new Error('The output filename must use the .itxs extension.');
  }
  const { archive, manifest } = await buildExternalPluginV2Package({
    manifestPath,
    wasmPath,
    entrypoint,
    signingKey,
    keyId,
  });
  await writeExclusive(output, archive, 0o600);
  return {
    outputPath: output,
    pluginId: manifest.id,
    version: manifest.version,
    archiveBytes: archive.length,
  };
}

async function readSourceManifest(manifestPath) {
  const bytes = await readBoundedRegularFile(
    manifestPath,
    maximumSourceManifestBytes,
    'The v2 source manifest must be a non-empty regular file no larger than 64 KiB.',
  );
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  catch (error) {
    throw new Error('The v2 source manifest must be valid UTF-8 JSON.', { cause: error });
  }
}

/** 延迟加载宿主共享校验器，并用限定规则解析其源码依赖。 */
async function validateSourceManifest(value) {
  externalPluginV2ValidatorPromise ??= loadExternalPluginV2Validator();
  const { validateExternalPluginV2Manifest } = await externalPluginV2ValidatorPromise;
  return validateExternalPluginV2Manifest(value, supportedHostApiVersion);
}

/** 只读取并校验 v2 静态清单，不读取私钥、WASM 或输出包。 */
export async function validateExternalPluginV2SourceManifest(manifestPath) {
  const manifest = await validateSourceManifest(await readSourceManifest(manifestPath));
  return { pluginId: manifest.id, version: manifest.version };
}

/** 在仓库外生成 v2 Ed25519 签名密钥，避免私钥进入源码或安装包。 */
export async function generateExternalPluginV2SigningKey({ outputDirectory, keyId }) {
  assertKeyId(keyId);
  const appRealRoot = await realpath(repositoryRoot);
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
  const fingerprintHex = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .toUpperCase();
  const fingerprint = `SHA256:${fingerprintHex.match(/.{2}/g).join(':')}`;
  return { keyId, privateKeyPath, publicKeyPath, fingerprint };
}

async function loadExternalPluginV2Validator() {
  register('./typescript-extensionless-loader.mjs', import.meta.url);
  return import('../src/shared/external-plugin-v2.ts');
}

/** 只允许安装器支持的安全相对 WASM 入口路径。 */
function normalizeWasmEntrypoint(value) {
  if (typeof value !== 'string'
    || value.length > 1024
    || value === 'plugin.json'
    || value.toLowerCase() === 'plugin.json'
    || value.includes('\\')
    || value.includes(':')
    || value.includes('%')
    || value.includes('?')
    || value.includes('#')
    || value.includes('\0')
    || value.startsWith('/')
    || value.normalize('NFC') !== value
    || !value.toLowerCase().endsWith('.wasm')) {
    throw new Error('The v2 WASM entrypoint path is invalid.');
  }
  const segments = value.split('/');
  if (segments.length > pluginPackageLimits.maximumPathSegments || segments.some(segment => (
    segment === ''
    || segment === '.'
    || segment === '..'
    || segment.length > 255
    || segment.endsWith('.')
    || segment.endsWith(' ')
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
    || [...segment].some(character => character.charCodeAt(0) < 0x20)
  ))) {
    throw new Error('The v2 WASM entrypoint path is invalid.');
  }
  return value;
}

/** 通过同一打开句柄读取边界内的常规文件，避免按初始大小分配内存。 */
async function readBoundedRegularFile(path, maximumBytes, errorMessage) {
  let handle;
  try {
    const absolutePath = resolve(path);
    const pathMetadata = await lstat(absolutePath);
    if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink() || pathMetadata.nlink !== 1) {
      throw new Error(errorMessage);
    }
    handle = await open(absolutePath, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size === 0 || metadata.size > maximumBytes) {
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
    if (bytesRead === 0) {
      throw new Error(errorMessage);
    }
    return Buffer.concat(chunks, bytesRead);
  }
  finally {
    await handle?.close();
  }
}

/** 写入独占输出文件；写入失败时清理本次创建的不完整文件。 */
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

/** 按递归键排序 JSON 对象，确保 JS 与 Electron 使用相同的签名输入。 */
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
  if (isRecord(value)) {
    const fields = Object.keys(value).sort().map((key) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error('The v2 source manifest contains a reserved JSON key.');
      }
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    });
    return `{${fields.join(',')}}`;
  }
  throw new Error('The v2 source manifest contains an unsupported JSON value.');
}

function assertKeyId(keyId) {
  if (typeof keyId !== 'string' || !keyIdPattern.test(keyId)) {
    throw new Error('The signer key ID is invalid.');
  }
}

async function assertExternalPrivateKey(privateKeyPath) {
  const absolutePath = resolve(privateKeyPath);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error('The signing key path must name a regular file without links.');
  }
  return realpath(absolutePath);
}

function isContainedPath(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
  );
}

function comparePaths(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFlags(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--') || flag in result) {
      throw new Error('V2 plugin packaging requires unique --name value arguments.');
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

function getUsage() {
  return [
    'IT Tools signed Electron v2 WASM plugin commands',
    '  pnpm run plugin:keygen:v2 --key-id <publisher> --output-directory <external-directory>',
    '  pnpm run plugin:validate:v2 --manifest <v2-manifest.json>',
    '  pnpm run plugin:pack:v2 --manifest <v2-manifest.json> --wasm <plugin.wasm> --entrypoint <package-path.wasm>',
    '    --private-key <external.pem> --key-id <publisher> --output <package.itxs>',
    '',
  ].join('\n');
}

async function runCli(argv) {
  const [command, ...arguments_] = argv;
  if (command === '--help' || command === 'help' || command === undefined || arguments_.join('') === '--help') {
    process.stdout.write(getUsage());
    return;
  }
  if (command !== 'keygen' && command !== 'pack' && command !== 'validate' && !command?.startsWith('--')) {
    throw new Error('Unknown v2 plugin command. Run `pnpm run plugin:validate:v2 --help` for usage.');
  }

  const commandArguments = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
  const flags = command === 'keygen' || command === 'pack' || command === 'validate' ? parseFlags(commandArguments) : parseFlags(argv);
  if (command === 'keygen') {
    assertFlags(flags, ['key-id', 'output-directory']);
    const result = await generateExternalPluginV2SigningKey({
      keyId: flags['key-id'],
      outputDirectory: flags['output-directory'],
    });
    process.stdout.write(`Generated v2 Ed25519 signer ${result.keyId} (${result.fingerprint}): ${result.privateKeyPath}\n`);
    return;
  }
  if (command === 'validate') {
    assertFlags(flags, ['manifest']);
    const result = await validateExternalPluginV2SourceManifest(flags.manifest);
    process.stdout.write(`Validated v2 manifest ${result.pluginId} ${result.version}: ${resolve(flags.manifest)}\n`);
    return;
  }
  assertFlags(flags, ['manifest', 'wasm', 'entrypoint', 'private-key', 'key-id', 'output']);
  const result = await packExternalPluginV2Package({
    manifestPath: flags.manifest,
    wasmPath: flags.wasm,
    entrypoint: flags.entrypoint,
    privateKeyPath: flags['private-key'],
    keyId: flags['key-id'],
    outputPath: flags.output,
  });
  process.stdout.write(`Signed v2 WASM package ${result.pluginId} ${result.version} (${result.archiveBytes} bytes): ${result.outputPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'V2 plugin package creation failed.'}\n`);
    process.exitCode = 1;
  });
}
