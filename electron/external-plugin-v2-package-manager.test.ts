import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, readFile, realpath, rm, truncate, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExternalPluginV2PackageManager,
  type ExternalPluginV2PackageSnapshot,
} from './external-plugin-v2-package-manager';
import {
  getExternalPluginV2PackageSigningPayload,
  type ExternalPluginV2UnsignedPackageManifest,
} from './plugin-package-v2';
import { pluginPackageLimits, type PluginPackageSigningKey } from './plugin-package-manifest';

const pluginId = 'org.example.manager-demo';
const signingPair = generateKeyPairSync('ed25519');
const trustedSigningKeys = new Map<string, PluginPackageSigningKey>([
  ['test-key', { publicKey: signingPair.publicKey, allowedPluginIds: [pluginId] }],
]);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('ExternalPluginV2PackageManager', () => {
  it('lists verified installed metadata and removes the selected version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-v2-manager-'));
    temporaryDirectories.push(root);
    const packageRoot = join(root, pluginId, '1.0.0');
    await mkdir(packageRoot, { recursive: true });
    const source = createManifest();
    await writeFile(join(packageRoot, 'plugin.json'), JSON.stringify(signManifest(source)));
    await writeFile(join(packageRoot, 'extension.mjs'), 'export const activate = () => undefined;');

    const events: string[] = [];
    const manager = new ExternalPluginV2PackageManager({
      installRoot: root,
      hostApiVersion: '2.0.0',
      trustedSigningKeys,
      onStateChange: event => events.push(`${event.reason}:${event.pluginId}@${event.version}`),
    });

    await expect(manager.listInstalled()).resolves.toEqual([expect.objectContaining({
      pluginId,
      version: '1.0.0',
      runtime: 'process',
      status: 'installed',
      runtimeStatus: 'ready',
    }) satisfies Partial<ExternalPluginV2PackageSnapshot>]);
    await expect(readFile(join(packageRoot, 'plugin.json'), 'utf8')).resolves.toContain(pluginId);
    await expect(manager.uninstall(pluginId, '1.0.0')).resolves.toBe(true);
    expect(events).toEqual(['uninstalled:org.example.manager-demo@1.0.0']);
    await expect(manager.listInstalled()).resolves.toEqual([]);
  });

  it('keeps runtime failures in memory and clears them after recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-v2-manager-runtime-'));
    temporaryDirectories.push(root);
    const packageRoot = join(root, pluginId, '1.0.0');
    await mkdir(packageRoot, { recursive: true });
    const source = createManifest();
    await writeFile(join(packageRoot, 'plugin.json'), JSON.stringify(signManifest(source)));
    await writeFile(join(packageRoot, 'extension.mjs'), 'export const activate = () => undefined;');

    const events: string[] = [];
    const manager = new ExternalPluginV2PackageManager({
      installRoot: root,
      hostApiVersion: '2.0.0',
      trustedSigningKeys,
      onStateChange: event => events.push(`${event.reason}:${event.runtimeFailureCode ?? 'none'}`),
    });

    manager.markRuntimeFailure(pluginId, '1.0.0', 'extension-failed');
    await expect(manager.listInstalled()).resolves.toEqual([expect.objectContaining({
      pluginId,
      version: '1.0.0',
      status: 'installed',
      runtimeStatus: 'unavailable',
      runtimeFailureCode: 'extension-failed',
    })]);
    manager.clearRuntimeFailure(pluginId, '1.0.0');
    await expect(manager.listInstalled()).resolves.toEqual([expect.objectContaining({
      runtimeStatus: 'ready',
    })]);
    expect(events).toEqual(['runtime-failure:extension-failed', 'runtime-recovered:none']);
  });

  it('keeps an invalid installed package visible as a diagnostic snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-v2-manager-invalid-'));
    temporaryDirectories.push(root);
    const packageRoot = join(root, pluginId, '1.0.0');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, 'plugin.json'), '{"formatVersion":2}');

    const manager = new ExternalPluginV2PackageManager({
      installRoot: root,
      hostApiVersion: '2.0.0',
      trustedSigningKeys,
    });
    await expect(manager.listInstalled()).resolves.toEqual([expect.objectContaining({
      pluginId,
      version: '1.0.0',
      status: 'invalid',
      errorCode: 'invalid-package',
    })]);
  });

  it('checks every signed file before providing an execution context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-v2-manager-execution-'));
    temporaryDirectories.push(root);
    const packageRoot = join(root, pluginId, '1.0.0');
    await mkdir(packageRoot, { recursive: true });
    const helper = 'export const value = 1;';
    const baseManifest = createManifest();
    const manifest = {
      ...baseManifest,
      files: [
        ...baseManifest.files,
        { path: 'helper.mjs', sha256: createHash('sha256').update(helper).digest('hex') },
      ],
    };
    await writeFile(join(packageRoot, 'plugin.json'), JSON.stringify(signManifest(manifest)));
    await writeFile(join(packageRoot, 'extension.mjs'), 'export const activate = () => undefined;');
    await writeFile(join(packageRoot, 'helper.mjs'), helper);
    const manager = new ExternalPluginV2PackageManager({
      installRoot: root,
      hostApiVersion: '2.0.0',
      trustedSigningKeys,
    });

    await expect(manager.getInstalledExecutionContext(pluginId, '1.0.0')).resolves.toMatchObject({
      packageRoot: await realpath(packageRoot),
      entrypoint: 'extension.mjs',
      entrypointSha256: manifest.files[0]!.sha256,
    });
    await writeFile(join(packageRoot, 'helper.mjs'), 'export const value = 2;');
    await expect(manager.listInstalled()).resolves.toEqual([expect.objectContaining({
      pluginId,
      version: '1.0.0',
      status: 'invalid',
      errorCode: 'file-hash-mismatch',
    })]);
    await expect(manager.getInstalledExecutionContext(pluginId, '1.0.0'))
      .rejects.toMatchObject({ code: 'file-hash-mismatch' });
    await truncate(join(packageRoot, 'helper.mjs'), pluginPackageLimits.maximumAssetBytes + 1);
    await expect(manager.getInstalledExecutionContext(pluginId, '1.0.0'))
      .rejects.toMatchObject({ code: 'resource-limit' });
  });
});

function createManifest(): ExternalPluginV2UnsignedPackageManifest {
  const source = 'export const activate = () => undefined;';
  return {
    formatVersion: 2,
    id: pluginId,
    name: 'Manager demo',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    runtime: 'process',
    entrypoint: 'extension.mjs',
    requestedCapabilities: [],
    activationEvents: [`onCommand:${pluginId}/run`],
    contributions: {
      tools: [],
      commands: [{
        id: `${pluginId}/run`,
        title: 'Run',
        description: 'Run the manager demo.',
        keywords: ['manager'],
      }],
    },
    files: [{ path: 'extension.mjs', sha256: createHash('sha256').update(source).digest('hex') }],
  };
}
function signManifest(manifest: ExternalPluginV2UnsignedPackageManifest): ExternalPluginV2UnsignedPackageManifest & { signature: { algorithm: 'Ed25519'; keyId: string; value: string } } {
  return {
    ...manifest,
    signature: {
      algorithm: 'Ed25519',
      keyId: 'test-key',
      value: sign(null, Buffer.from(getExternalPluginV2PackageSigningPayload(manifest), 'utf8'), signingPair.privateKey).toString('base64'),
    },
  };
}
