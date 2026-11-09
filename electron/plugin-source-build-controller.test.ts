// @vitest-environment node
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PluginSourceBuildController,
  PluginSourceBuildControllerError,
} from './plugin-source-build-controller';
import type { PluginSourceBuildResult } from './plugin-source-build';

const temporaryDirectories: string[] = [];
const commitSha = 'a'.repeat(40);
const sourceBuild: PluginSourceBuildResult = {
  source: {
    repository: 'example/demo-plugin',
    commitSha,
    archiveUrl: `https://codeload.github.com/example/demo-plugin/tar.gz/${commitSha}`,
    archiveBytes: 256,
    sha256: 'b'.repeat(64),
  },
  extraction: {
    entryCount: 3,
    fileCount: 2,
    expandedBytes: 128,
    rootDirectory: 'demo-plugin-a',
  },
  build: {
    pluginId: 'org.example.demo',
    version: '1.0.0',
    fileCount: 2,
    expandedBytes: 128,
    typecheck: { status: 'skipped', reason: 'no-tsconfig' },
    package: {
      outputPath: '/temporary/plugin.itplugin',
      pluginId: 'org.example.demo',
      version: '1.0.0',
      archiveBytes: 512,
    },
  },
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function createTempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-source-controller-'));
  temporaryDirectories.push(directory);
  return directory;
}

function input(requestId = 'source-1') {
  return {
    requestId,
    owner: 'example',
    name: 'demo-plugin',
    commitSha,
    keyId: 'publisher',
  } as const;
}

describe('PluginSourceBuildController', () => {
  it('selects the key in the main process, installs with source provenance, and cleans temporary files', async () => {
    const tempRoot = await createTempRoot();
    const selectPrivateKey = vi.fn(async () => '/secure/publisher.private.pem');
    const installPackage = vi.fn(async (_path, source) => ({ installed: true, source }));
    const buildSnapshot = vi.fn(async (buildInput) => {
      expect(buildInput.privateKeyPath).toBe('/secure/publisher.private.pem');
      expect(buildInput.outputPath).toMatch(/plugin\.itplugin$/);
      await mkdir(buildInput.outputPath.replace(/\/plugin\.itplugin$/, ''), { recursive: true });
      return sourceBuild;
    });
    const controller = new PluginSourceBuildController({
      tempRoot,
      fetch: vi.fn(),
      selectPrivateKey,
      buildSnapshot,
      installPackage,
    });
    const phases: string[] = [];

    const result = await controller.start(input(), progress => phases.push(progress.phase));

    expect(selectPrivateKey).toHaveBeenCalledOnce();
    expect(installPackage).toHaveBeenCalledOnce();
    expect(installPackage.mock.calls[0]?.[1]).toMatchObject({ kind: 'source-snapshot', commitSha });
    expect(result.snapshot).toMatchObject({ installed: true });
    expect(result.source.kind).toBe('source-snapshot');
    expect(phases).toEqual(['selecting-key', 'building', 'installing', 'completed']);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('rejects a second build and cancels the active build', async () => {
    const tempRoot = await createTempRoot();
    let rejectBuild!: (error: Error) => void;
    const buildSnapshot = vi.fn(async (_input, dependencies) => {
      await new Promise<void>((_resolve, reject) => {
        rejectBuild = reject;
        dependencies.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return sourceBuild;
    });
    const controller = new PluginSourceBuildController({
      tempRoot,
      fetch: vi.fn(),
      selectPrivateKey: async () => '/secure/key.pem',
      buildSnapshot,
      installPackage: async () => ({ installed: true }),
    });
    const operation = controller.start(input(), () => {});
    await vi.waitFor(() => expect(buildSnapshot).toHaveBeenCalledOnce());
    expect(() => controller.start(input('source-2'), () => {})).toThrowError(PluginSourceBuildControllerError);
    expect(controller.cancel('source-2')).toBe(false);
    expect(controller.cancel('source-1')).toBe(true);
    rejectBuild(new Error('aborted'));
    await expect(operation).rejects.toMatchObject({ code: 'source-build-cancelled' });
    expect(controller.cancel('source-1')).toBe(false);
  });

  it('returns a stable cancellation result when the key chooser is closed', async () => {
    const tempRoot = await createTempRoot();
    const controller = new PluginSourceBuildController({
      tempRoot,
      fetch: vi.fn(),
      selectPrivateKey: async () => null,
      buildSnapshot: vi.fn(),
      installPackage: async () => ({ installed: true }),
    });

    await expect(controller.start(input(), () => {})).rejects.toMatchObject({
      code: 'source-build-key-cancelled',
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('keeps an external cancellation distinct while the key chooser is open', async () => {
    const tempRoot = await createTempRoot();
    let chooseKey!: (path: string | null) => void;
    const selectPrivateKey = vi.fn(() => new Promise<string | null>(resolve => {
      chooseKey = resolve;
    }));
    const controller = new PluginSourceBuildController({
      tempRoot,
      fetch: vi.fn(),
      selectPrivateKey,
      buildSnapshot: vi.fn(),
      installPackage: async () => ({ installed: true }),
    });

    const operation = controller.start(input(), () => {});
    await vi.waitFor(() => expect(selectPrivateKey).toHaveBeenCalledOnce());
    expect(controller.cancel('source-1')).toBe(true);
    chooseKey('/secure/key.pem');

    await expect(operation).rejects.toMatchObject({ code: 'source-build-cancelled' });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('waits for an active build during disposal', async () => {
    const tempRoot = await createTempRoot();
    const buildSnapshot = vi.fn(async (_input, dependencies) => {
      await new Promise<void>((_resolve, reject) => {
        dependencies.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return sourceBuild;
    });
    const controller = new PluginSourceBuildController({
      tempRoot,
      fetch: vi.fn(),
      selectPrivateKey: async () => '/secure/key.pem',
      buildSnapshot,
      installPackage: async () => ({ installed: true }),
    });
    const operation = controller.start(input('source-dispose'), () => {});
    await vi.waitFor(() => expect(buildSnapshot).toHaveBeenCalledOnce());
    await controller.dispose();
    await expect(operation).rejects.toMatchObject({ code: 'source-build-cancelled' });
    expect(controller.cancel('source-dispose')).toBe(false);
  });
});
