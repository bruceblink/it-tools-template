import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { createPluginScaffold, parseCreatePluginArguments } from './create-plugin.mjs';
import { buildPluginPackage, validatePluginSource } from './plugin-pack.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '..');
const typescriptCli = resolve(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');

async function typecheckExternalConsumer(consumerDirectory, sourcePath) {
  const tsconfigPath = join(consumerDirectory, 'tsconfig.json');
  await writeFile(tsconfigPath, `${JSON.stringify({
    compilerOptions: {
      lib: ['ES2022', 'DOM'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      noEmit: true,
      strict: true,
      target: 'ES2022',
      types: [],
    },
    files: [sourcePath],
  }, null, 2)}\n`);

  await execFileAsync(process.execPath, [typescriptCli, '--project', tsconfigPath], {
    cwd: consumerDirectory,
    maxBuffer: 1024 * 1024,
  });
}

test('the generated plugin works as an independent project outside the repository', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'it-tools-plugin-project-'));
  try {
    const pluginDirectory = resolve(temporaryRoot, 'external-plugin');
    const config = parseCreatePluginArguments([
      '--id', 'org.example.external',
      '--name', 'External plugin',
      '--directory', pluginDirectory,
      '--tool-id', 'typed-tool',
      '--tool-title', 'Typed tool',
      '--description', 'A plugin generated outside the host repository.',
      '--capabilities', 'runtime.info,settings.read',
    ]);
    await createPluginScaffold(config);

    const consumerDirectory = resolve(temporaryRoot, 'consumer');
    await mkdir(consumerDirectory);
    const consumerPath = join(consumerDirectory, 'consumer.ts');
    await writeFile(consumerPath, `
import type {
  ITToolsPluginApiV1,
  PluginApiErrorCode,
} from '../external-plugin/types/it-tools-plugin';
import type { PluginPackageManifestV1 } from '../external-plugin/types/it-tools-plugin-package';

declare const api: ITToolsPluginApiV1;
const errorCode: PluginApiErrorCode = 'permission-denied';
const manifest: PluginPackageManifestV1 = {
  formatVersion: 1,
  id: 'org.example.external',
  name: 'External plugin',
  version: '0.1.0',
  apiVersion: { minInclusive: '1.4.0', maxExclusive: '2.0.0' },
  entrypoint: 'index.html',
  requestedCapabilities: ['runtime.info', 'settings.read'],
};

void api.capabilities.settings.get('example');
void errorCode;
void manifest;
`);
    await typecheckExternalConsumer(consumerDirectory, consumerPath);

    const generatedRuntimeTypes = await readFile(join(pluginDirectory, 'types', 'it-tools-plugin.d.ts'), 'utf8');
    assert.doesNotMatch(generatedRuntimeTypes, /(?:^|[\\/])src[\\/]shared[\\/]/);
    assert.match(generatedRuntimeTypes, /from '\.\/plugin-capabilities';/);
    assert.match(generatedRuntimeTypes, /from '\.\/plugin-api-version';/);

    const validated = await validatePluginSource({ sourceDirectory: pluginDirectory });
    assert.equal(validated.manifest.id, 'org.example.external');
    assert.equal(validated.files.some(file => file.path === 'plugin.source.json'), false);

    const signingPair = generateKeyPairSync('ed25519');
    const packaged = await buildPluginPackage({
      sourceDirectory: pluginDirectory,
      signingKey: signingPair.privateKey,
      keyId: 'external-project-test',
    });
    assert.equal(packaged.manifest.id, 'org.example.external');
    assert.equal(packaged.manifest.contributions.tools[0].id, 'org.example.external/typed-tool');
    assert.ok(packaged.manifest.files.some(file => file.path === 'types/it-tools-plugin.d.ts'));
    assert.equal(packaged.manifest.files.some(file => file.path === 'plugin.source.json'), false);
  }
  finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
