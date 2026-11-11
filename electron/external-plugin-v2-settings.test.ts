import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExternalPluginV2Manifest } from '../src/shared/external-plugin-v2';
import { readExternalPluginV2ToolSettings } from './external-plugin-v2-settings';
import { PluginSettingsStore } from './plugin-settings-store';

const pluginId = 'org.example.settings-demo';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('readExternalPluginV2ToolSettings', () => {
  it('reads only referenced settings and falls back to typed defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-v2-settings-'));
    temporaryDirectories.push(root);
    const store = new PluginSettingsStore(join(root, 'settings.json'));
    await store.load();
    await store.write(pluginId, 'endpoint', 'https://stored.example');
    await store.write(pluginId, 'retries', 99);
    await store.write(pluginId, 'enabled', 'invalid');

    const manifest = createManifest();
    const values = await readExternalPluginV2ToolSettings(manifest, manifest.contributions.tools[0]!, store);

    expect(values).toEqual({
      [`${pluginId}/endpoint`]: 'https://stored.example',
      [`${pluginId}/retries`]: 3,
      [`${pluginId}/enabled`]: true,
    });
  });

  it('uses defaults when the settings store is unavailable', async () => {
    const store = new PluginSettingsStore('/tmp/it-tools-missing-settings/settings.json');
    const manifest = createManifest();

    await expect(readExternalPluginV2ToolSettings(manifest, manifest.contributions.tools[0]!, store)).resolves.toEqual({
      [`${pluginId}/endpoint`]: 'https://default.example',
      [`${pluginId}/retries`]: 3,
      [`${pluginId}/enabled`]: true,
    });
  });
});

function createManifest(): ExternalPluginV2Manifest {
  return {
    formatVersion: 2,
    id: pluginId,
    name: 'Settings demo',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    requestedCapabilities: ['settings.read'],
    activationEvents: ['onTool:org.example.settings-demo/settings'],
    contributions: {
      tools: [{
        id: `${pluginId}/settings`,
        title: 'Settings',
        description: 'Read settings.',
        keywords: ['settings'],
        categoryId: 'development',
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: ['settings.read'],
        settings: [
          `${pluginId}/endpoint`,
          `${pluginId}/retries`,
          `${pluginId}/enabled`,
        ],
        inputs: [],
        output: { kind: 'json' },
      }],
      commands: [],
      settings: [
        {
          id: `${pluginId}/endpoint`,
          label: 'Endpoint',
          description: 'Service endpoint.',
          type: 'string',
          defaultValue: 'https://default.example',
          maxLength: 256,
        },
        {
          id: `${pluginId}/retries`,
          label: 'Retries',
          description: 'Retry count.',
          type: 'number',
          defaultValue: 3,
          integer: true,
          minimum: 0,
          maximum: 10,
        },
        {
          id: `${pluginId}/enabled`,
          label: 'Enabled',
          description: 'Enable the tool.',
          type: 'boolean',
          defaultValue: true,
        },
      ],
    },
  };
}
