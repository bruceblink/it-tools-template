// @vitest-environment node
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { executeExternalExtensionWasmCommand } from './external-extension-wasm';
import { ExternalPluginV2PackageManager } from './external-plugin-v2-package-manager';
import type { ExternalPluginV2Manifest } from '../src/shared/external-plugin-v2';
import type { PluginPackageSigningKey } from './plugin-package-manifest';
import { createWasmModuleFixture } from './test-helpers/wasm-module-fixtures';

const pluginId = 'org.example.pack-v2-demo';
const keyId = 'pack-v2-test-key';
const packerPath = fileURLToPath(new URL('../scripts/plugin-pack-v2.mjs', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('v2 WASM package authoring', () => {
  it('signs existing manifest and WASM, then installs and executes through the v2 receiver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-plugin-pack-v2-'));
    temporaryDirectories.push(root);
    const sourceManifestPath = join(root, 'plugin.manifest.json');
    const wasmPath = join(root, 'plugin.wasm');
    const outputPath = join(root, 'signed-plugin.itxs');
    const secondOutputPath = join(root, 'signed-plugin-second.itxs');
    const signingPair = generateKeyPairSync('ed25519');
    const privateKeyPath = join(root, `${keyId}.private.pem`);
    const privateKeyBytes = Buffer.from(signingPair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const publicKeyBytes = Buffer.from(signingPair.publicKey.export({ type: 'spki', format: 'pem' }));
    await writeFile(privateKeyPath, privateKeyBytes, { mode: 0o600 });
    await writeFile(sourceManifestPath, JSON.stringify(createSourceManifest(), null, 2));
    const wasmBytes = Buffer.from(createWasmModuleFixture({
      resultBytes: Buffer.from('{"kind":"json","value":{"accepted":true}}', 'utf8'),
    }));
    await writeFile(wasmPath, wasmBytes);

    const packed = runPacker({
      manifest: sourceManifestPath,
      wasm: wasmPath,
      entrypoint: 'extension.wasm',
      privateKey: privateKeyPath,
      keyId,
      output: outputPath,
    });
    expect(packed.status).toBe(0);
    expect(packed.stdout).toContain(`Signed v2 WASM package ${pluginId} 1.0.0`);

    const repeated = runPacker({
      manifest: sourceManifestPath,
      wasm: wasmPath,
      entrypoint: 'extension.wasm',
      privateKey: privateKeyPath,
      keyId,
      output: secondOutputPath,
    });
    expect(repeated.status).toBe(0);
    await expect(readFile(secondOutputPath)).resolves.toEqual(await readFile(outputPath));

    const trustedSigningKeys = new Map<string, PluginPackageSigningKey>([
      [keyId, { publicKey: publicKeyBytes, allowedPluginIds: [pluginId] }],
    ]);
    const manager = new ExternalPluginV2PackageManager({
      installRoot: join(root, 'installed'),
      hostApiVersion: '2.0.0',
      trustedSigningKeys,
    });
    const installed = await manager.installArchive(outputPath);
    expect(installed).toMatchObject({ pluginId, version: '1.0.0', runtime: 'wasm', status: 'installed' });

    const executionContext = await manager.getInstalledExecutionContext(pluginId, '1.0.0');
    expect(executionContext.entrypoint).toBe('extension.wasm');
    expect(executionContext.entrypointSha256).toBe(createHash('sha256').update(wasmBytes).digest('hex'));
    const installedWasm = await readFile(join(executionContext.packageRoot, executionContext.entrypoint));
    expect(installedWasm).toEqual(wasmBytes);
    expect(executeExternalExtensionWasmCommand(installedWasm, `${pluginId}/run`, { value: 'ready' }))
      .toEqual({ kind: 'json', value: { accepted: true } });
  });

  it('rejects an incompatible source manifest and preserves an existing archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-plugin-pack-v2-invalid-'));
    temporaryDirectories.push(root);
    const sourceManifestPath = join(root, 'plugin.manifest.json');
    const wasmPath = join(root, 'plugin.wasm');
    const privateKeyPath = join(root, `${keyId}.private.pem`);
    const outputPath = join(root, 'signed-plugin.itxs');
    const signingPair = generateKeyPairSync('ed25519');
    await writeFile(privateKeyPath, Buffer.from(signingPair.privateKey.export({ type: 'pkcs8', format: 'pem' })), { mode: 0o600 });
    const invalidManifest = createSourceManifest({
      apiVersion: { minInclusive: '3.0.0', maxExclusive: '4.0.0' },
    });
    await writeFile(sourceManifestPath, JSON.stringify(invalidManifest));
    await writeFile(wasmPath, createWasmModuleFixture());
    await writeFile(outputPath, 'keep existing archive');

    const result = runPacker({
      manifest: sourceManifestPath,
      wasm: wasmPath,
      entrypoint: 'extension.wasm',
      privateKey: privateKeyPath,
      keyId,
      output: outputPath,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not support host API 2.0.0');
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('keep existing archive');
  });

  it('uses the shared v2 validator to reject an invalid nested tool contribution before signing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'it-tools-plugin-pack-v2-contribution-'));
    temporaryDirectories.push(root);
    const sourceManifestPath = join(root, 'plugin.manifest.json');
    const wasmPath = join(root, 'plugin.wasm');
    const privateKeyPath = join(root, `${keyId}.private.pem`);
    const outputPath = join(root, 'signed-plugin.itxs');
    const signingPair = generateKeyPairSync('ed25519');
    await writeFile(privateKeyPath, Buffer.from(signingPair.privateKey.export({ type: 'pkcs8', format: 'pem' })), { mode: 0o600 });
    const validManifest = createSourceManifest();
    const invalidManifest = {
      ...validManifest,
      contributions: {
        ...validManifest.contributions,
        tools: validManifest.contributions.tools.map(tool => ({ ...tool, categoryId: 'Invalid category' })),
      },
    };
    await writeFile(sourceManifestPath, JSON.stringify(invalidManifest));
    await writeFile(wasmPath, createWasmModuleFixture());

    const result = runPacker({
      manifest: sourceManifestPath,
      wasm: wasmPath,
      entrypoint: 'extension.wasm',
      privateKey: privateKeyPath,
      keyId,
      output: outputPath,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('category is invalid');
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

/** 生成满足 v2 宿主协议的最小签名输入清单。 */
function createSourceManifest(overrides: Partial<ExternalPluginV2Manifest> = {}): ExternalPluginV2Manifest {
  const toolId = `${pluginId}/echo`;
  const commandId = `${pluginId}/run`;
  return {
    formatVersion: 2,
    id: pluginId,
    name: 'Pack v2 demo',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    requestedCapabilities: [],
    activationEvents: [`onTool:${toolId}`, `onCommand:${commandId}`],
    contributions: {
      tools: [{
        id: toolId,
        title: 'WASM echo',
        description: 'Run a signed WASM command.',
        keywords: ['wasm'],
        categoryId: 'development',
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: [],
        inputs: [],
        output: { kind: 'json' },
      }],
      commands: [{
        id: commandId,
        title: 'Run WASM echo',
        description: 'Run a signed WASM command.',
        keywords: ['wasm'],
        toolId,
      }],
    },
    ...overrides,
  };
}

/** 通过公开 CLI 运行 v2 打包命令并保留完整诊断。 */
function runPacker(options: {
  manifest: string;
  wasm: string;
  entrypoint: string;
  privateKey: string;
  keyId: string;
  output: string;
}) {
  return spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--experimental-transform-types',
    packerPath,
    '--manifest', options.manifest,
    '--wasm', options.wasm,
    '--entrypoint', options.entrypoint,
    '--private-key', options.privateKey,
    '--key-id', options.keyId,
    '--output', options.output,
  ], { encoding: 'utf8' });
}
