import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildResponseHeaders, loadSecurityHeaderConfig } from '../scripts/sync-security-headers.mjs';
import { buildElectronSecurityHeaders, getSafeExternalUrl, isTrustedRendererUrl, resolveRendererFile } from './security';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function createRendererRoot() {
  const root = await mkdtemp(join(tmpdir(), 'it-tools-electron-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<main>IT Tools</main>');
  await writeFile(join(root, 'assets', 'app.js'), 'export {};');
  return root;
}

describe('Electron renderer security boundaries', () => {
  it('accepts only the exact app or local dev origin', () => {
    expect(isTrustedRendererUrl('app://bundle/json-minify', 'app://bundle/')).toBe(true);
    expect(isTrustedRendererUrl('app://bundle.attacker.test/', 'app://bundle/')).toBe(false);
    expect(isTrustedRendererUrl('app://user@bundle/', 'app://bundle/')).toBe(false);
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/about', 'http://127.0.0.1:5173/')).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:5174/', 'http://127.0.0.1:5173/')).toBe(false);
    expect(isTrustedRendererUrl('https://127.0.0.1:5173/', 'http://127.0.0.1:5173/')).toBe(false);
  });

  it('opens only web and valid mail links outside the application', () => {
    expect(getSafeExternalUrl('https://example.com/docs')).toBe('https://example.com/docs');
    expect(getSafeExternalUrl('mailto:help@example.com')).toBe('mailto:help@example.com');
    expect(getSafeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(getSafeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(getSafeExternalUrl('https://user:password@example.com')).toBeNull();
    expect(getSafeExternalUrl('mailto:not-an-email')).toBeNull();
  });

  it('serves real files and falls back to the shell for history routes only', async () => {
    const root = await createRendererRoot();
    const shell = await realpath(join(root, 'index.html'));
    const asset = await realpath(join(root, 'assets', 'app.js'));

    expect(await resolveRendererFile(root, '/')).toBe(shell);
    expect(await resolveRendererFile(root, '/json-minify')).toBe(shell);
    expect(await resolveRendererFile(root, '/assets/app.js')).toBe(asset);
    expect(await resolveRendererFile(root, '/assets/missing.js')).toBeNull();
  });

  it('rejects traversal, malformed paths and symlink escapes', async () => {
    const root = await createRendererRoot();
    const outside = join(tmpdir(), `it-tools-outside-${Date.now()}.js`);
    temporaryDirectories.push(outside);
    await writeFile(outside, 'globalThis.compromised = true;');
    await symlink(outside, join(root, 'assets', 'escape.js'));

    expect(await resolveRendererFile(root, '/%2e%2e/etc/passwd')).toBeNull();
    expect(await resolveRendererFile(root, '/%2e%2e%2fsecret.js')).toBeNull();
    expect(await resolveRendererFile(root, '/assets/escape.js')).toBeNull();
    expect(await resolveRendererFile(root, '/assets%5c..%5csecret.js')).toBeNull();
    expect(await resolveRendererFile(root, '/%E0%A4%A')).toBeNull();
  });

  it('uses the same reviewed response security headers as the Web deployments', async () => {
    const config = await loadSecurityHeaderConfig();
    expect(buildElectronSecurityHeaders(config)).toEqual(buildResponseHeaders(config));
  });
});
