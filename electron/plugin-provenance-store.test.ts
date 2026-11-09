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
import type {
  DesktopPluginMarketplaceInstallSource,
  DesktopPluginSourceSnapshotInstallSource,
} from '../src/shared/desktop-services/plugins';

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

const sourceSnapshot: DesktopPluginSourceSnapshotInstallSource = {
  kind: 'source-snapshot',
  repository: 'example/demo-plugin',
  commitSha: 'c'.repeat(40),
  archiveUrl: 'https://codeload.github.com/example/demo-plugin/tar.gz/' + 'c'.repeat(40),
  archiveBytes: 256,
  sha256: 'd'.repeat(64),
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
    const saved = store.get('org.example.demo', '1.0.0');
    expect(saved && 'assetUrl' in saved ? saved.assetUrl : undefined).toContain('release-assets.githubusercontent.com');
  });

  it('persists fixed source snapshot provenance with a distinct source kind', async () => {
    const directory = await createTemporaryDirectory();
    const store = new PluginProvenanceStore(join(directory, '.plugin-provenance.json'));

    await store.set('org.example.demo', '1.0.0', sourceSnapshot);

    expect(store.get('org.example.demo', '1.0.0')).toEqual(sourceSnapshot);
    const reloaded = new PluginProvenanceStore(join(directory, '.plugin-provenance.json'));
    await reloaded.load();
    expect(reloaded.get('org.example.demo', '1.0.0')).toEqual(sourceSnapshot);
  });

  it('accepts GitHub repository casing returned by the API', async () => {
    const directory = await createTemporaryDirectory();
    const store = new PluginProvenanceStore(join(directory, '.plugin-provenance.json'));
    const mixedCaseSource: DesktopPluginSourceSnapshotInstallSource = {
      ...sourceSnapshot,
      repository: 'Example/Demo-plugin',
    };

    await store.set('org.example.demo', '1.0.0', mixedCaseSource);

    expect(store.get('org.example.demo', '1.0.0')).toEqual(mixedCaseSource);
  });

  it('rejects source snapshot provenance that points outside the fixed codeload URL', async () => {
    const directory = await createTemporaryDirectory();
    const store = new PluginProvenanceStore(join(directory, '.plugin-provenance.json'));

    await expect(store.set('org.example.demo', '1.0.0', {
      ...sourceSnapshot,
      archiveUrl: 'https://github.com/example/demo-plugin/archive/' + sourceSnapshot.commitSha + '.tar.gz',
    })).rejects.toMatchObject({ code: 'invalid-source' } satisfies Partial<PluginProvenanceStoreError>);
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
