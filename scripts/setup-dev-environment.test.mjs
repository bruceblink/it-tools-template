import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertSupportedRuntime,
  createElectronInstallEnvironment,
  electronExecutableRelativePath,
  electronExecutablePath,
  hasConfiguredProxy,
  isElectronInstalled,
  parsePnpmVersion,
} from './setup-dev-environment.mjs';

test('parses pnpm versions from package-manager user agents and plain output', () => {
  assert.equal(parsePnpmVersion('pnpm/12.16.1 npm/? node/v24.0.0 linux x64'), '12.16.1');
  assert.equal(parsePnpmVersion('12.16.1'), '12.16.1');
  assert.equal(parsePnpmVersion('npm/11.0.0'), null);
});

test('recognizes configured HTTP(S) proxies without requiring one', () => {
  assert.equal(hasConfiguredProxy({ HTTP_PROXY: 'http://proxy.example.test:8080' }), true);
  assert.equal(hasConfiguredProxy({ https_proxy: '  ' }), false);
  assert.equal(hasConfiguredProxy({}), false);
  assert.equal(createElectronInstallEnvironment({ HTTPS_PROXY: 'http://proxy.example.test:8080' }).ELECTRON_GET_USE_PROXY, '1');
  assert.equal(createElectronInstallEnvironment({ ELECTRON_GET_USE_PROXY: '0', HTTP_PROXY: 'http://proxy.example.test:8080' }).ELECTRON_GET_USE_PROXY, '0');
});

test('maps Electron executable locations for supported desktop platforms', () => {
  assert.equal(electronExecutableRelativePath('linux'), 'electron');
  assert.equal(electronExecutableRelativePath('win32'), path.join('electron.exe'));
  assert.equal(electronExecutableRelativePath('darwin'), path.join('Electron.app', 'Contents', 'MacOS', 'Electron'));
  assert.equal(electronExecutableRelativePath('aix'), null);
});

test('checks a repository-local Electron runtime without invoking a downloader', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'it-tools-environment-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const electronDirectory = path.join(root, 'node_modules', 'electron');
  await mkdir(path.join(electronDirectory, 'dist'), { recursive: true });
  await writeFile(path.join(electronDirectory, 'package.json'), '{}');
  await writeFile(path.join(electronDirectory, 'path.txt'), 'electron\n');
  const executable = electronExecutablePath({ root, platform: 'linux', environment: {} });
  assert.equal(isElectronInstalled({ root, platform: 'linux', environment: {} }), false);
  await writeFile(executable, 'binary');
  assert.equal(isElectronInstalled({ root, platform: 'linux', environment: {} }), true);
});

test('rejects unsupported runtime versions with actionable setup commands', () => {
  assert.throws(() => assertSupportedRuntime({ nodeVersion: '23.0.0', pnpmVersion: '12.16.1' }), /Node\.js/);
  assert.throws(() => assertSupportedRuntime({ nodeVersion: '24.0.0', pnpmVersion: '11.25.0' }), /corepack pnpm setup:dev/);
  assert.doesNotThrow(() => assertSupportedRuntime({ nodeVersion: '24.0.0', pnpmVersion: '12.16.1' }));
});
