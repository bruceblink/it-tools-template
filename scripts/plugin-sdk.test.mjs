import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sdkRoot = resolve(repositoryRoot, 'plugins', 'sdk');

test('plugin SDK declarations are self-contained and expose the current capability contract', async () => {
  const [runtimeTypes, packageTypes, capabilityTypes] = await Promise.all([
    readFile(resolve(sdkRoot, 'it-tools-plugin.d.ts'), 'utf8'),
    readFile(resolve(sdkRoot, 'it-tools-plugin-package.d.ts'), 'utf8'),
    readFile(resolve(sdkRoot, 'plugin-capabilities.d.ts'), 'utf8'),
  ]);

  assert.match(runtimeTypes, /from '\.\/plugin-capabilities';/);
  assert.match(packageTypes, /from '\.\/plugin-capabilities';/);
  assert.doesNotMatch(runtimeTypes, /src\/shared\/plugin-capabilities/);
  assert.doesNotMatch(packageTypes, /src\/shared\/plugin-capabilities/);

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
