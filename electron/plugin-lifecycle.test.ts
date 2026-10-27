// @vitest-environment node
import { EventEmitter } from 'node:events';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPluginPackageSigningPayload,
  type PluginPackageFile,
  type PluginPackageSigningKey,
  type PluginPackageUnsignedManifest,
} from './plugin-package';
import {
  PluginLifecycleError,
  PluginLifecycleManager,
  pluginLifecycleLimits,
  verifyInstalledPluginPackage,
} from './plugin-lifecycle';
import type { PluginSandboxRegistration } from './plugin-sandbox';

const pluginId = 'org.example.sandbox';
const pluginIds = [pluginId, 'org.example.plugin-1', 'org.example.plugin-2', 'org.example.plugin-3', 'org.example.plugin-4'];
const installRootNames: string[] = [];
const signingPair = generateKeyPairSync('ed25519');
const trustedSigningKeys = new Map<string, PluginPackageSigningKey>([
  ['test-key', { publicKey: signingPair.publicKey, allowedPluginIds: pluginIds }],
]);

class FakePluginWindow extends EventEmitter {
  readonly webContents = Object.assign(new EventEmitter(), {
    executeJavaScript: vi.fn(async (_script: string) => undefined),
  });

  private destroyed = false;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    if (!this.destroyed) {
      this.destroyed = true;
      this.emit('closed');
    }
  }
}

