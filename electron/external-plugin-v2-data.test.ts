// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ExternalPluginV2Manifest } from '../src/shared/external-plugin-v2';
import { readExternalPluginV2ToolData } from './external-plugin-v2-data';
import { createExternalPluginV2OuiReader } from './external-plugin-v2-oui';

const pluginId = 'org.example.data-demo';
const providerId = `${pluginId}/oui`;

describe('readExternalPluginV2ToolData', () => {
  it('reads only declared provider references and returns bounded JSON data', async () => {
    const reader = createReader({ '203706': 'Example vendor' });
    const manifest = createManifest();

    await expect(readExternalPluginV2ToolData(
      manifest,
      manifest.contributions.tools[0]!,
      { address: '20:37:06:12:34:56' },
      reader,
      new AbortController().signal,
    )).resolves.toEqual({
      [providerId]: { vendor: 'Example vendor', dataVersion: '1.2.0' },
    });
  });

  it('rejects an invalid query before reading provider data', async () => {
    const reader = createReader({ '203706': 'Example vendor' });
    const manifest = createManifest();

    await expect(readExternalPluginV2ToolData(
      manifest,
      manifest.contributions.tools[0]!,
      { address: 'not-a-mac' },
      reader,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'query-invalid' });
  });

  it('applies the provider declared response limit', async () => {
    const reader = createReader({ '203706': 'Example vendor' });
    const manifest = {
      ...createManifest(),
      contributions: {
        ...createManifest().contributions,
        dataProviders: [{
          id: providerId,
          label: 'OUI data',
          description: 'Lookup vendor data.',
          kind: 'oui.vendor' as const,
          version: '1.2.0',
          schemaVersion: 1,
          maxBytes: 1,
        }],
      },
    } satisfies ExternalPluginV2Manifest;

    await expect(readExternalPluginV2ToolData(
      manifest,
      manifest.contributions.tools[0]!,
      { address: '20:37:06:12:34:56' },
      reader,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'resource-limit' });
  });
});

function createManifest(): ExternalPluginV2Manifest {
  return {
    formatVersion: 2,
    id: pluginId,
    name: 'Data demo',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    requestedCapabilities: ['data.oui'],
    activationEvents: [`onTool:${pluginId}/lookup`],
    contributions: {
      tools: [{
        id: `${pluginId}/lookup`,
        title: 'Lookup',
        description: 'Lookup OUI data.',
        keywords: ['oui'],
        categoryId: 'development',
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: ['data.oui'],
        dataProviders: [{ id: providerId, queryInputId: 'address' }],
        inputs: [{ kind: 'text', id: 'address', label: 'MAC address' }],
        output: { kind: 'json' },
      }],
      commands: [],
      dataProviders: [{
        id: providerId,
        label: 'OUI data',
        description: 'Lookup vendor data.',
        kind: 'oui.vendor',
        version: '1.2.0',
        schemaVersion: 1,
        maxBytes: 1024,
      }],
    },
  };
}

function createReader(records: Record<string, string>) {
  const content = `${JSON.stringify(records)}\n`;
  const bytes = Buffer.from(content, 'utf8');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const file = `oui-203-${hash.slice(0, 16)}.json`;
  const resources = new Map<string, Uint8Array>([
    ['manifest.json', Buffer.from(JSON.stringify({
      schemaVersion: 1,
      dataVersion: '1.2.0',
      recordCount: Object.keys(records).length,
      shards: [{ prefix: '203', file, sha256: hash, recordCount: Object.keys(records).length, rawBytes: bytes.length, gzipBytes: bytes.length }],
    }))],
    [file, bytes],
  ]);
  return createExternalPluginV2OuiReader({
    readResource: async path => resources.get(path)!,
  });
}
