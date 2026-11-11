// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createExternalPluginV2OuiReader,
  type ExternalPluginV2OuiResourceReader,
} from './external-plugin-v2-oui';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('ExternalPluginV2OuiReader', () => {
  it('loads a verified shard and resolves the most specific OUI record', async () => {
    const fixture = createFixture({
      '203706': 'Six digit vendor',
      '2037061': 'Seven digit vendor',
      '203706123': 'Nine digit vendor',
    });
    const reader = createExternalPluginV2OuiReader({ readResource: fixture.readResource });

    await expect(reader.findVendor('20:37:06:12:34:56')).resolves.toEqual({
      vendor: 'Nine digit vendor',
      dataVersion: '1.2.0',
    });
    await expect(reader.findVendor('FF:FF:FF:FF:FF:FF')).resolves.toEqual({
      vendor: null,
      dataVersion: '1.2.0',
    });
  });

  it('rejects malformed queries with a stable error code', async () => {
    const fixture = createFixture({ '203706': 'Vendor' });
    const reader = createExternalPluginV2OuiReader({ readResource: fixture.readResource });

    await expect(reader.findVendor('203706123456')).rejects.toMatchObject({
      code: 'invalid-query',
    });
  });

  it('rejects a shard whose bytes do not match the manifest hash', async () => {
    const fixture = createFixture({ '203706': 'Vendor' });
    const manifest = fixture.resources.get('manifest.json')!;
    const parsedManifest = JSON.parse(new TextDecoder().decode(manifest)) as { shards: Array<{ file: string }> };
    fixture.resources.set(parsedManifest.shards[0]!.file, Buffer.from('{"203706":"VendoX"}\n'));
    const reader = createExternalPluginV2OuiReader({ readResource: fixture.readResource });

    await expect(reader.findVendor('20-37-06-12-34-56')).rejects.toMatchObject({
      code: 'integrity-mismatch',
    });
  });

  it('rejects an escaped manifest path before calling the resource reader', async () => {
    const calls: string[] = [];
    const manifest = JSON.stringify({
      schemaVersion: 1,
      dataVersion: '1.2.0',
      recordCount: 1,
      shards: [{
        prefix: '203',
        file: '../outside.json',
        sha256: 'a'.repeat(64),
        recordCount: 1,
        rawBytes: 32,
        gzipBytes: 10,
      }],
    });
    const reader = createExternalPluginV2OuiReader({
      readResource: async path => {
        calls.push(path);
        return Buffer.from(manifest);
      },
    });

    await expect(reader.findVendor('20:37:06:12:34:56')).rejects.toMatchObject({
      code: 'manifest-invalid',
    });
    expect(calls).toEqual(['manifest.json']);
  });

  it('rejects oversized resources and non-canonical base directories', async () => {
    const fixture = createFixture({ '203706': 'Vendor' });
    const oversizedReader = createExternalPluginV2OuiReader({
      readResource: async (path, maximumBytes) => path === 'manifest.json'
        ? fixture.resources.get(path)!
        : new Uint8Array(maximumBytes + 1),
    });
    await expect(oversizedReader.findVendor('20:37:06:12:34:56')).rejects.toMatchObject({
      code: 'resource-limit',
    });

    const root = await mkdtemp(join(tmpdir(), 'it-tools-v2-oui-'));
    temporaryDirectories.push(root);
    const link = `${root}-link`;
    await symlink(root, link, 'dir');
    const fileReader = createExternalPluginV2OuiReader({ baseDirectory: link });
    await expect(fileReader.findVendor('20:37:06:12:34:56')).rejects.toMatchObject({
      code: 'path-invalid',
    });
  });

  it('maps an unresponsive resource to timeout', async () => {
    const fixture = createFixture({ '203706': 'Vendor' });
    const reader = createExternalPluginV2OuiReader({
      timeoutMs: 5,
      readResource: async path => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return fixture.resources.get(path)!;
      },
    });

    await expect(reader.findVendor('20:37:06:12:34:56')).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});

function createFixture(records: Record<string, string>): {
  resources: Map<string, Uint8Array>;
  readResource: ExternalPluginV2OuiResourceReader;
} {
  const content = `${JSON.stringify(records)}\n`;
  const bytes = Buffer.from(content, 'utf8');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const file = `oui-203-${hash.slice(0, 16)}.json`;
  const manifest = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    dataVersion: '1.2.0',
    recordCount: Object.keys(records).length,
    shards: [{
      prefix: '203',
      file,
      sha256: hash,
      recordCount: Object.keys(records).length,
      rawBytes: bytes.byteLength,
      gzipBytes: bytes.byteLength,
    }],
  }), 'utf8');
  const resources = new Map<string, Uint8Array>([
    ['manifest.json', manifest],
    [file, bytes],
  ]);
  return {
    resources,
    readResource: async (path, maximumBytes, signal) => {
      if (signal.aborted) {
        throw new Error('aborted');
      }
      const value = resources.get(path);
      if (!value) {
        throw new Error(`missing resource: ${path}`);
      }
      if (value.byteLength > maximumBytes) {
        return new Uint8Array(maximumBytes + 1);
      }
      return value;
    },
  };
}
