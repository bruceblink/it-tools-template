// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractPluginSourceArchive,
  PluginSourceArchiveError,
} from './plugin-source-archive';

interface TarFixtureEntry {
  readonly name: string;
  readonly contents?: Uint8Array | string;
  readonly type?: string;
  readonly mode?: number;
}

const temporaryDirectories: string[] = [];
const tarBlockBytes = 512;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'it-tools-plugin-source-archive-test-'));
  temporaryDirectories.push(path);
  return path;
}

async function writeArchive(root: string, entries: readonly TarFixtureEntry[]): Promise<string> {
  const path = join(root, 'source.tar.gz');
  await writeFile(path, gzipSync(createTar(entries)));
  return path;
}

function createTar(entries: readonly TarFixtureEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const contents = typeof entry.contents === 'string'
      ? Buffer.from(entry.contents)
      : Buffer.from(entry.contents ?? new Uint8Array());
    const header = Buffer.alloc(tarBlockBytes);
    writeField(header, 0, 100, entry.name);
    writeField(header, 100, 8, (entry.mode ?? (entry.type === '5' ? 0o755 : 0o644)).toString(8));
    writeField(header, 108, 8, '0');
    writeField(header, 116, 8, '0');
    writeField(header, 124, 12, contents.length.toString(8));
    writeField(header, 136, 12, '0');
    header.fill(0x20, 148, 156);
    header[156] = (entry.type ?? '0').charCodeAt(0);
    writeField(header, 257, 6, 'ustar\0');
    writeField(header, 263, 2, '00');
    const checksum = header.reduce((total, value) => total + value, 0);
    writeField(header, 148, 8, `${checksum.toString(8)}\0 `);
    blocks.push(header);
    if (contents.length > 0) {
      blocks.push(contents);
      const padding = (tarBlockBytes - (contents.length % tarBlockBytes)) % tarBlockBytes;
      if (padding > 0) {
        blocks.push(Buffer.alloc(padding));
      }
    }
  }
  blocks.push(Buffer.alloc(tarBlockBytes), Buffer.alloc(tarBlockBytes));
  return Buffer.concat(blocks);
}

function writeField(target: Buffer, offset: number, width: number, value: string): void {
  target.write(value, offset, width, 'ascii');
}

