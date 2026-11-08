// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  downloadPluginSourceSnapshot,
  PluginSourceSnapshotError,
  type PluginSourceSnapshotInput,
} from './plugin-source-snapshot';

const temporaryDirectories: string[] = [];
const repository: PluginSourceSnapshotInput = {
  owner: 'example',
  name: 'demo-plugin',
  commitSha: 'a'.repeat(40),
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function createFetchMock(options: {
  readonly archive: Uint8Array;
  readonly responseUrl?: string;
  readonly omitContentLength?: boolean;
  readonly topics?: readonly string[];
  readonly commit?: string;
}) {
  const archiveUrl = 'https://codeload.github.com/example/demo-plugin/tar.gz/' + repository.commitSha;
  const calls: string[] = [];
  const fetcher = async (url: string, _init?: RequestInit): Promise<Response> => {
    calls.push(url);
    if (url.endsWith('/repos/example/demo-plugin')) {
      return new Response(JSON.stringify({
        full_name: 'example/demo-plugin',
        html_url: 'https://github.com/example/demo-plugin',
        archived: false,
        disabled: false,
        fork: false,
        topics: options.topics ?? ['it-tools-plugin'],
      }));
    }
    if (url.endsWith(`/commits/${repository.commitSha}`)) {
      return new Response(JSON.stringify({ sha: options.commit ?? repository.commitSha }));
    }
    if (url === archiveUrl) {
      const response = new Response(Buffer.from(options.archive), {
        status: 200,
        headers: options.omitContentLength ? undefined : { 'content-length': String(options.archive.byteLength) },
      });
      Object.defineProperty(response, 'url', { value: options.responseUrl ?? archiveUrl });
      return response;
    }
    return new Response('not found', { status: 404 });
  };
  return { fetcher, calls };
}

async function createTempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-source-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('GitHub source snapshot downloader', () => {
  it('pins the repository commit, returns a bounded archive, and cleans it up', async () => {
    const tempRoot = await createTempRoot();
    const archive = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]);
    const { fetcher, calls } = createFetchMock({ archive });
    let archivePath = '';
    const result = await downloadPluginSourceSnapshot(repository, {
      tempRoot,
      fetch: fetcher,
      processArchive: async (path, source) => {
        archivePath = path;
        expect(await readFile(path)).toEqual(Buffer.from(archive));
        expect(source.commitSha).toBe(repository.commitSha);
        return { accepted: true };
      },
    });
    expect(result.value).toEqual({ accepted: true });
    expect(result.source).toMatchObject({
      repository: 'example/demo-plugin',
      commitSha: repository.commitSha,
      archiveBytes: archive.byteLength,
      sha256: createHash('sha256').update(archive).digest('hex'),
    });
    expect(calls).toEqual([
      'https://api.github.com/repos/example/demo-plugin',
      `https://api.github.com/repos/example/demo-plugin/commits/${repository.commitSha}`,
      `https://codeload.github.com/example/demo-plugin/tar.gz/${repository.commitSha}`,
    ]);
    expect(archivePath).toContain('.it-tools-plugin-source-');
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('accepts a chunked archive without content-length', async () => {
    const tempRoot = await createTempRoot();
    const archive = new Uint8Array([0x1f, 0x8b, 0x08]);
    const { fetcher } = createFetchMock({ archive, omitContentLength: true });
    await expect(downloadPluginSourceSnapshot(repository, {
      tempRoot,
      fetch: fetcher,
      processArchive: async () => 'ok',
    })).resolves.toMatchObject({ source: { archiveBytes: archive.byteLength } });
  });

  it('rejects a repository without the plugin topic', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({ archive: new Uint8Array([0x1f, 0x8b]), topics: ['utilities'] });
    await expect(downloadPluginSourceSnapshot(repository, {
      tempRoot,
      fetch: fetcher,
      processArchive: async () => 'unreachable',
    })).rejects.toMatchObject({ code: 'source-invalid-repository' } satisfies Partial<PluginSourceSnapshotError>);
  });

  it('rejects a commit response that does not match the requested SHA', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({ archive: new Uint8Array([0x1f, 0x8b]), commit: 'b'.repeat(40) });
    await expect(downloadPluginSourceSnapshot(repository, {
      tempRoot,
      fetch: fetcher,
      processArchive: async () => 'unreachable',
    })).rejects.toMatchObject({ code: 'source-commit-not-found' });
  });

  it('rejects redirects outside approved GitHub download hosts and cleans up', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({
      archive: new Uint8Array([0x1f, 0x8b]),
      responseUrl: 'https://evil.example/source.tar.gz',
    });
    await expect(downloadPluginSourceSnapshot(repository, {
      tempRoot,
      fetch: fetcher,
      processArchive: async () => 'unreachable',
    })).rejects.toMatchObject({ code: 'source-download-failed' });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('rejects non-gzip content before exposing it to the consumer', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({ archive: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) });
    await expect(downloadPluginSourceSnapshot(repository, {
      tempRoot,
      fetch: fetcher,
      processArchive: async () => 'unreachable',
    })).rejects.toMatchObject({ code: 'source-download-failed' });
  });

  it('cleans the archive when the consumer fails', async () => {
    const tempRoot = await createTempRoot();
    const { fetcher } = createFetchMock({ archive: new Uint8Array([0x1f, 0x8b, 0x08]) });
    await expect(downloadPluginSourceSnapshot(repository, {
      tempRoot,
      fetch: fetcher,
      processArchive: async () => {
        throw new Error('consumer failed');
      },
    })).rejects.toThrow('consumer failed');
    expect(await readdir(tempRoot)).toEqual([]);
  });
});
