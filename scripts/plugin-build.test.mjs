import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createPluginScaffold, parseCreatePluginArguments } from './create-plugin.mjs';
import { buildPluginWorkflow, parsePluginBuildArguments, typecheckPluginProject } from './plugin-build.mjs';
import { generatePluginSigningKey } from './plugin-pack.mjs';

const packageScript = resolve('scripts/plugin-build.mjs');

async function createWorkflowFixture() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'it-tools-plugin-build-'));
  const sourceDirectory = resolve(temporaryRoot, 'package');
  const projectDirectory = resolve(temporaryRoot, 'project');
  const keyDirectory = resolve(temporaryRoot, 'keys');
  const outputPath = resolve(temporaryRoot, 'dist', 'plugin.itxs');
  await mkdir(projectDirectory, { recursive: true });
  await createPluginScaffold(parseCreatePluginArguments([
    '--id', 'org.example.workflow',
    '--name', 'Workflow plugin',
    '--directory', sourceDirectory,
  ]));
  await writeFile(resolve(projectDirectory, 'contract.ts'), `
/// <reference path="../package/types/it-tools-plugin.d.ts" />
const pluginId: string = window.itTools.plugin.id;
const toolId: string | undefined = window.itTools.toolId;
void pluginId;
void toolId;
`);
  const tsconfigPath = resolve(projectDirectory, 'tsconfig.json');
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
    files: ['contract.ts'],
  }, null, 2)}\n`);
  const key = await generatePluginSigningKey({ outputDirectory: keyDirectory, keyId: 'workflow-publisher' });
  return { temporaryRoot, sourceDirectory, projectDirectory, tsconfigPath, outputPath, key };
}

test('runs source validation, an external TypeScript check, and signing as one workflow', async (context) => {
  const fixture = await createWorkflowFixture();
  context.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));

  const report = await buildPluginWorkflow({
    sourceDirectory: fixture.sourceDirectory,
    tsconfigPath: fixture.tsconfigPath,
    privateKeyPath: fixture.key.privateKeyPath,
    keyId: fixture.key.keyId,
    outputPath: fixture.outputPath,
  });

  assert.equal(report.pluginId, 'org.example.workflow');
  assert.equal(report.typecheck.status, 'passed');
  assert.equal(report.package.outputPath, fixture.outputPath);
  assert.equal((await stat(fixture.outputPath)).isFile(), true);

  const cli = spawnSync(process.execPath, [
    packageScript,
    '--source', fixture.sourceDirectory,
    '--private-key', fixture.key.privateKeyPath,
    '--key-id', fixture.key.keyId,
    '--output', resolve(fixture.temporaryRoot, 'dist', 'cli.itxs'),
    '--tsconfig', fixture.tsconfigPath,
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const cliReport = JSON.parse(cli.stdout);
  assert.equal(cliReport.pluginId, 'org.example.workflow');
  assert.equal(cliReport.typecheck.status, 'passed');
});

test('skips type checking only when no project configuration exists', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'it-tools-plugin-build-'));
  try {
    const result = await typecheckPluginProject({ sourceDirectory: temporaryRoot });
    assert.deepEqual(result, { status: 'skipped', reason: 'no-tsconfig' });
  }
  finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects a failed external TypeScript check before writing a package', async (context) => {
  const fixture = await createWorkflowFixture();
  context.after(() => rm(fixture.temporaryRoot, { recursive: true, force: true }));
  await writeFile(resolve(fixture.projectDirectory, 'contract.ts'), 'const invalid: string = 42;\nvoid invalid;\n');

  await assert.rejects(
    buildPluginWorkflow({
      sourceDirectory: fixture.sourceDirectory,
      tsconfigPath: fixture.tsconfigPath,
      privateKeyPath: fixture.key.privateKeyPath,
      keyId: fixture.key.keyId,
      outputPath: fixture.outputPath,
    }),
    /TypeScript check failed/,
  );
  await assert.rejects(readFile(fixture.outputPath), { code: 'ENOENT' });
});

test('requires the package, signer, and output arguments', () => {
  assert.throws(() => parsePluginBuildArguments(['--source', 'plugin']), /Missing required options/);
  assert.throws(() => parsePluginBuildArguments([
    '--source', 'plugin',
    '--private-key', 'key.pem',
    '--key-id', 'publisher',
    '--output', 'plugin.itxs',
    '--json',
    '--json',
  ]), /may only be provided once/);
});
