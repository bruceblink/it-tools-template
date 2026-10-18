// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PluginTrustStore,
  PluginTrustStoreError,
  pluginTrustStoreLimits,
} from './plugin-trust-store';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('Electron plugin trust store', () => {
  it('requires the reviewed fingerprint and persists only normalized public keys', async () => {
    const directory = await createTemporaryDirectory();
    const storePath = join(directory, 'plugins', 'trusted-keys.json');
    const pair = generateKeyPairSync('ed25519');
    const signer = {
      keyId: 'publisher-2026',
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      allowedPluginIds: ['org.example.sandbox'],
    };
    const store = new PluginTrustStore(storePath);
    await store.load();

    const preview = store.preview(signer);
    expect(preview.fingerprint).toMatch(/^SHA256:(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    await expect(store.add(signer, 'SHA256:00')).rejects.toMatchObject({ code: 'trust-confirmation-required' });

    await expect(store.add(signer, preview.fingerprint)).resolves.toEqual(preview);
    expect(store.signingKeys.get(signer.keyId)?.allowedPluginIds).toEqual(['org.example.sandbox']);
    const saved = await readFile(storePath, 'utf8');
    expect(saved).toContain('-----BEGIN PUBLIC KEY-----');
    expect(saved).not.toContain('PRIVATE KEY-----');

    const reloaded = new PluginTrustStore(storePath);
    await reloaded.load();
    expect(reloaded.list()).toEqual([preview]);
    expect(reloaded.signingKeys.has(signer.keyId)).toBe(true);
  });

  it('rejects private keys, unsupported key types, and invalid plugin allowlists', async () => {
    const directory = await createTemporaryDirectory();
    const store = new PluginTrustStore(join(directory, 'trusted-keys.json'));
    await store.load();
    const ed25519 = generateKeyPairSync('ed25519');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });

    expect(() => store.preview({
      keyId: 'private-key',
      publicKey: ed25519.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      allowedPluginIds: ['org.example.sandbox'],
    })).toThrowError(PluginTrustStoreError);
    expect(() => store.preview({
      keyId: 'rsa-key',
      publicKey: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      allowedPluginIds: ['org.example.sandbox'],
    })).toThrowError(PluginTrustStoreError);
    expect(() => store.preview({
      keyId: 'invalid-id',
      publicKey: ed25519.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      allowedPluginIds: ['../outside'],
    })).toThrowError(PluginTrustStoreError);
  });

  it('revokes a signer from memory only after the updated store is durable', async () => {
    const directory = await createTemporaryDirectory();
    const storePath = join(directory, 'trusted-keys.json');
    const pair = generateKeyPairSync('ed25519');
    const signer = {
      keyId: 'publisher',
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      allowedPluginIds: ['org.example.sandbox'],
    };
    const store = new PluginTrustStore(storePath);
    await store.load();
    const preview = store.preview(signer);
    await store.add(signer, preview.fingerprint);

    await expect(store.remove(signer.keyId)).resolves.toBe(true);
    expect(store.signingKeys.has(signer.keyId)).toBe(false);
    expect(store.list()).toEqual([]);
    await expect(readFile(storePath, 'utf8')).resolves.toContain('"keys":[]');
    await expect(store.remove(signer.keyId)).resolves.toBe(false);
  });

  it('rejects a corrupted trust file without replacing it with an empty store', async () => {
    const directory = await createTemporaryDirectory();
    const storePath = join(directory, 'trusted-keys.json');
    await writeFile(storePath, '{broken', { mode: 0o600 });
    const store = new PluginTrustStore(storePath);

    await expect(store.load()).rejects.toMatchObject({ code: 'invalid-store' });
    expect(() => store.list()).toThrowError(PluginTrustStoreError);
    await expect(readFile(storePath, 'utf8')).resolves.toBe('{broken');
    expect(pluginTrustStoreLimits.maximumTrustedKeys).toBe(64);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-trust-'));
  temporaryDirectories.push(directory);
  return directory;
}
