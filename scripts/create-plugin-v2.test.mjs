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
  assert.deepEqual((await readdir(directory)).sort(), ['README.md', 'plugin', 'plugin.manifest.json', 'types']);
  assert.deepEqual((await readdir(join(directory, 'plugin'))).sort(), ['build.mjs', 'src']);
  assert.deepEqual((await readdir(join(directory, 'plugin', 'src'))).sort(), ['extension.c']);
  assert.deepEqual((await readdir(join(directory, 'types'))).sort(), [
    'it-tools-plugin-v2.d.ts',
    'plugin-v2-json.d.ts',
    'plugin-v2-manifest.d.ts',
    'plugin-v2-package.d.ts',
    'plugin-v2-wasm.d.ts',
  ]);
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
    settings: [],
    dataProviders: [],
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
  assert.deepEqual(manifest.contributions.settings, []);
  assert.deepEqual(manifest.contributions.dataProviders, []);
  execFileSync(process.execPath, [join(directory, 'plugin', 'build.mjs'), '--output', join(directory, 'extension.wasm')], {
    cwd: directory,
    stdio: 'pipe',
  });
  assert.ok((await readFile(join(directory, 'extension.wasm'))).length > 8);
  await assert.rejects(() => createPluginV2Scaffold(config), /already exists or cannot be created/);
});

test('creates a buildable v2 WASM scaffold with a host-rendered table tool', async () => {
  const temporaryRoot = await mkdtemp(join(os.tmpdir(), 'it-tools-plugin-v2-table-scaffold-'));
  const directory = resolve(temporaryRoot, 'table-plugin');
  const config = parseCreatePluginV2Arguments([
    '--id', 'org.example.table-scaffold',
    '--name', 'Table scaffold v2 plugin',
    '--directory', directory,
    '--output-kind', 'table',
  ]);
  const result = await createPluginV2Scaffold(config);

  assert.equal(result.directory, directory);
  const manifest = JSON.parse(await readFile(join(directory, 'plugin.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.contributions.tools[0].output, { kind: 'table' });
  assert.match(await readFile(join(directory, 'README.md'), 'utf8'), /表格结果/);
  execFileSync(process.execPath, [join(directory, 'plugin', 'build.mjs'), '--output', join(directory, 'extension.wasm')], {
    cwd: directory,
    stdio: 'pipe',
  });
  const resultValue = executeWasm(await readFile(join(directory, 'extension.wasm')), {
    commandId: 'org.example.table-scaffold/run-tool',
    input: {},
  });
  assert.deepEqual(resultValue, {
    kind: 'table',
    value: {
      columns: [{ id: 'column1', label: 'Column' }],
      rows: [['Replace this row']],
    },
  });
});

test('creates a v2 scaffold with an approved runtime.info capability template', async () => {
  const temporaryRoot = await mkdtemp(join(os.tmpdir(), 'it-tools-plugin-v2-runtime-info-'));
  const directory = resolve(temporaryRoot, 'runtime-info-plugin');
  const config = parseCreatePluginV2Arguments([
    '--id', 'org.example.runtime-info-scaffold',
    '--name', 'Runtime info scaffold v2 plugin',
    '--directory', directory,
    '--capability', 'runtime.info',
  ]);
  await createPluginV2Scaffold(config);

  const manifest = JSON.parse(await readFile(join(directory, 'plugin.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.requestedCapabilities, ['runtime.info']);
  assert.deepEqual(manifest.contributions.tools[0].capabilities, ['runtime.info']);
  assert.match(await readFile(join(directory, 'README.md'), 'utf8'), /capabilityContext\.runtimeInfo/);
  assert.match(await readFile(join(directory, 'plugin', 'src', 'extension.c'), 'utf8'), /capabilityContext\.runtimeInfo/);
});

test('creates a v2 scaffold with a host-managed settings.read capability template', async () => {
  const temporaryRoot = await mkdtemp(join(os.tmpdir(), 'it-tools-plugin-v2-settings-'));
  const directory = resolve(temporaryRoot, 'settings-plugin');
  const config = parseCreatePluginV2Arguments([
    '--id', 'org.example.settings-scaffold',
    '--name', 'Settings scaffold v2 plugin',
    '--directory', directory,
    '--capability', 'settings.read',
  ]);
  await createPluginV2Scaffold(config);

  const manifest = JSON.parse(await readFile(join(directory, 'plugin.manifest.json'), 'utf8'));
  const settingId = 'org.example.settings-scaffold/preferred-mode';
  assert.deepEqual(manifest.requestedCapabilities, ['settings.read']);
  assert.deepEqual(manifest.contributions.tools[0].capabilities, ['settings.read']);
  assert.deepEqual(manifest.contributions.tools[0].settings, [settingId]);
  assert.deepEqual(manifest.contributions.settings, [{
    id: settingId,
    label: 'Preferred mode',
    description: 'A non-secret setting supplied by the host.',
    type: 'string',
    defaultValue: 'default',
    maxLength: 128,
  }]);
  assert.match(await readFile(join(directory, 'README.md'), 'utf8'), /capabilityContext\.settings/);
  assert.match(await readFile(join(directory, 'plugin', 'src', 'extension.c'), 'utf8'), /capabilityContext\.settings/);
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
  assert.throws(() => parseCreatePluginV2Arguments([
    '--id', 'org.example.plugin',
    '--name', 'Bad',
    '--output-kind', 'json',
  ]), /Output kind/);
  assert.throws(() => parseCreatePluginV2Arguments([
    '--id', 'org.example.plugin',
    '--name', 'Bad',
    '--capability', 'data.oui',
  ]), /Capability/);
});

function executeWasm(moduleBytes, request) {
  const memory = new WebAssembly.Memory({ initial: 16, maximum: 256 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(moduleBytes), { env: { memory } });
  const requestBytes = new TextEncoder().encode(JSON.stringify(request));
  const requestPointer = instance.exports.alloc(requestBytes.byteLength);
  new Uint8Array(memory.buffer, requestPointer, requestBytes.byteLength).set(requestBytes);
  const descriptor = instance.exports.execute(requestPointer, requestBytes.byteLength);
  const resultPointer = Number(descriptor >> 32n);
  const resultLength = Number(descriptor & 0xffff_ffffn);
  const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    new Uint8Array(memory.buffer, resultPointer, resultLength),
  ));
  instance.exports.free(requestPointer, requestBytes.byteLength);
  if (resultPointer !== requestPointer) {
    instance.exports.free(resultPointer, resultLength);
  }
  return result;
}