describe('secure plugin source archive extraction', () => {
  it('strips the GitHub wrapper directory and returns the source root', async () => {
    const root = await createTempRoot();
    const archive = await writeArchive(root, [
      { name: 'example-plugin-abcdef/', type: '5' },
      { name: 'example-plugin-abcdef/plugin.source.json', contents: '{}' },
      { name: 'example-plugin-abcdef/index.html', contents: '<!doctype html>' },
    ]);

    const result = await extractPluginSourceArchive(archive, root);

    expect(result.rootDirectory).toBe('example-plugin-abcdef');
    expect(result.entryCount).toBe(3);
    expect(result.fileCount).toBe(2);
    expect(result.expandedBytes).toBe(2 + '<!doctype html>'.length);
    expect(await readFile(join(result.sourceDirectory, 'plugin.source.json'), 'utf8')).toBe('{}');
    expect(await readFile(join(result.sourceDirectory, 'index.html'), 'utf8')).toBe('<!doctype html>');
    expect((await readdir(root)).filter(name => name.startsWith('.it-tools-plugin-source-'))).toHaveLength(1);
  });

  it('accepts an archive whose manifest is already at the root', async () => {
    const root = await createTempRoot();
    const archive = await writeArchive(root, [
      { name: 'plugin.source.json', contents: '{}' },
    ]);

    const result = await extractPluginSourceArchive(archive, root);

    expect(result.rootDirectory).toBe('');
    expect(result.sourceDirectory).toMatch(/\.it-tools-plugin-source-/);
    expect(await readFile(join(result.sourceDirectory, 'plugin.source.json'), 'utf8')).toBe('{}');
  });

  it.each([
    ['../plugin.source.json', 'unsafe path'],
    ['/plugin.source.json', 'absolute path'],
    ['dir\\plugin.source.json', 'backslash path'],
  ])('rejects %s (%s) and removes the staging directory', async name => {
    const root = await createTempRoot();
    const archive = await writeArchive(root, [{ name, contents: '{}' }]);

    await expect(extractPluginSourceArchive(archive, root)).rejects.toMatchObject({
      code: 'archive-unsafe-entry',
    } satisfies Partial<PluginSourceArchiveError>);
    expect((await readdir(root)).filter(entry => entry.startsWith('.it-tools-plugin-source-'))).toEqual([]);
  });

  it.each([
    ['2', 'symbolic link'],
    ['1', 'hard link'],
    ['3', 'character device'],
    ['4', 'block device'],
    ['6', 'fifo'],
    ['x', 'unknown special entry'],
  ])('rejects %s entries (%s)', async type => {
    const root = await createTempRoot();
    const archive = await writeArchive(root, [
      { name: 'plugin.source.json', contents: '{}' },
      { name: 'unsafe', type },
    ]);

    await expect(extractPluginSourceArchive(archive, root)).rejects.toMatchObject({
      code: 'archive-unsafe-entry',
    } satisfies Partial<PluginSourceArchiveError>);
  });

  it('rejects duplicate paths that differ only by case', async () => {
    const root = await createTempRoot();
    const archive = await writeArchive(root, [
      { name: 'plugin.source.json', contents: '{}' },
      { name: 'Readme.md', contents: 'one' },
      { name: 'README.md', contents: 'two' },
    ]);

    await expect(extractPluginSourceArchive(archive, root)).rejects.toMatchObject({
      code: 'archive-unsafe-entry',
    } satisfies Partial<PluginSourceArchiveError>);
  });

  it('enforces file and expanded byte limits before writing unbounded data', async () => {
    const root = await createTempRoot();
    const archive = await writeArchive(root, [
      { name: 'plugin.source.json', contents: '{}' },
      { name: 'large.txt', contents: '123456789' },
    ]);

    await expect(extractPluginSourceArchive(archive, root, {
      limits: { maximumFileBytes: 4 },
    })).rejects.toMatchObject({ code: 'archive-resource-limit' });
    expect((await readdir(root)).filter(entry => entry.startsWith('.it-tools-plugin-source-'))).toEqual([]);
  });

  it('enforces the compression ratio limit', async () => {
    const root = await createTempRoot();
    const archive = await writeArchive(root, [
      { name: 'plugin.source.json', contents: '{}' },
      { name: 'repeated.txt', contents: 'a'.repeat(8_000) },
    ]);

    await expect(extractPluginSourceArchive(archive, root, {
      limits: { maximumCompressionRatio: 2 },
    })).rejects.toMatchObject({ code: 'archive-resource-limit' });
  });

  it('requires the exact root plugin.source.json path', async () => {
    const root = await createTempRoot();
    const archive = await writeArchive(root, [
      { name: 'wrapper/', type: '5' },
      { name: 'wrapper/Plugin.source.json', contents: '{}' },
    ]);

    await expect(extractPluginSourceArchive(archive, root)).rejects.toMatchObject({ code: 'archive-invalid' });
  });

  it('honors an already-aborted signal and leaves no staging directory', async () => {
    const root = await createTempRoot();
    const archive = await writeArchive(root, [{ name: 'plugin.source.json', contents: '{}' }]);
    const controller = new AbortController();
    controller.abort();

    await expect(extractPluginSourceArchive(archive, root, { signal: controller.signal })).rejects.toMatchObject({
      code: 'archive-cancelled',
    } satisfies Partial<PluginSourceArchiveError>);
    expect((await readdir(root)).filter(entry => entry.startsWith('.it-tools-plugin-source-'))).toEqual([]);
  });
});
