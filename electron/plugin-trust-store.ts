import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PluginPackageSigningKey } from './plugin-package';
import { isValidPluginId } from './plugin-sandbox';

const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const maximumTrustStoreBytes = 256 * 1024;
const maximumTrustedKeys = 64;
const maximumPluginIdsPerKey = 32;
const maximumPublicKeyBytes = 16 * 1024;

export const pluginTrustStoreLimits = Object.freeze({
  maximumTrustedKeys,
  maximumPluginIdsPerKey,
  maximumPublicKeyBytes,
});

export type PluginTrustStoreErrorCode =
  | 'store-unavailable'
  | 'invalid-store'
  | 'invalid-key'
  | 'already-trusted'
  | 'trust-confirmation-required'
  | 'trust-key-not-found';

export class PluginTrustStoreError extends Error {
  constructor(
    readonly code: PluginTrustStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginTrustStoreError';
  }
}

export interface PluginSignerInput {
  keyId: string;
  publicKey: string;
  allowedPluginIds: readonly string[];
}

export interface PluginSignerSnapshot {
  keyId: string;
  fingerprint: string;
  allowedPluginIds: readonly string[];
}

interface NormalizedSigner extends PluginSignerSnapshot {
  publicKey: string;
}

interface StoredTrustState {
  schemaVersion: 1;
  keys: Array<{
    keyId: string;
    publicKey: string;
    allowedPluginIds: string[];
  }>;
}

/** Keep explicit host-approved Ed25519 public keys in a private user-data file. */
export class PluginTrustStore {
  readonly signingKeys: Map<string, PluginPackageSigningKey>;
  private readonly statePath: string;
  private readonly entries = new Map<string, NormalizedSigner>();
  private operationQueue: Promise<void> = Promise.resolve();
  private loaded = false;
  private available = false;

  constructor(statePath: string, signingKeys = new Map<string, PluginPackageSigningKey>()) {
    this.statePath = resolve(statePath);
    this.signingKeys = signingKeys;
  }

