// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PluginSettingsStore,
  PluginSettingsStoreError,
  pluginSettingsLimits,
} from './plugin-settings-store';

describe('PluginSettingsStore', () => {
  it('namespaces values by plugin and persists writes and deletes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-plugin-settings-'));
    try {
      const statePath = join(root, 'plugins', 'settings.json');
      const store = new PluginSettingsStore(statePath);
      await store.load();
      await expect(store.read('org.example.one', 'note')).resolves.toBeUndefined();
      await store.write('org.example.one', 'note', 'one');
      await store.write('org.example.two', 'note', 'two');
      await expect(store.read('org.example.one', 'note')).resolves.toBe('one');
      await expect(store.read('org.example.two', 'note')).resolves.toBe('two');
      await expect(store.delete('org.example.one', 'note')).resolves.toEqual({ deleted: true });
      await expect(store.delete('org.example.one', 'note')).resolves.toEqual({ deleted: false });

      const reloaded = new PluginSettingsStore(statePath);
      await reloaded.load();
      await expect(reloaded.read('org.example.one', 'note')).resolves.toBeUndefined();
      await expect(reloaded.read('org.example.two', 'note')).resolves.toBe('two');
    }
    finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serializes concurrent updates without losing a plugin value', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-plugin-settings-'));
    try {
      const store = new PluginSettingsStore(join(root, 'settings.json'));
      await store.load();
      await Promise.all([
        store.write('org.example.sample', 'first', '1'),
        store.write('org.example.sample', 'second', '2'),
      ]);
      await expect(store.read('org.example.sample', 'first')).resolves.toBe('1');
      await expect(store.read('org.example.sample', 'second')).resolves.toBe('2');
    }
    finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects invalid keys, values, and per-plugin limits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-plugin-settings-'));
    try {
      const store = new PluginSettingsStore(join(root, 'settings.json'));
      await store.load();
      await expect(store.write('org.example.sample', 'bad key', 'value')).rejects.toMatchObject({ code: 'invalid-key' });
      await expect(store.write('org.example.sample', 'note', 'x'.repeat(pluginSettingsLimits.maximumStringCharacters + 1)))
        .rejects.toMatchObject({ code: 'invalid-value' });
      await expect(store.write('org.example.sample', 'note', Number.NaN)).rejects.toMatchObject({ code: 'invalid-value' });
      for (let index = 0; index < pluginSettingsLimits.maximumValuesPerPlugin; index += 1) {
        await store.write('org.example.sample', `key-${index}`, index);
      }
      await expect(store.write('org.example.sample', 'one-too-many', true)).rejects.toMatchObject({ code: 'resource-limit' });
    }
    finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not accept a corrupted store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-plugin-settings-'));
    try {
      const statePath = join(root, 'settings.json');
      await writeFile(statePath, '{not-json', 'utf8');
      const store = new PluginSettingsStore(statePath);
      await expect(store.load()).rejects.toBeInstanceOf(PluginSettingsStoreError);
      await expect(store.load()).rejects.toMatchObject({ code: 'invalid-store' });
      await expect(readFile(statePath, 'utf8')).resolves.toBe('{not-json');
    }
    finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
