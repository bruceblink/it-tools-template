import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getPluginContentSecurityPolicy,
  getPluginEntryUrl,
  assertPluginSessionRoot,
  getPluginSessionPartition,
  isPluginRendererUrl,
  isValidPluginId,
} from './plugin-sandbox';
import { resolveRendererFile } from './security';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('Electron plugin renderer boundary', () => {
  it('uses stable valid IDs as unique custom-protocol origins and memory sessions', () => {
    const pluginId = 'org.it-tools.sample';
    expect(isValidPluginId(pluginId)).toBe(true);
    expect(getPluginSessionPartition(pluginId)).toBe('it-plugin-org.it-tools.sample');
    expect(getPluginSessionPartition(pluginId)).not.toContain('persist:');
    expect(getPluginEntryUrl(pluginId, 'index.html')).toBe('it-plugin://org.it-tools.sample/index.html');
    expect(isPluginRendererUrl('it-plugin://org.it-tools.sample/tools/example', pluginId)).toBe(true);
  });

  it('keeps an active plugin session bound to one package directory', () => {
    expect(() => assertPluginSessionRoot(undefined, 'C:\\plugins\\sample\\1.0.0')).not.toThrow();
    expect(() => assertPluginSessionRoot('C:\\plugins\\sample\\1.0.0', 'C:\\plugins\\sample\\1.0.0')).not.toThrow();
    expect(() => assertPluginSessionRoot('C:\\plugins\\sample\\1.0.0', 'C:\\plugins\\sample\\2.0.0')).toThrow();
  });

  it('rejects ambiguous IDs, entry paths and foreign plugin origins', () => {
    for (const pluginId of ['', 'Org.Example', 'org..example', '../escape', 'org.example/child', `${'a'.repeat(129)}`]) {
      expect(isValidPluginId(pluginId)).toBe(false);
    }
    for (const entrypoint of ['/index.html', '../index.html', 'pages/../../index.html', 'index%2ehtml', 'script.js']) {
      expect(() => getPluginEntryUrl('org.it-tools.sample', entrypoint)).toThrow();
    }
    expect(isPluginRendererUrl('it-plugin://org.it-tools.other/index.html', 'org.it-tools.sample')).toBe(false);
    expect(isPluginRendererUrl('it-plugin://user@org.it-tools.sample/index.html', 'org.it-tools.sample')).toBe(false);
    expect(isPluginRendererUrl('it-plugin://org.it-tools.sample:123/index.html', 'org.it-tools.sample')).toBe(false);
  });

  it('uses a restrictive policy with no inline or remote execution', () => {
    const policy = getPluginContentSecurityPolicy();
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('https:');
  });

  it('resolves only package-local files and rejects symlink escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-plugin-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<main>Plugin</main>');
    await writeFile(join(root, 'assets', 'plugin.js'), 'export {};');
    const outside = join(tmpdir(), `it-tools-plugin-outside-${Date.now()}.js`);
    temporaryDirectories.push(outside);
    await writeFile(outside, 'globalThis.escape = true;');
    await symlink(outside, join(root, 'assets', 'escape.js'));

    expect(await resolveRendererFile(root, '/')).toBe(await realpath(join(root, 'index.html')));
    expect(await resolveRendererFile(root, '/assets/plugin.js')).toBe(await realpath(join(root, 'assets', 'plugin.js')));
    expect(await resolveRendererFile(root, '/%2e%2e/secret.js')).toBeNull();
    expect(await resolveRendererFile(root, '/assets/escape.js')).toBeNull();
  });
});
