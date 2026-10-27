import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sdkRoot = resolve(repositoryRoot, 'plugins', 'sdk');

test('plugin SDK declarations are self-contained and expose the current capability contract', async () => {
  const [runtimeTypes, packageTypes, capabilityTypes, versionTypes, apiErrorTypes, hostApiSource, hostVersionSource, sampleManifest] = await Promise.all([
    readFile(resolve(sdkRoot, 'it-tools-plugin.d.ts'), 'utf8'),
    readFile(resolve(sdkRoot, 'it-tools-plugin-package.d.ts'), 'utf8'),
    readFile(resolve(sdkRoot, 'plugin-capabilities.d.ts'), 'utf8'),
    readFile(resolve(sdkRoot, 'plugin-api-version.d.ts'), 'utf8'),
    readFile(resolve(sdkRoot, 'plugin-api-errors.d.ts'), 'utf8'),
    readFile(resolve(repositoryRoot, 'electron', 'plugin-api-v1.ts'), 'utf8'),
    readFile(resolve(repositoryRoot, 'src', 'shared', 'plugin-api-version.ts'), 'utf8'),
    readFile(resolve(repositoryRoot, 'plugins', 'capability-demo', 'plugin.source.json'), 'utf8'),
  ]);

  assert.match(runtimeTypes, /from '\.\/plugin-capabilities';/);
  assert.match(runtimeTypes, /from '\.\/plugin-api-version';/);
  assert.match(runtimeTypes, /from '\.\/it-tools-plugin-package';/);
  assert.match(runtimeTypes, /from '\.\/plugin-api-errors';/);
  assert.match(packageTypes, /from '\.\/plugin-capabilities';/);
  assert.doesNotMatch(runtimeTypes, /src\/shared\/plugin-capabilities/);
  assert.doesNotMatch(runtimeTypes, /src\/shared\/plugin-api-version/);
  assert.doesNotMatch(packageTypes, /src\/shared\/plugin-capabilities/);

  const hostApiErrorBlock = /pluginApiErrorCodes = Object\.freeze\(\[([\s\S]*?)\] as const\)/.exec(hostApiSource)?.[1];
  assert.ok(hostApiErrorBlock, 'the host API error catalog must be a frozen tuple');
  const hostApiErrorCodes = [...hostApiErrorBlock.matchAll(/'([a-z0-9-]+)'/g)].map(match => match[1]);
  const sdkApiErrorCodes = [...apiErrorTypes.matchAll(/^\s*\|\s*'([a-z0-9-]+)'/gm)].map(match => match[1]);
  assert.deepEqual(sdkApiErrorCodes, hostApiErrorCodes);
  assert.match(runtimeTypes, /export type \{ PluginApiErrorCode \} from '\.\/plugin-api-errors';/);

  const version = /pluginApiV1Version = '([^']+)'/.exec(hostVersionSource)?.[1];
  assert.ok(version, 'the host API version source must expose a stable literal');
  assert.match(versionTypes, new RegExp(`export type PluginApiV1Version = '${version}';`));
  assert.match(runtimeTypes, /apiVersion: PluginApiV1Version;/);
  assert.match(runtimeTypes, /hostApiVersion: PluginApiV1Version;/);
  assert.match(runtimeTypes, /PluginToolContext.*from '\.\/it-tools-plugin-package';/s);
  assert.doesNotMatch(runtimeTypes, /interface PluginToolContext/);
  assert.match(runtimeTypes, /readonly tool: PluginToolContext \| undefined;/);
  assert.match(packageTypes, /interface PluginToolContext/);
  assert.match(runtimeTypes, /interface PluginPackageContext/);
  assert.match(runtimeTypes, /readonly plugin: PluginPackageContext;/);
  assert.match(packageTypes, /interface PluginToolContribution/);
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
