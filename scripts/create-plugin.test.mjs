import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildPluginPackage } from './plugin-pack.mjs';
import { createPluginScaffold, parseCreatePluginArguments } from './create-plugin.mjs';

test('creates a non-overwriting source package accepted by the signed packer', async () => {
  const temporaryRoot = await mkdtemp(join(os.tmpdir(), 'it-tools-plugin-scaffold-'));
  const directory = resolve(temporaryRoot, 'example-plugin');
  const config = parseCreatePluginArguments([
    '--id', 'org.example.scaffold',
    '--name', 'Scaffold </script> plugin',
    '--directory', directory,
    '--tool-id', 'hello-world',
    '--tool-title', 'Hello world',
    '--description', 'A generated plugin source package.',
    '--capabilities', 'runtime.info',
  ]);
  const result = await createPluginScaffold(config);

  assert.equal(result.directory, directory);
  assert.deepEqual((await readdir(directory)).sort(), [
    'README.md',
    'index.html',
    'plugin.js',
    'plugin.source.json',
    'styles.css',
    'types',
  ]);
  assert.deepEqual((await readdir(join(directory, 'types'))).sort(), [
    'it-tools-plugin-package.d.ts',
    'it-tools-plugin.d.ts',
    'plugin-api-errors.d.ts',
    'plugin-api-version.d.ts',
    'plugin-capabilities.d.ts',
  ]);
  const runtimeTypes = await readFile(join(directory, 'types', 'it-tools-plugin.d.ts'), 'utf8');
  assert.doesNotMatch(runtimeTypes, /src\/shared/);
  const manifest = JSON.parse(await readFile(join(directory, 'plugin.source.json'), 'utf8'));
  const pluginScript = await readFile(join(directory, 'plugin.js'), 'utf8');
  assert.doesNotMatch(pluginScript, /<\/script>/i);
  assert.deepEqual(manifest.apiVersion, { minInclusive: '1.4.0', maxExclusive: '2.0.0' });
  assert.deepEqual(manifest.requestedCapabilities, ['runtime.info']);
  assert.deepEqual(manifest.contributions.tools[0], {
    id: 'org.example.scaffold/hello-world',
    title: 'Hello world',
    description: 'A generated plugin source package.',
    keywords: ['plugin', 'hello-world'],
    dataProcessing: 'local-data',
    offline: 'available',
    capabilities: ['runtime.info'],
  });

  const signingPair = generateKeyPairSync('ed25519');
  const packaged = await buildPluginPackage({
    sourceDirectory: directory,
    signingKey: signingPair.privateKey,
    keyId: 'scaffold-test-publisher',
  });
  assert.equal(packaged.manifest.id, 'org.example.scaffold');
  assert.equal(packaged.manifest.contributions.tools[0].id, 'org.example.scaffold/hello-world');
  assert.ok(packaged.manifest.files.some(file => file.path === 'types/it-tools-plugin.d.ts'));
  await assert.rejects(() => createPluginScaffold(config), /already exists or cannot be created/);
});

test('rejects invalid plugin scaffold metadata before creating a directory', () => {
  assert.throws(() => parseCreatePluginArguments(['--id', 'Org.Example', '--name', 'Bad']), /Plugin ID/);
  assert.throws(() => parseCreatePluginArguments([
    '--id', 'org.example.plugin',
    '--name', 'Bad',
    '--capabilities', 'runtime.info,runtime.info',
  ]), /Invalid capability list/);
  assert.throws(() => parseCreatePluginArguments([
    '--id', 'org.example.plugin',
    '--name', 'Bad',
    '--tool-id', '../escape',
  ]), /Tool ID/);
});
