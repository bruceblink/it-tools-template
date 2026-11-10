import { createPublicKey, KeyObject, verify } from 'node:crypto';
import { normalizePluginPackagePath, pluginPackageLimits, PluginPackageError } from './plugin-package-manifest';
import type { PluginPackageSigningKey } from './plugin-package-manifest';
import {
  validateExternalPluginV2Manifest,
  type ExternalPluginV2Manifest,
} from '../src/shared/external-plugin-v2';

/** v2 包封套支持的运行时类型。渲染器只读取贡献清单，不执行入口文件。 */
export type ExternalPluginV2Runtime = 'process' | 'wasm';

export interface ExternalPluginV2PackageFile {
  readonly path: string;
  readonly sha256: string;
}

export interface ExternalPluginV2UnsignedPackageManifest extends ExternalPluginV2Manifest {
  readonly runtime: ExternalPluginV2Runtime;
  readonly entrypoint: string;
  readonly files: readonly ExternalPluginV2PackageFile[];
}

export interface ExternalPluginV2PackageManifest extends ExternalPluginV2UnsignedPackageManifest {
  readonly signature: {
    readonly algorithm: 'Ed25519';
    readonly keyId: string;
    readonly value: string;
  };
}

const packageSignatureDomain = 'IT Tools Electron Plugin Package v2';
const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const processEntrypointPattern = /\.(?:mjs|cjs|js)$/i;
const wasmEntrypointPattern = /\.wasm$/i;

/** 生成 v2 包签名负载。签名覆盖清单、运行时、入口和所有文件哈希。 */
export function getExternalPluginV2PackageSigningPayload(
  manifest: ExternalPluginV2UnsignedPackageManifest,
): string {
  return `${packageSignatureDomain}\n${canonicalJson(manifest)}`;
}

/** 在扩展包进入安装器前校验包封套和签名。 */
export function validateExternalPluginV2PackageManifest(
  value: unknown,
  hostApiVersion: string,
  trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>,
): ExternalPluginV2PackageManifest {
  if (!isRecord(value)) {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 package manifest must be an object.');
  }
  assertExactKeys(value, [
    'formatVersion',
    'id',
    'name',
    'version',
    'apiVersion',
    'runtime',
    'entrypoint',
    'requestedCapabilities',
    'activationEvents',
    'contributions',
    'files',
    'signature',
  ]);

  const staticManifest = parseStaticManifest(value, hostApiVersion);
  const runtime = readRuntime(value.runtime);
  const entrypoint = readEntrypoint(value.entrypoint, runtime);
  const files = readFiles(value.files);
  if (!files.some(file => file.path === entrypoint)) {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 entrypoint is missing from its file list.');
  }
  const signature = readSignature(value.signature);
  const unsignedManifest: ExternalPluginV2UnsignedPackageManifest = {
    ...staticManifest,
    runtime,
    entrypoint,
    files,
  };
  verifySignature(unsignedManifest, signature, staticManifest.id, trustedSigningKeys);
  return { ...unsignedManifest, signature };
}

