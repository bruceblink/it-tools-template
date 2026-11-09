// @vitest-environment node
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildPluginSourceSnapshot,
  type PluginSourceBuildPackageReport,
} from './plugin-source-build';
import { parsePluginSourceBuildArguments } from './plugin-source-build-cli';

const repository = {
  owner: 'example',
  name: 'demo-plugin',
  commitSha: 'a'.repeat(40),
};

const source = {
  repository: 'example/demo-plugin',
  commitSha: repository.commitSha,
  archiveUrl: `https://codeload.github.com/example/demo-plugin/tar.gz/${repository.commitSha}`,
  archiveBytes: 32,
  sha256: 'b'.repeat(64),
};

const buildReport: PluginSourceBuildPackageReport = {
  pluginId: 'org.example.demo',
  version: '1.0.0',
  fileCount: 2,
  expandedBytes: 128,
  typecheck: { status: 'passed', configPath: '/temporary/source/root/tsconfig.json' },
  package: {
    outputPath: '/temporary/output/demo.itxs',
    pluginId: 'org.example.demo',
    version: '1.0.0',
    archiveBytes: 256,
  },
};

describe('plugin source build orchestration', () => {
  it('pins, extracts, validates, and builds without retaining the extraction directory', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'it-tools-source-build-test-'));
    const outputPath = join(tempRoot, 'output', 'demo.itxs');
    try {
      const downloadSnapshot = vi.fn(async (_input: unknown, dependencies: any) => {
        await mkdir(dependencies.tempRoot, { recursive: true });
        const archivePath = join(dependencies.tempRoot, 'source.tar.gz');
        await writeFile(archivePath, Buffer.from('archive'));
        try {
          const value = await dependencies.processArchive(archivePath, source);
          return { value, source };
        }
        finally {
          await rm(archivePath, { force: true });
        }
      });
      const extractArchive = vi.fn(async (_archivePath: string, destinationRoot: string) => {
        await mkdir(join(destinationRoot, 'demo-a'), { recursive: true });
        return {
          sourceDirectory: join(destinationRoot, 'demo-a'),
          rootDirectory: 'demo-a',
          entryCount: 3,
          fileCount: 2,
          expandedBytes: 128,
        };
      });
      const buildWorkflow = vi.fn(async (input: any) => {
        expect(input.sourceDirectory).toMatch(/demo-a$/);
        return buildReport;
      });

      const result = await buildPluginSourceSnapshot({
        ...repository,
        privateKeyPath: '/outside/keys/publisher.private.pem',
        keyId: 'publisher',
        outputPath,
      }, {
        tempRoot,
        fetch: vi.fn(),
        downloadSnapshot,
        extractArchive,
        buildWorkflow,
      });

      expect(result.source).toEqual(source);
      expect(result.build).toEqual(buildReport);
      expect(result.build).not.toHaveProperty('sourceDirectory');
      expect(downloadSnapshot).toHaveBeenCalledOnce();
      expect(extractArchive).toHaveBeenCalledOnce();
      expect(buildWorkflow).toHaveBeenCalledOnce();
      expect((await readdir(tempRoot)).filter(name => name.startsWith('.it-tools-plugin-source-build-'))).toEqual([]);
    }
    finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('stops before downloading when the caller has cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const downloadSnapshot = vi.fn();
    await expect(buildPluginSourceSnapshot({
      ...repository,
      privateKeyPath: '/outside/keys/publisher.private.pem',
      keyId: 'publisher',
      outputPath: '/temporary/output/demo.itxs',
    }, {
      tempRoot: '/temporary',
      fetch: vi.fn(),
      signal: controller.signal,
      downloadSnapshot: downloadSnapshot as never,
    })).rejects.toMatchObject({ code: 'source-cancelled' });
    expect(downloadSnapshot).not.toHaveBeenCalled();
  });
});

describe('plugin source build CLI arguments', () => {
  it('requires an immutable commit and an external signer', () => {
    expect(parsePluginSourceBuildArguments([
      '--owner', 'example',
      '--name', 'demo-plugin',
      '--commit', 'a'.repeat(40),
      '--private-key', '../keys/publisher.private.pem',
      '--key-id', 'publisher',
      '--output', '../dist/demo.itxs',
      '--json',
    ])).toMatchObject({
      owner: 'example',
      name: 'demo-plugin',
      commitSha: 'a'.repeat(40),
      keyId: 'publisher',
      json: true,
    });
    expect(() => parsePluginSourceBuildArguments(['--owner', 'example'])).toThrow(/Missing required options/);
  });
});