  async load(): Promise<void> {
    await this.runExclusive(async () => {
      this.loaded = false;
      this.available = false;
      this.replaceEntries([]);
      await this.ensureParentDirectory();
      const fileMetadata = await lstat(this.statePath).catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') {
          this.replaceEntries([]);
          this.loaded = true;
          this.available = true;
          return undefined;
        }
        throw new PluginTrustStoreError('store-unavailable', 'The plugin trust store could not be inspected.', { cause: error });
      });
      if (!fileMetadata) {
        return;
      }
      if (!fileMetadata.isFile() || fileMetadata.isSymbolicLink() || fileMetadata.nlink !== 1 || fileMetadata.size > maximumTrustStoreBytes) {
        throw new PluginTrustStoreError('invalid-store', 'The plugin trust store is not a bounded regular file.');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(this.statePath))) as unknown;
      }
      catch (error) {
        throw new PluginTrustStoreError('invalid-store', 'The plugin trust store is not valid UTF-8 JSON.', { cause: error });
      }
      const keys = validateStoredState(parsed);
      let normalized: NormalizedSigner[];
      try {
        normalized = keys.map(key => normalizeSigner(key));
      }
      catch (error) {
        throw new PluginTrustStoreError('invalid-store', 'The plugin trust store contains an invalid signer.', { cause: error });
      }
      if (new Set(normalized.map(key => key.keyId)).size !== normalized.length) {
        throw new PluginTrustStoreError('invalid-store', 'The plugin trust store contains duplicate key IDs.');
      }
      this.replaceEntries(normalized);
      this.loaded = true;
      this.available = true;
    });
  }

  preview(input: PluginSignerInput): PluginSignerSnapshot {
    const normalized = normalizeSigner(input);
    return toSnapshot(normalized);
  }

  list(): PluginSignerSnapshot[] {
    this.assertAvailable();
    return [...this.entries.values()]
      .map(toSnapshot)
      .sort((left, right) => left.keyId.localeCompare(right.keyId));
  }

  async add(input: PluginSignerInput, confirmedFingerprint: string): Promise<PluginSignerSnapshot> {
    return this.runExclusive(async () => {
      this.assertAvailable();
      const signer = normalizeSigner(input);
      if (confirmedFingerprint !== signer.fingerprint) {
        throw new PluginTrustStoreError(
          'trust-confirmation-required',
          'The confirmed fingerprint does not match the public key.',
        );
      }
      if (this.entries.has(signer.keyId)) {
        throw new PluginTrustStoreError('already-trusted', 'This signer key ID is already trusted.');
      }
      if (this.entries.size >= maximumTrustedKeys) {
        throw new PluginTrustStoreError('invalid-store', 'The host has reached its trusted signer limit.');
      }

      const nextEntries = [...this.entries.values(), signer];
      await this.writeState(nextEntries);
      this.replaceEntries(nextEntries);
      return toSnapshot(signer);
    });
  }

  async remove(keyId: string): Promise<boolean> {
    return this.runExclusive(async () => {
      this.assertAvailable();
      if (!this.entries.has(keyId)) {
        return false;
      }
      const nextEntries = [...this.entries.values()].filter(entry => entry.keyId !== keyId);
      await this.writeState(nextEntries);
      this.replaceEntries(nextEntries);
      return true;
    });
  }

  private async ensureParentDirectory(): Promise<void> {
    const parentDirectory = dirname(this.statePath);
    await mkdir(parentDirectory, { recursive: true, mode: 0o700 }).catch((error: unknown) => {
      throw new PluginTrustStoreError('store-unavailable', 'The plugin trust store directory could not be created.', { cause: error });
    });
    const metadata = await lstat(parentDirectory).catch((error: unknown) => {
      throw new PluginTrustStoreError('store-unavailable', 'The plugin trust store directory could not be inspected.', { cause: error });
    });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new PluginTrustStoreError('invalid-store', 'The plugin trust store directory must be a real directory.');
    }
  }

  private async writeState(entries: readonly NormalizedSigner[]): Promise<void> {
    const existing = await lstat(this.statePath).catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return undefined;
      }
      throw new PluginTrustStoreError('store-unavailable', 'The plugin trust store could not be inspected.', { cause: error });
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || existing.size > maximumTrustStoreBytes)) {
      throw new PluginTrustStoreError('invalid-store', 'The plugin trust store is not a bounded regular file.');
    }

    const state: StoredTrustState = {
      schemaVersion: 1,
      keys: entries.map(({ keyId, publicKey, allowedPluginIds }) => ({
        keyId,
        publicKey,
        allowedPluginIds: [...allowedPluginIds],
      })),
    };
    const bytes = Buffer.from(`${JSON.stringify(state)}\n`, 'utf8');
    if (bytes.length > maximumTrustStoreBytes) {
      throw new PluginTrustStoreError('invalid-store', 'The plugin trust store exceeds its size limit.');
    }

    const temporaryPath = resolve(dirname(this.statePath), `.plugin-trust-${randomUUID()}.tmp`);
    let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      fileHandle = await open(temporaryPath, 'wx', 0o600);
      await fileHandle.writeFile(bytes);
      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = undefined;
      await rename(temporaryPath, this.statePath);
    }
    catch (error) {
      throw new PluginTrustStoreError('store-unavailable', 'The plugin trust store could not be saved.', { cause: error });
    }
    finally {
      await fileHandle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
    }
  }

  private replaceEntries(entries: readonly NormalizedSigner[]): void {
    this.entries.clear();
    this.signingKeys.clear();
    for (const entry of entries) {
      this.entries.set(entry.keyId, entry);
      this.signingKeys.set(entry.keyId, {
        publicKey: entry.publicKey,
        allowedPluginIds: [...entry.allowedPluginIds],
      });
    }
  }

  private assertAvailable(): void {
    if (!this.loaded || !this.available) {
      throw new PluginTrustStoreError('store-unavailable', 'The plugin trust store is not available.');
    }
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function normalizeSigner(input: PluginSignerInput): NormalizedSigner {
  if (!keyIdPattern.test(input.keyId)) {
    throw new PluginTrustStoreError('invalid-key', 'The signer key ID is invalid.');
  }
  if (
    typeof input.publicKey !== 'string'
    || !input.publicKey.includes('-----BEGIN PUBLIC KEY-----')
    || input.publicKey.includes('PRIVATE KEY')
    || Buffer.byteLength(input.publicKey, 'utf8') > maximumPublicKeyBytes
  ) {
    throw new PluginTrustStoreError('invalid-key', 'The Ed25519 public key is missing or too large.');
  }
  if (
    !Array.isArray(input.allowedPluginIds)
    || input.allowedPluginIds.length === 0
    || input.allowedPluginIds.length > maximumPluginIdsPerKey
    || new Set(input.allowedPluginIds).size !== input.allowedPluginIds.length
    || input.allowedPluginIds.some(pluginId => typeof pluginId !== 'string' || !isValidPluginId(pluginId))
  ) {
    throw new PluginTrustStoreError('invalid-key', 'The signer plugin ID allowlist is invalid.');
  }

  let keyObject: ReturnType<typeof createPublicKey>;
  try {
    keyObject = createPublicKey(input.publicKey);
  }
  catch (error) {
    throw new PluginTrustStoreError('invalid-key', 'The signer public key cannot be parsed.', { cause: error });
  }
  if (keyObject.asymmetricKeyType !== 'ed25519') {
    throw new PluginTrustStoreError('invalid-key', 'The signer public key must use Ed25519.');
  }

  const publicKey = keyObject.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprintBytes = createHash('sha256')
    .update(keyObject.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .toUpperCase();
  const fingerprint = `SHA256:${fingerprintBytes.match(/.{2}/g)!.join(':')}`;
  return {
    keyId: input.keyId,
    publicKey,
    fingerprint,
    allowedPluginIds: [...input.allowedPluginIds].sort(),
  };
}

function validateStoredState(value: unknown): PluginSignerInput[] {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'keys']) || value.schemaVersion !== 1 || !Array.isArray(value.keys)) {
    throw new PluginTrustStoreError('invalid-store', 'The plugin trust store has an unsupported format.');
  }
  if (value.keys.length > maximumTrustedKeys) {
    throw new PluginTrustStoreError('invalid-store', 'The plugin trust store has too many keys.');
  }
  return value.keys.map((entry: unknown) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ['keyId', 'publicKey', 'allowedPluginIds'])) {
      throw new PluginTrustStoreError('invalid-store', 'A plugin trust store entry is invalid.');
    }
    if (
      typeof entry.keyId !== 'string'
      || typeof entry.publicKey !== 'string'
      || !Array.isArray(entry.allowedPluginIds)
      || entry.allowedPluginIds.some(pluginId => typeof pluginId !== 'string')
    ) {
      throw new PluginTrustStoreError('invalid-store', 'A plugin trust store entry has invalid fields.');
    }
    return {
      keyId: entry.keyId,
      publicKey: entry.publicKey,
      allowedPluginIds: entry.allowedPluginIds as string[],
    };
  });
}

function toSnapshot(signer: NormalizedSigner): PluginSignerSnapshot {
  return {
    keyId: signer.keyId,
    fingerprint: signer.fingerprint,
    allowedPluginIds: [...signer.allowedPluginIds],
  };
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
