import { createPublicKey, KeyObject, verify } from 'node:crypto';
import * as yauzl from 'yauzl';

export const pluginPackageManifestPath = 'plugin.json';

const signatureDomain = 'IT Tools Electron Plugin Package v1';
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const knownCapabilities = new Set([
  'clipboard.write',
  'data.oui',
  'device.camera',
  'file.read',
  'file.save',
  'runtime.info',
]);
const windowsDeviceNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export const pluginPackageLimits = Object.freeze({
  maximumArchiveBytes: 64 * 1024 * 1024,
  maximumExpandedBytes: 128 * 1024 * 1024,
  maximumAssetBytes: 16 * 1024 * 1024,
  maximumManifestBytes: 1024 * 1024,
  maximumFiles: 512,
  maximumEntries: 1024,
  maximumCompressionRatio: 100,
});

export type PluginPackageErrorCode =
  | 'invalid-package'
  | 'invalid-archive'
  | 'unsafe-archive-entry'
  | 'resource-limit'
  | 'untrusted-signature'
  | 'file-hash-mismatch'
  | 'already-installed';

export class PluginPackageError extends Error {
  constructor(
    readonly code: PluginPackageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginPackageError';
  }
}

export interface PluginPackageFile {
  path: string;
  sha256: string;
}

export interface PluginPackageUnsignedManifest {
  formatVersion: 1;
  id: string;
  name: string;
  version: string;
  apiVersion: {
    minInclusive: string;
    maxExclusive: string;
  };
  entrypoint: string;
  requestedCapabilities: readonly string[];
  files: readonly PluginPackageFile[];
}

export interface PluginPackageManifest extends PluginPackageUnsignedManifest {
  signature: {
    algorithm: 'Ed25519';
    keyId: string;
    value: string;
  };
}

export interface PluginPackageSigningKey {
  publicKey: string | Buffer | KeyObject;
  allowedPluginIds: readonly string[];
}

export interface StagePluginPackageOptions {
  archivePath: string;
  installRoot: string;
  hostApiVersion: string;
  trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>;
}

export interface StagedPluginPackage {
  manifest: PluginPackageManifest;
  packageRoot: string;
  archiveBytes: number;
  expandedBytes: number;
}

/** Canonical JSON makes signatures independent of source property order and whitespace. */
export function getPluginPackageSigningPayload(manifest: PluginPackageUnsignedManifest): string {
  return `${signatureDomain}\n${canonicalJson(manifest)}`;
}

