import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { createPluginV2Scaffold, parseCreatePluginV2Arguments } from './create-plugin-v2.mjs';

test('creates a buildable v2 WASM scaffold with a host-rendered text tool', async () => {
  const temporaryRoot = await mkdtemp(join(os.tmpdir(), 'it-tools-plugin-v2-scaffold-'));
  const directory = resolve(temporaryRoot, 'example-plugin');
  const config = parseCreatePluginV2Arguments([
    '--id', 'org.example.scaffold',
    '--name', 'Scaffold v2 plugin',
    '--directory', directory,
    '--tool-id', 'hello-world',
    '--tool-title', 'Hello world',
    '--description', 'A generated v2 plugin source package.',
    '--category-id', 'development',
  ]);
  const result = await createPluginV2Scaffold(config);

  assert.equal(result.directory, directory);
  assert.deepEqual((await readdir(directory)).sort(), ['README.md', 'plugin', 'plugin.manifest.json']);
  assert.deepEqual((await readdir(join(directory, 'plugin'))).sort(), ['build.mjs', 'src']);
  assert.deepEqual((await readdir(join(directory, 'plugin', 'src'))).sort(), ['extension.c']);
  const manifest = JSON.parse(await readFile(join(directory, 'plugin.manifest.json'), 'utf8'));
  assert.equal(manifest.formatVersion, 2);
  assert.deepEqual(manifest.apiVersion, { minInclusive: '2.0.0', maxExclusive: '3.0.0' });
  assert.deepEqual(manifest.requestedCapabilities, []);
  assert.deepEqual(manifest.contributions.tools[0], {
    id: 'org.example.scaffold/hello-world',
    title: 'Hello world',
    description: 'A generated v2 plugin source package.',
    keywords: ['plugin', 'hello-world'],
    categoryId: 'development',
    dataProcessing: 'memory-only',
    offline: 'available',
    capabilities: [],
    inputs: [{
      kind: 'text',
      id: 'input',
      label: 'Input',
      description: 'Replace this field with the input your command needs.',
      multiline: true,
      required: false,
      maxLength: 16_384,
    }],
    output: { kind: 'text' },
  });
  assert.equal(manifest.contributions.commands[0].id, 'org.example.scaffold/run-hello-world');
  execFileSync(process.execPath, [join(directory, 'plugin', 'build.mjs'), '--output', join(directory, 'extension.wasm')], {
    cwd: directory,
    stdio: 'pipe',
  });
  assert.ok((await readFile(join(directory, 'extension.wasm'))).length > 8);
  await assert.rejects(() => createPluginV2Scaffold(config), /already exists or cannot be created/);
});

test('rejects invalid v2 scaffold metadata before writing a directory', () => {
  assert.throws(() => parseCreatePluginV2Arguments(['--id', 'Org.Example', '--name', 'Bad']), /Plugin ID/);
  assert.throws(() => parseCreatePluginV2Arguments([
    '--id', 'org.example.plugin',
    '--name', 'Bad',
    '--category-id', '../escape',
  ]), /Category ID/);
  assert.throws(() => parseCreatePluginV2Arguments([
    '--id', 'org.example.plugin',
    '--name', 'Bad',
    '--tool-id', '../escape',
  ]), /Tool ID/);
});
