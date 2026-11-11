import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { promisify } from 'node:util';
import test from 'node:test';

import { createPluginV2Scaffold, parseCreatePluginV2Arguments } from './create-plugin-v2.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '..');
const typescriptCli = resolve(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');

test('v2 scaffold types compile from a project outside the repository', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'it-tools-plugin-v2-project-'));
  try {
    const pluginDirectory = resolve(temporaryRoot, 'external-plugin');
    const config = parseCreatePluginV2Arguments([
      '--id', 'org.example.external',
      '--name', 'External v2 plugin',
      '--directory', pluginDirectory,
      '--tool-id', 'typed-tool',
      '--tool-title', 'Typed tool',
      '--description', 'A v2 plugin generated outside the host repository.',
    ]);
    await createPluginV2Scaffold(config);

    const consumerDirectory = resolve(temporaryRoot, 'consumer');
    await mkdir(consumerDirectory);
    const consumerPath = join(consumerDirectory, 'consumer.ts');
    await writeFile(consumerPath, `
import type {
  PluginV2CapabilityContext,
  PluginV2CommandResult,
  PluginV2DataProviderContribution,
  PluginV2Manifest,
  PluginV2PackageManifest,
  PluginV2SettingContribution,
  PluginV2WasmRequest,
  PluginV2WasmExports,
} from '../external-plugin/types/it-tools-plugin-v2';

const provider: PluginV2DataProviderContribution = {
  id: 'org.example.external/oui-vendor',
  label: 'OUI vendor data',
  description: 'Host-owned OUI vendor records.',
  kind: 'oui.vendor',
  version: '1.0.0',
  schemaVersion: 1,
  maxBytes: 512,
};

const setting: PluginV2SettingContribution = {
  id: 'org.example.external/preferred-mode',
  label: 'Preferred mode',
  description: 'The default mode for this plugin.',
  type: 'boolean',
  defaultValue: true,
};

const manifest: PluginV2Manifest = {
  formatVersion: 2,
  id: 'org.example.external',
  name: 'External v2 plugin',
  version: '0.1.0',
  apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
  requestedCapabilities: ['data.oui'],
  activationEvents: [
    'onTool:org.example.external/typed-tool',
    'onCommand:org.example.external/run-typed-tool',
  ],
  contributions: {
    tools: [],
    commands: [],
    settings: [setting],
    dataProviders: [provider],
  },
};
const result: PluginV2CommandResult = { kind: 'text', value: 'done' };
const capabilityContext: PluginV2CapabilityContext = {
  runtimeInfo: { platform: 'darwin', appVersion: '1.0.0' },
  settings: { 'org.example.external/preferred-mode': true },
  data: { 'org.example.external/oui-vendor': { vendor: 'Example vendor', dataVersion: '1.0.0' } },
};
const request: PluginV2WasmRequest = {
  commandId: 'org.example.external/run-typed-tool',
  input: { value: 'input' },
  capabilityContext,
};
declare const wasm: PluginV2WasmExports;
declare const packageManifest: PluginV2PackageManifest;
void manifest;
void result;
void request;
void wasm;
void packageManifest;
`);
    await writeFile(join(consumerDirectory, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        lib: ['ES2022', 'DOM'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        noEmit: true,
        strict: true,
        target: 'ES2022',
        types: [],
      },
      files: [consumerPath],
    }, null, 2)}\n`);
    await execFileAsync(process.execPath, [typescriptCli, '--project', join(consumerDirectory, 'tsconfig.json')], {
      cwd: consumerDirectory,
      maxBuffer: 1024 * 1024,
    });

    for (const fileName of [
      'it-tools-plugin-v2.d.ts',
      'plugin-v2-json.d.ts',
      'plugin-v2-manifest.d.ts',
      'plugin-v2-package.d.ts',
      'plugin-v2-wasm.d.ts',
    ]) {
      const source = await readFile(join(pluginDirectory, 'types', fileName), 'utf8');
      assert.doesNotMatch(source, /(?:^|[\\/])src[\\/]shared[\\/]/);
    }
  }
  finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
