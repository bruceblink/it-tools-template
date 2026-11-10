import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { executeExternalExtensionWasmCommand, externalExtensionWasmAbi } from '../../electron/external-extension-wasm';
import { validateExternalPluginV2Manifest } from '../../src/shared/external-plugin-v2';

const sampleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sampleDirectory, '../..');
const buildScript = resolve(sampleDirectory, 'build.mjs');
const runCompilerIntegration = env.IT_TOOLS_WASM_SAMPLE_TEST === '1';
const compilerIntegrationTest = runCompilerIntegration ? it : it.skip;

compilerIntegrationTest('用 Zig 编译独立示例并通过宿主执行器验证 ABI 和结果', async () => {
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'it-tools-wasm-double-'));
  const wasmPath = resolve(temporaryDirectory, 'extension.wasm');

  try {
    // 构建脚本编译示例中的真实 C 源码，不读取测试目录中的合成 WASM。
    execFileSync(process.execPath, [buildScript, '--output', wasmPath], {
      cwd: repositoryRoot,
      stdio: 'pipe',
    });
    const sourceManifest = JSON.parse(await readFile(resolve(sampleDirectory, 'plugin.manifest.json'), 'utf8')) as unknown;
    const manifest = validateExternalPluginV2Manifest(sourceManifest, '2.0.0');
    const moduleBytes = new Uint8Array(await readFile(wasmPath));
    const module = new WebAssembly.Module(moduleBytes);
    const imports = WebAssembly.Module.imports(module);
    const exports = WebAssembly.Module.exports(module);

    expect(imports).toEqual([{
      module: externalExtensionWasmAbi.importModule,
      name: externalExtensionWasmAbi.memoryImport,
      kind: 'memory',
    }]);
    expect(exports.map(item => item.name).sort()).toEqual([
      externalExtensionWasmAbi.allocateExport,
      externalExtensionWasmAbi.executeExport,
      externalExtensionWasmAbi.freeExport,
    ].sort());
    expect(manifest.contributions.tools[0]?.output.kind).toBe('json');
    expect(executeExternalExtensionWasmCommand(
      moduleBytes,
      'org.example.wasm.double/run-double',
      { number: 21 },
    )).toEqual({
      kind: 'json',
      value: { input: 21, doubled: 42 },
    });
    expect(executeExternalExtensionWasmCommand(
      moduleBytes,
      'org.example.wasm.double/run-double',
      { number: 'not-an-integer' },
    )).toEqual({
      kind: 'json',
      value: { error: 'Input number must be an integer from 0 to 1000000.' },
    });
  }
  finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
