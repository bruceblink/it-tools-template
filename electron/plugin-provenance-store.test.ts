// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PluginProvenanceStore,
  PluginProvenanceStoreError,
  pluginProvenanceStoreLimits,
} from './plugin-provenance-store';
import type { DesktopPluginMarketplaceInstallSource } from '../src/shared/desktop-services/plugins';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const source: DesktopPluginMarketplaceInstallSource = {
  repository: 'example/demo-plugin',
  tagName: 'v1.0.0',
  commitSha: 'a'.repeat(40),
  assetName: 'demo.itplugin',
  assetUrl: 'https://github.com/example/demo-plugin/releases/download/v1.0.0/demo.itplugin',
  archiveBytes: 128,
  sha256: 'b'.repeat(64),
};

describe('plugin provenance store', () => {
  it('persists marketplace source metadata independently from the signed package tree', async () => {
    const directory = await createTemporaryDirectory();
    const statePath = join(directory, 'installed', '.plugin-provenance.json');
    const store = new PluginProvenanceStore(statePath);
    await store.load();

    await store.set('org.example.demo', '1.0.0', source);
    const saved = await readFile(statePath, 'utf8');
    expect(saved).toContain('example/demo-plugin');
    expect(store.get('org.example.demo', '1.0.0')).toEqual(source);

    const reloaded = new PluginProvenanceStore(statePath);
    await reloaded.load();
    const loaded = reloaded.get('org.example.demo', '1.0.0');
    expect(loaded).toEqual(source);
    expect(reloaded.get('org.example.demo', '1.0.0')).not.toBe(loaded);

    await reloaded.remove('org.example.demo', '1.0.0');
    expect(reloaded.get('org.example.demo', '1.0.0')).toBeUndefined();
  });

  it('ignores malformed optional provenance entries without blocking package discovery', async () => {
    const directory = await createTemporaryDirectory();
    const statePath = join(directory, '.plugin-provenance.json');
    await writeFile(statePath, JSON.stringify({
      schemaVersion: 1,
      entries: [
        { pluginId: 'org.example.valid', version: '1.0.0', source },
        { pluginId: 'not valid', version: '1.0.0', source },
        { pluginId: 'org.example.invalid', version: '1.0.0', source: { ...source, sha256: 'bad' } },
      ],
    }));

    const store = new PluginProvenanceStore(statePath);
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.get('org.example.valid', '1.0.0')).toEqual(source);
    expect(store.get('org.example.invalid', '1.0.0')).toBeUndefined();
  });

  it('rejects invalid source metadata before writing it', async () => {
    const directory = await createTemporaryDirectory();
    const store = new PluginProvenanceStore(join(directory, '.plugin-provenance.json'));
    await store.load();

    await expect(store.set('org.example.demo', '1.0.0', {
      ...source,
      assetUrl: 'https://evil.example/demo.itplugin',
    })).rejects.toMatchObject({ code: 'invalid-source' } satisfies Partial<PluginProvenanceStoreError>);
  });

  it('accepts the GitHub release redirect host in informational metadata', async () => {
    const directory = await createTemporaryDirectory();
    const store = new PluginProvenanceStore(join(directory, '.plugin-provenance.json'));
    await store.set('org.example.demo', '1.0.0', {
      ...source,
      assetUrl: 'https://release-assets.githubusercontent.com/github-production-release-asset/demo',
    });
    expect(store.get('org.example.demo', '1.0.0')?.assetUrl).toContain('release-assets.githubusercontent.com');
  });

  it('exposes bounded store limits for lifecycle callers', () => {
    expect(pluginProvenanceStoreLimits.maximumProvenanceEntries).toBe(128);
    expect(pluginProvenanceStoreLimits.maximumProvenanceStoreBytes).toBe(512 * 1024);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-provenance-'));
  temporaryDirectories.push(directory);
  return directory;
}