/** Reject incompatible metadata and verify its signature against a host-owned trust list. */
export function validatePluginPackageManifest(
  value: unknown,
  hostApiVersion: string,
  trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>,
): PluginPackageManifest {
  if (!isRecord(value)) {
    throw new PluginPackageError('invalid-package', 'The plugin package manifest must be an object.');
  }
  assertExactKeys(value, [
    'formatVersion',
    'id',
    'name',
    'version',
    'apiVersion',
    'entrypoint',
    'requestedCapabilities',
    'files',
    'signature',
  ], 'plugin package manifest');

  if (value.formatVersion !== 1) {
    throw new PluginPackageError('invalid-package', 'The plugin package format is not supported.');
  }
  if (typeof value.id !== 'string' || !pluginIdPattern.test(value.id) || value.id.length > 128) {
    throw new PluginPackageError('invalid-package', 'The plugin package ID is invalid.');
  }
  if (typeof value.name !== 'string' || value.name.trim() === '' || value.name.length > 120) {
    throw new PluginPackageError('invalid-package', 'The plugin package name is invalid.');
  }

  parseVersion(value.version, 'Plugin package version');
  const hostVersion = parseVersion(hostApiVersion, 'Host API version');
  if (!isRecord(value.apiVersion)) {
    throw new PluginPackageError('invalid-package', 'The plugin package must declare an API compatibility range.');
  }
  assertExactKeys(value.apiVersion, ['minInclusive', 'maxExclusive'], 'plugin API range');
  const minimum = parseVersion(value.apiVersion.minInclusive, 'Plugin API minimum');
  const maximum = parseVersion(value.apiVersion.maxExclusive, 'Plugin API maximum');
  if (compareVersions(minimum, maximum) >= 0) {
    throw new PluginPackageError('invalid-package', 'The plugin package API range is empty.');
  }
  if (compareVersions(hostVersion, minimum) < 0 || compareVersions(hostVersion, maximum) >= 0) {
    throw new PluginPackageError('invalid-package', 'The plugin package does not support this host API version.');
  }

  if (typeof value.entrypoint !== 'string' || !isSafePluginPackagePath(value.entrypoint)) {
    throw new PluginPackageError('invalid-package', 'The plugin package entrypoint path is invalid.');
  }
  if (!value.entrypoint.toLowerCase().endsWith('.html')) {
    throw new PluginPackageError('invalid-package', 'The plugin package entrypoint must be an HTML file.');
  }

  const requestedCapabilities = validateCapabilities(value.requestedCapabilities);
  const files = validateFileManifest(value.files);
  if (!files.some(file => file.path === value.entrypoint)) {
    throw new PluginPackageError('invalid-package', 'The plugin package entrypoint is missing from its file list.');
  }

  if (!isRecord(value.signature)) {
    throw new PluginPackageError('invalid-package', 'The plugin package must declare a signature.');
  }
  assertExactKeys(value.signature, ['algorithm', 'keyId', 'value'], 'plugin signature');
  if (
    value.signature.algorithm !== 'Ed25519'
    || typeof value.signature.keyId !== 'string'
    || !keyIdPattern.test(value.signature.keyId)
    || typeof value.signature.value !== 'string'
  ) {
    throw new PluginPackageError('invalid-package', 'The plugin package signature metadata is invalid.');
  }

  const signingKey = trustedSigningKeys.get(value.signature.keyId);
  if (!signingKey || !signingKey.allowedPluginIds.includes(value.id)) {
    throw new PluginPackageError('untrusted-signature', 'The plugin package signing key is not trusted for this plugin ID.');
  }

  const signature = Buffer.from(value.signature.value, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== value.signature.value) {
    throw new PluginPackageError('invalid-package', 'The plugin package signature encoding is invalid.');
  }

  try {
    const publicKey = signingKey.publicKey instanceof KeyObject
      ? signingKey.publicKey
      : createPublicKey(signingKey.publicKey);
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('Expected an Ed25519 public key.');
    }
    const unsignedManifest: PluginPackageUnsignedManifest = {
      formatVersion: 1,
      id: value.id,
      name: value.name,
      version: value.version as string,
      apiVersion: {
        minInclusive: value.apiVersion.minInclusive as string,
        maxExclusive: value.apiVersion.maxExclusive as string,
      },
      entrypoint: value.entrypoint,
      requestedCapabilities,
      files,
    };
    const payload = Buffer.from(getPluginPackageSigningPayload(unsignedManifest), 'utf8');
    if (!verify(null, payload, publicKey, signature)) {
      throw new PluginPackageError('untrusted-signature', 'The plugin package signature is invalid.');
    }
  }
  catch (error) {
    if (error instanceof PluginPackageError) {
      throw error;
    }
    throw new PluginPackageError('untrusted-signature', 'The plugin package signing key is invalid.', { cause: error });
  }

  return {
    formatVersion: 1,
    id: value.id,
    name: value.name,
    version: value.version as string,
    apiVersion: {
      minInclusive: value.apiVersion.minInclusive as string,
      maxExclusive: value.apiVersion.maxExclusive as string,
    },
    entrypoint: value.entrypoint,
    requestedCapabilities,
    files,
    signature: {
      algorithm: 'Ed25519',
      keyId: value.signature.keyId,
      value: value.signature.value,
    },
  };
}

export function parsePluginPackageManifest(
  bytes: Buffer,
  hostApiVersion: string,
  trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>,
): PluginPackageManifest {
  let parsed: unknown;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    parsed = JSON.parse(json) as unknown;
  }
  catch (error) {
    throw new PluginPackageError('invalid-package', 'The plugin package manifest is not valid UTF-8 JSON.', { cause: error });
  }
  return validatePluginPackageManifest(parsed, hostApiVersion, trustedSigningKeys);
}