afterEach(async () => {
  await Promise.all(installRootNames.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('Electron plugin lifecycle manager', () => {
  it('stages signed packages without activating them', async () => {
    const { root, manager } = await createManager();
    const archivePath = await writeArchive(root, '1.0.0');

    const installed = await manager.installArchive(archivePath);
    expect(installed).toMatchObject({
      pluginId,
      name: 'Lifecycle fixture',
      version: '1.0.0',
      status: 'installed',
      supportedCapabilities: ['runtime.info', 'clipboard.write', 'settings.read', 'settings.write'],
      grantedCapabilities: [],
    });
    expect(await manager.listInstalled()).toEqual([installed]);
  });

  it('starts a package that declares a known capability not implemented by this host', async () => {
    const { root, manager, createWindow } = await createManager();
    await manager.installArchive(await writeArchive(root, '1.0.0', ['file.read']));

    await expect(manager.activate(pluginId, '1.0.0', [])).resolves.toMatchObject({
      status: 'active',
      requestedCapabilities: ['file.read'],
      grantedCapabilities: [],
    });
    expect(createWindow.mock.calls[0]?.[0].requestedCapabilities).toEqual(['file.read']);
  });

  it('rechecks every signed file before creating a plugin window', async () => {
    const { root, installRoot, manager, createWindow } = await createManager();
    const archivePath = await writeArchive(root, '1.0.0');
    await manager.installArchive(archivePath);
    await writeFile(join(installRoot, pluginId, '1.0.0', 'index.html'), '<main>tampered</main>');

    await expect(manager.activate(pluginId, '1.0.0', [])).rejects.toMatchObject({ code: 'file-hash-mismatch' });
    expect(createWindow).not.toHaveBeenCalled();
  });

  it('grants only requested host-supported capabilities and revokes them on disable', async () => {
    const { root, manager, createWindow, windows } = await createManager();
    const archivePath = await writeArchive(root, '1.0.0', ['runtime.info', 'clipboard.write']);
    await manager.installArchive(archivePath);

    await expect(manager.activate(pluginId, '1.0.0', ['file.read']))
      .rejects.toBeInstanceOf(PluginLifecycleError);
    expect(createWindow).not.toHaveBeenCalled();

    const active = await manager.activate(pluginId, '1.0.0', ['runtime.info']);
    expect(active).toMatchObject({ status: 'active', grantedCapabilities: ['runtime.info'] });
    expect(createWindow.mock.calls[0]?.[0].grantedCapabilities).toEqual(['runtime.info']);
    expect((await manager.listInstalled())[0]).toMatchObject({ status: 'active', grantedCapabilities: ['runtime.info'] });

    await expect(manager.disable(pluginId)).resolves.toBe(true);
    expect(windows[0]?.isDestroyed()).toBe(true);
    expect((await manager.listInstalled())[0]).toMatchObject({ status: 'installed', grantedCapabilities: [] });
    await expect(manager.disable(pluginId)).resolves.toBe(false);
  });

  it('passes a declared contribution to the isolated window and rejects unknown contributions', async () => {
    const { root, manager, createWindow } = await createManager();
    await manager.installArchive(await writeArchive(root, '1.0.0'));

    await expect(manager.activate(pluginId, '1.0.0', [], `${pluginId}/missing-tool`))
      .rejects.toMatchObject({ code: 'contribution-not-found' });
    expect(createWindow).not.toHaveBeenCalled();

    await expect(manager.activate(pluginId, '1.0.0', [], `${pluginId}/lifecycle-tool`))
      .resolves.toMatchObject({ status: 'active' });
    expect(createWindow.mock.calls[0]?.[0].contributionId).toBe(`${pluginId}/lifecycle-tool`);
    expect(createWindow.mock.calls[0]?.[0].toolContext).toMatchObject({
      id: `${pluginId}/lifecycle-tool`,
      title: 'Lifecycle tool',
      dataProcessing: 'unspecified',
      offline: 'unknown',
      capabilities: [],
    });
    expect((await manager.listInstalled())[0]).toMatchObject({
      status: 'active',
      activeContributionId: `${pluginId}/lifecycle-tool`,
    });
  });

  it('records an unexpected window close and clears the failure after recovery', async () => {
    const { root, manager, windows, stateChanges } = await createManager();
    await manager.installArchive(await writeArchive(root, '1.0.0'));
    await manager.activate(pluginId, '1.0.0', [], `${pluginId}/lifecycle-tool`);

    windows[0]?.destroy();

    expect(stateChanges.at(-1)).toBe(pluginId);
    const failed = (await manager.listInstalled())[0];
    expect(failed).toMatchObject({
      status: 'installed',
      contributions: {
        tools: expect.arrayContaining([
          expect.objectContaining({ id: `${pluginId}/lifecycle-tool`, errorCode: 'window-closed' }),
        ]),
      },
    });
    expect(failed?.errorCode).toBeUndefined();
    expect(failed?.contributions.tools.find(tool => tool.id === `${pluginId}/recovery-tool`)).toBeDefined();
    expect(failed?.contributions.tools.find(tool => tool.id === `${pluginId}/recovery-tool`)?.errorCode).toBeUndefined();

    await manager.activate(pluginId, '1.0.0', [], `${pluginId}/lifecycle-tool`);
    expect((await manager.listInstalled())[0]).toMatchObject({
      status: 'active',
      activeContributionId: `${pluginId}/lifecycle-tool`,
    });
    expect((await manager.listInstalled())[0]?.contributions.tools.find(
      tool => tool.id === `${pluginId}/lifecycle-tool`,
    )?.errorCode).toBeUndefined();
    expect((await manager.listInstalled())[0]?.errorCode).toBeUndefined();

    await manager.disable(pluginId);
    expect((await manager.listInstalled())[0]?.errorCode).toBeUndefined();
  });

  it('keeps runtime failures isolated between tool contributions', async () => {
    const { root, manager, windows } = await createManager();
    await manager.installArchive(await writeArchive(root, '1.0.0'));
    await manager.activate(pluginId, '1.0.0', [], `${pluginId}/lifecycle-tool`);

    windows[0]?.destroy();

    const failed = (await manager.listInstalled())[0];
    expect(failed?.contributions.tools.find(tool => tool.id === `${pluginId}/lifecycle-tool`)).toMatchObject({
      errorCode: 'window-closed',
    });
    expect(failed?.contributions.tools.find(tool => tool.id === `${pluginId}/recovery-tool`)).toBeDefined();
    expect(failed?.contributions.tools.find(tool => tool.id === `${pluginId}/recovery-tool`)?.errorCode).toBeUndefined();

    await manager.activate(pluginId, '1.0.0', [], `${pluginId}/recovery-tool`);
    const recovered = (await manager.listInstalled())[0];
    expect(recovered).toMatchObject({
      status: 'active',
      activeContributionId: `${pluginId}/recovery-tool`,
    });
    expect(recovered?.contributions.tools.find(tool => tool.id === `${pluginId}/lifecycle-tool`)).toMatchObject({
      errorCode: 'window-closed',
    });
    expect(recovered?.contributions.tools.find(tool => tool.id === `${pluginId}/recovery-tool`)).toBeDefined();
    expect(recovered?.contributions.tools.find(tool => tool.id === `${pluginId}/recovery-tool`)?.errorCode).toBeUndefined();
  });

  it('clears a package-level runtime failure after a contribution starts successfully', async () => {
    const { root, manager, windows } = await createManager();
    await manager.installArchive(await writeArchive(root, '1.0.0'));
    await manager.activate(pluginId, '1.0.0', []);

    windows[0]?.destroy();
    expect((await manager.listInstalled())[0]?.errorCode).toBe('window-closed');

    await manager.activate(pluginId, '1.0.0', [], `${pluginId}/lifecycle-tool`);
    const recovered = (await manager.listInstalled())[0];
    expect(recovered?.errorCode).toBeUndefined();
    expect(recovered?.contributions.tools.find(tool => tool.id === `${pluginId}/lifecycle-tool`)?.errorCode).toBeUndefined();
  });

  it('disables every active plugin that uses a revoked signing key', async () => {
    const { root, manager, windows } = await createManager();
    await manager.installArchive(await writeArchive(root, '1.0.0'));
    await manager.activate(pluginId, '1.0.0', []);

    await expect(manager.disableSignedByKey('test-key')).resolves.toBe(1);
    expect(windows[0]?.isDestroyed()).toBe(true);
    await expect(manager.disableSignedByKey('test-key')).resolves.toBe(0);
  });

  it('restores the previous version when an upgrade window fails to load', async () => {
    const { root, manager, createWindow, windows } = await createManager({
      failVersion: '2.0.0',
    });
    await manager.installArchive(await writeArchive(root, '1.0.0', ['runtime.info']));
    await manager.installArchive(await writeArchive(root, '2.0.0', ['runtime.info']));
    await manager.activate(pluginId, '1.0.0', ['runtime.info']);

    await expect(manager.activate(pluginId, '2.0.0', ['runtime.info']))
      .rejects.toMatchObject({ code: 'activation-failed' });

    const listed = await manager.listInstalled();
    expect(listed.find(item => item.version === '1.0.0')).toMatchObject({ status: 'active' });
    expect(listed.find(item => item.version === '2.0.0')).toMatchObject({ status: 'installed' });
    expect(createWindow).toHaveBeenCalledTimes(3);
    expect(windows[0]?.isDestroyed()).toBe(true);
    expect(windows).toHaveLength(2);
    expect(windows[1]?.isDestroyed()).toBe(false);
  });

  it('stops an active window and removes only the selected package version', async () => {
    const { root, installRoot, manager, windows } = await createManager();
    await manager.installArchive(await writeArchive(root, '1.0.0'));
    await manager.installArchive(await writeArchive(root, '2.0.0'));
    await manager.activate(pluginId, '1.0.0', []);

    await expect(manager.uninstall(pluginId, '1.0.0')).resolves.toBe(true);
    expect(windows[0]?.isDestroyed()).toBe(true);
    await expect(lstat(join(installRoot, pluginId, '1.0.0'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(installRoot, pluginId, '2.0.0', 'plugin.json'), 'utf8')).resolves.toContain(pluginId);
    expect((await manager.listInstalled()).map(item => item.version)).toEqual(['2.0.0']);
  });

  it('rejects a plugin directory that escapes the install root', async () => {
    const { root, installRoot } = await createManager();
    const archivePath = await writeArchive(root, '1.0.0');
    const manager = createManagerForRoot({
      installRoot,
      trustedSigningKeys,
      createWindow: async () => new FakePluginWindow() as unknown as import('electron').BrowserWindow,
    });
    await manager.installArchive(archivePath);
    const manifest = await readFile(join(installRoot, pluginId, '1.0.0', 'plugin.json'));
    await rm(join(installRoot, pluginId, '1.0.0', 'plugin.json'));
    await writeFile(join(installRoot, pluginId, '1.0.0', 'plugin.json'), manifest);

    await expect(verifyInstalledPluginPackage({
      installRoot,
      packageRoot: root,
      pluginId,
      version: '1.0.0',
      hostApiVersion: '1.2.0',
      trustedSigningKeys,
    })).rejects.toMatchObject({ code: 'unsafe-archive-entry' });
  });

  it('limits the number of active plugin windows', async () => {
    const { root, manager } = await createManager();
    for (const id of pluginIds) {
      await manager.installArchive(await writeArchive(root, '1.0.0', [], id));
    }
    for (const id of pluginIds.slice(0, 4)) {
      await manager.activate(id, '1.0.0', []);
    }

    await expect(manager.activate(pluginIds[4]!, '1.0.0', [])).rejects.toMatchObject({ code: 'active-limit' });
    await manager.disable(pluginIds[0]!);
    await expect(manager.activate(pluginIds[4]!, '1.0.0', [])).resolves.toMatchObject({ status: 'active' });
  });

  it('terminates a plugin window that remains unresponsive', async () => {
    const { root, manager, windows } = await createManager();
    await manager.installArchive(await writeArchive(root, '1.0.0'));
    await manager.activate(pluginId, '1.0.0', []);

    vi.useFakeTimers();
    try {
      windows[0]?.emit('unresponsive');
      await vi.advanceTimersByTimeAsync(pluginLifecycleLimits.unresponsiveWindowTimeoutMs);

      expect(windows[0]?.isDestroyed()).toBe(true);
      expect((await manager.listInstalled())[0]).toMatchObject({
        status: 'installed',
        errorCode: 'renderer-unresponsive',
      });
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('terminates a plugin renderer that stops answering responsiveness probes', async () => {
    const { root, manager, windows } = await createManager();
    await manager.installArchive(await writeArchive(root, '1.0.0'));
    vi.useFakeTimers();
    try {
      await manager.activate(pluginId, '1.0.0', []);
      const window = windows[0];
      if (!window) {
        throw new Error('The plugin window was not created.');
      }
      window.webContents.executeJavaScript.mockImplementation(() => new Promise<never>(() => {}));

      await vi.advanceTimersByTimeAsync(pluginLifecycleLimits.rendererResponsivenessProbeIntervalMs);
      expect(window.webContents.executeJavaScript).toHaveBeenCalledWith('void 0');
      await vi.advanceTimersByTimeAsync(pluginLifecycleLimits.rendererResponsivenessProbeTimeoutMs);

      expect(window.isDestroyed()).toBe(true);
      expect((await manager.listInstalled())[0]).toMatchObject({
        status: 'installed',
        errorCode: 'renderer-unresponsive',
      });
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('terminates a plugin window when its renderer process exits', async () => {
    const { root, manager, windows } = await createManager();
    await manager.installArchive(await writeArchive(root, '1.0.0'));
    await manager.activate(pluginId, '1.0.0', []);
    const window = windows[0];
    if (!window) {
      throw new Error('The plugin window was not created.');
    }

    window.webContents.emit('render-process-gone');

    expect(window.isDestroyed()).toBe(true);
    expect((await manager.listInstalled())[0]).toMatchObject({
      status: 'installed',
      errorCode: 'renderer-crashed',
    });
  });
});

async function createManager(options: { failVersion?: string } = {}) {
  const root = await createTemporaryDirectory();
  const installRoot = join(root, 'installed');
  const windows: FakePluginWindow[] = [];
  const stateChanges: string[] = [];
  const createWindow = vi.fn(async (registration: PluginSandboxRegistration) => {
    if (options.failVersion && registration.packageRoot.endsWith(options.failVersion)) {
      throw new Error('The test plugin did not load.');
    }
    const window = new FakePluginWindow();
    windows.push(window);
    return window as unknown as import('electron').BrowserWindow;
  });
  const manager = createManagerForRoot({
    installRoot,
    trustedSigningKeys,
    createWindow,
    onStateChange: pluginId => stateChanges.push(pluginId),
  });
  return { root, installRoot, manager, createWindow, windows, stateChanges };
}

function createManagerForRoot(options: {
  installRoot: string;
  trustedSigningKeys: ReadonlyMap<string, PluginPackageSigningKey>;
  createWindow: (registration: PluginSandboxRegistration) => Promise<import('electron').BrowserWindow>;
  onStateChange?: (pluginId: string) => void;
}) {
  return new PluginLifecycleManager({
    ...options,
    hostApiVersion: '1.2.0',
    executeCapability: (_manifest, call) => ({ capability: call.capability }),
  });
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'it-tools-plugin-lifecycle-'));
  installRootNames.push(directory);
  return directory;
}

async function writeArchive(
  root: string,
  version: string,
  requestedCapabilities: string[] = [],
  id = pluginId,
): Promise<string> {
  const archivePath = join(root, `${id}-${version}.itplugin`);
  await writeFile(archivePath, makeSignedArchive(version, requestedCapabilities, id));
  return archivePath;
}

function makeSignedArchive(version: string, requestedCapabilities: string[], id: string): Buffer {
  const signedFiles: Record<string, string> = { 'index.html': '<!doctype html><main>Lifecycle fixture</main>' };
  const files: PluginPackageFile[] = Object.entries(signedFiles).map(([path, contents]) => ({
    path,
    sha256: createHash('sha256').update(contents).digest('hex'),
  }));
  const unsignedManifest: PluginPackageUnsignedManifest = {
    formatVersion: 1,
    id,
    name: 'Lifecycle fixture',
    version,
    apiVersion: { minInclusive: '1.0.0', maxExclusive: '2.0.0' },
    entrypoint: 'index.html',
    requestedCapabilities,
    contributions: {
      tools: [{
        id: `${id}/lifecycle-tool`,
        title: 'Lifecycle tool',
        description: 'Lifecycle fixture tool.',
        keywords: ['lifecycle'],
      }, {
        id: `${id}/recovery-tool`,
        title: 'Recovery tool',
        description: 'Recovery fixture tool.',
        keywords: ['recovery'],
      }],
    },
    files,
  };
  const signature = sign(
    null,
    Buffer.from(getPluginPackageSigningPayload(unsignedManifest), 'utf8'),
    signingPair.privateKey,
  ).toString('base64');
  const manifest = {
    ...unsignedManifest,
    signature: { algorithm: 'Ed25519', keyId: 'test-key', value: signature },
  };
  return makeZip([
    { path: 'plugin.json', contents: JSON.stringify(manifest) },
    ...Object.entries(signedFiles).map(([path, contents]) => ({ path, contents })),
  ]);
}

function makeZip(entries: readonly { path: string; contents: string }[]): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const contents = Buffer.from(entry.contents, 'utf8');
    const crc = crc32(contents);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(contents.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([localHeader, name, contents]);
    localRecords.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(contents.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralRecords.push(Buffer.concat([centralHeader, name]));
    localOffset += localRecord.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