/** 从 bounded UTF-8 JSON 中读取并校验 v2 包清单。 */
export function parseExternalPluginV2PackageManifest(
  bytes: Buffer,
  hostApiVersion: string,
  trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>,
): ExternalPluginV2PackageManifest {
  if (bytes.length === 0 || bytes.length > pluginPackageLimits.maximumManifestBytes) {
    throw new PluginPackageError('resource-limit', 'The external plugin v2 package manifest exceeds its size limit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  }
  catch (error) {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 package manifest is not valid UTF-8 JSON.', { cause: error });
  }
  return validateExternalPluginV2PackageManifest(parsed, hostApiVersion, trustedSigningKeys);
}

function parseStaticManifest(value: Record<string, unknown>, hostApiVersion: string): ExternalPluginV2Manifest {
  const candidate = {
    formatVersion: value.formatVersion,
    id: value.id,
    name: value.name,
    version: value.version,
    apiVersion: value.apiVersion,
    requestedCapabilities: value.requestedCapabilities,
    activationEvents: value.activationEvents,
    contributions: value.contributions,
  };
  try {
    return validateExternalPluginV2Manifest(candidate, hostApiVersion);
  }
  catch (error) {
    throw new PluginPackageError('invalid-package', error instanceof Error ? error.message : 'The external plugin v2 contribution manifest is invalid.', { cause: error });
  }
}

function readRuntime(value: unknown): ExternalPluginV2Runtime {
  if (value !== 'process' && value !== 'wasm') {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 runtime is invalid.');
  }
  return value;
}

function readEntrypoint(value: unknown, runtime: ExternalPluginV2Runtime): string {
  if (typeof value !== 'string' || value === 'plugin.json') {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 entrypoint path is invalid.');
  }
  try {
    normalizePluginPackagePath(value);
  }
  catch (error) {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 entrypoint path is invalid.', { cause: error });
  }
  const matchesRuntime = runtime === 'process'
    ? processEntrypointPattern.test(value)
    : wasmEntrypointPattern.test(value);
  if (!matchesRuntime) {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 entrypoint extension does not match its runtime.');
  }
  return value;
}

function readFiles(value: unknown): ExternalPluginV2PackageFile[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > pluginPackageLimits.maximumFiles) {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 file list is invalid.');
  }
  const files: ExternalPluginV2PackageFile[] = [];
  const seenPaths = new Set<string>();
  let previousPath = '';
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      throw new PluginPackageError('invalid-package', 'An external plugin v2 file record is invalid.');
    }
    assertExactKeys(candidate, ['path', 'sha256']);
    if (typeof candidate.path !== 'string' || candidate.path === 'plugin.json') {
      throw new PluginPackageError('invalid-package', 'An external plugin v2 file path is invalid.');
    }
    try {
      normalizePluginPackagePath(candidate.path);
    }
    catch (error) {
      throw new PluginPackageError('invalid-package', 'An external plugin v2 file path is invalid.', { cause: error });
    }
    if (candidate.path <= previousPath || seenPaths.has(candidate.path.toLowerCase())) {
      throw new PluginPackageError('invalid-package', 'The external plugin v2 file list must be sorted and unique.');
    }
    if (typeof candidate.sha256 !== 'string' || !hashPattern.test(candidate.sha256)) {
      throw new PluginPackageError('invalid-package', 'An external plugin v2 file hash is invalid.');
    }
    files.push({ path: candidate.path, sha256: candidate.sha256 });
    previousPath = candidate.path;
    seenPaths.add(candidate.path.toLowerCase());
  }
  return files;
}

function readSignature(value: unknown): ExternalPluginV2PackageManifest['signature'] {
  if (!isRecord(value)) {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 package must declare a signature.');
  }
  assertExactKeys(value, ['algorithm', 'keyId', 'value']);
  if (
    value.algorithm !== 'Ed25519'
    || typeof value.keyId !== 'string'
    || !keyIdPattern.test(value.keyId)
    || typeof value.value !== 'string'
  ) {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 signature metadata is invalid.');
  }
  const signature = Buffer.from(value.value, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== value.value) {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 signature encoding is invalid.');
  }
  return { algorithm: 'Ed25519', keyId: value.keyId, value: value.value };
}

function verifySignature(
  manifest: ExternalPluginV2UnsignedPackageManifest,
  signature: ExternalPluginV2PackageManifest['signature'],
  pluginId: string,
  trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>,
): void {
  const signingKey = trustedSigningKeys.get(signature.keyId);
  if (!signingKey || !signingKey.allowedPluginIds.includes(pluginId)) {
    throw new PluginPackageError('untrusted-signature', 'The external plugin v2 signing key is not trusted for this plugin ID.');
  }
  try {
    const publicKey = signingKey.publicKey instanceof KeyObject
      ? signingKey.publicKey
      : createPublicKey(signingKey.publicKey);
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('Expected an Ed25519 public key.');
    }
    const valid = verify(
      null,
      Buffer.from(getExternalPluginV2PackageSigningPayload(manifest), 'utf8'),
      publicKey,
      Buffer.from(signature.value, 'base64'),
    );
    if (!valid) {
      throw new PluginPackageError('untrusted-signature', 'The external plugin v2 package signature is invalid.');
    }
  }
  catch (error) {
    if (error instanceof PluginPackageError) {
      throw error;
    }
    throw new PluginPackageError('untrusted-signature', 'The external plugin v2 signing key is invalid.', { cause: error });
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    const fields = Object.keys(value).sort().map((key) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new PluginPackageError('invalid-package', 'The external plugin v2 manifest contains a reserved JSON key.');
      }
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    });
    return `{${fields.join(',')}}`;
  }
  throw new PluginPackageError('invalid-package', 'The external plugin v2 manifest contains an unsupported JSON value.');
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const expectedKeys = new Set(expected);
  if (Object.keys(record).length !== expectedKeys.size || Object.keys(record).some(key => !expectedKeys.has(key))) {
    throw new PluginPackageError('invalid-package', 'The external plugin v2 package manifest has missing or unknown fields.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