export function normalizePluginPackagePath(fileName: string, isDirectory = false): string {
  const candidate = isDirectory ? fileName.slice(0, -1) : fileName;
  if (
    candidate === ''
    || candidate.length > 1024
    || candidate.includes('\0')
    || candidate.includes('\\')
    || candidate.includes(':')
    || candidate.includes('%')
    || candidate.includes('?')
    || candidate.includes('#')
    || candidate.startsWith('/')
    || candidate.normalize('NFC') !== candidate
    || yauzl.validateFileName(fileName) !== null
  ) {
    throw new PluginPackageError('unsafe-archive-entry', 'The plugin package contains an unsafe file path.');
  }

  const segments = candidate.split('/');
  if (segments.some(segment => (
    segment === ''
    || segment === '.'
    || segment === '..'
    || segment.length > 255
    || segment.endsWith('.')
    || segment.endsWith(' ')
    || windowsDeviceNamePattern.test(segment)
    || [...segment].some(character => character.charCodeAt(0) < 0x20)
  ))) {
    throw new PluginPackageError('unsafe-archive-entry', 'The plugin package contains an unsafe file path.');
  }
  return candidate;
}

function validateCapabilities(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(capability => typeof capability !== 'string')) {
    throw new PluginPackageError('invalid-package', 'The plugin package capability list is invalid.');
  }
  const capabilities = value as string[];
  if (
    new Set(capabilities).size !== capabilities.length
    || capabilities.some(capability => !knownCapabilities.has(capability))
  ) {
    throw new PluginPackageError('invalid-package', 'The plugin package requests an unknown or repeated capability.');
  }
  return [...capabilities];
}

function validateFileManifest(value: unknown): PluginPackageFile[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > pluginPackageLimits.maximumFiles) {
    throw new PluginPackageError('invalid-package', 'The plugin package file list is invalid.');
  }
  const files: PluginPackageFile[] = [];
  let previousPath = '';
  const seenPaths = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      throw new PluginPackageError('invalid-package', 'A plugin package file record is invalid.');
    }
    assertExactKeys(candidate, ['path', 'sha256'], 'plugin file record');
    if (
      typeof candidate.path !== 'string'
      || !isSafePluginPackagePath(candidate.path)
      || candidate.path === pluginPackageManifestPath
    ) {
      throw new PluginPackageError('invalid-package', 'A plugin package file path is invalid.');
    }
    if (candidate.path <= previousPath || seenPaths.has(candidate.path.toLowerCase())) {
      throw new PluginPackageError('invalid-package', 'The plugin package file list must be sorted and unique.');
    }
    if (typeof candidate.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.sha256)) {
      throw new PluginPackageError('invalid-package', 'A plugin package file hash is invalid.');
    }
    previousPath = candidate.path;
    seenPaths.add(candidate.path.toLowerCase());
    files.push({ path: candidate.path, sha256: candidate.sha256 });
  }
  return files;
}

function isSafePluginPackagePath(path: string): boolean {
  try {
    normalizePluginPackagePath(path);
    return true;
  }
  catch {
    return false;
  }
}

function parseVersion(value: unknown, label: string): readonly [number, number, number] {
  if (typeof value !== 'string') {
    throw new PluginPackageError('invalid-package', `${label} must use MAJOR.MINOR.PATCH format.`);
  }
  const match = stableVersionPattern.exec(value);
  if (!match) {
    throw new PluginPackageError('invalid-package', `${label} must use MAJOR.MINOR.PATCH format.`);
  }
  const parts = match.slice(1).map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) {
    throw new PluginPackageError('invalid-package', `${label} contains an unsafe numeric component.`);
  }
  return parts as unknown as readonly [number, number, number];
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
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
        throw new PluginPackageError('invalid-package', 'The plugin manifest contains a reserved JSON key.');
      }
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    });
    return `{${fields.join(',')}}`;
  }
  throw new PluginPackageError('invalid-package', 'The plugin manifest contains an unsupported JSON value.');
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const expectedKeys = new Set(expected);
  if (
    Object.keys(record).length !== expectedKeys.size
    || Object.keys(record).some(key => !expectedKeys.has(key))
  ) {
    throw new PluginPackageError('invalid-package', `The ${label} has missing or unknown fields.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
