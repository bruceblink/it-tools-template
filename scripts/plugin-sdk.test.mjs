import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sdkRoot = resolve(repositoryRoot, 'plugins', 'sdk');

test('plugin SDK declarations are self-contained and expose the current capability contract', async () => {
  const [runtimeTypes, packageTypes, capabilityTypes, versionTypes, hostVersionSource, sampleManifest] = await Promise.all([
    readFile(resolve(sdkRoot, 'it-tools-plugin.d.ts'), 'utf8'),
    readFile(resolve(sdkRoot, 'it-tools-plugin-package.d.ts'), 'utf8'),
    readFile(resolve(sdkRoot, 'plugin-capabilities.d.ts'), 'utf8'),
    readFile(resolve(sdkRoot, 'plugin-api-version.d.ts'), 'utf8'),
    readFile(resolve(repositoryRoot, 'src', 'shared', 'plugin-api-version.ts'), 'utf8'),
    readFile(resolve(repositoryRoot, 'plugins', 'capability-demo', 'plugin.source.json'), 'utf8'),
  ]);

  assert.match(runtimeTypes, /from '\.\/plugin-capabilities';/);
  assert.match(runtimeTypes, /from '\.\/plugin-api-version';/);
  assert.match(packageTypes, /from '\.\/plugin-capabilities';/);
  assert.doesNotMatch(runtimeTypes, /src\/shared\/plugin-capabilities/);
  assert.doesNotMatch(runtimeTypes, /src\/shared\/plugin-api-version/);
  assert.doesNotMatch(packageTypes, /src\/shared\/plugin-capabilities/);

  const version = /pluginApiV1Version = '([^']+)'/.exec(hostVersionSource)?.[1];
  assert.ok(version, 'the host API version source must expose a stable literal');
  assert.match(versionTypes, new RegExp(`export type PluginApiV1Version = '${version}';`));
  assert.match(runtimeTypes, /apiVersion: PluginApiV1Version;/);
  assert.match(runtimeTypes, /hostApiVersion: PluginApiV1Version;/);
  const manifest = JSON.parse(sampleManifest);
  assert.equal(manifest.apiVersion.minInclusive, version);

  for (const capability of [
    'clipboard.write',
    'data.oui',
    'device.camera',
    'file.read',
    'file.save',
    'runtime.info',
    'settings.read',
    'settings.write',
  ]) {
    assert.match(capabilityTypes, new RegExp(`'${capability.replace('.', '\\.')}'`));
  }
  for (const capability of ['runtime.info', 'clipboard.write', 'settings.read', 'settings.write']) {
    assert.match(capabilityTypes, new RegExp(`'${capability.replace('.', '\\.')}'`));
  }
});
