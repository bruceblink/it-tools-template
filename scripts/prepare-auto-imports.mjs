import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const configPath = resolve(projectRoot, 'vite.config.ts');
const declarationPath = resolve(projectRoot, 'auto-imports.d.ts');
const declarationWriteTimeoutMs = 5000;

async function getDeclarationStat() {
  try {
    return await stat(declarationPath);
  }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

// buildStart schedules a throttled write that buildEnd may not await; bound the wait for its output.
async function waitForFreshDeclaration(previousStat) {
  const deadline = Date.now() + declarationWriteTimeoutMs;
  let previousSignature;
  let stableReadCount = 0;

  while (Date.now() < deadline) {
    const currentStat = await getDeclarationStat();
    const isFresh = currentStat && (
      !previousStat
      || currentStat.size !== previousStat.size
      || currentStat.mtimeMs !== previousStat.mtimeMs
    );

    if (isFresh && currentStat.size > 0) {
      const declaration = await readFile(declarationPath, 'utf8');
      if (declaration.trim()) {
        const signature = `${currentStat.size}:${currentStat.mtimeMs}`;
        stableReadCount = signature === previousSignature ? stableReadCount + 1 : 0;
        if (stableReadCount >= 1) {
          return declaration;
        }
        previousSignature = signature;
      }
    }

    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }

  throw new Error(`The generated declaration was not written with non-empty content within ${declarationWriteTimeoutMs} ms: ${declarationPath}.`);
}

async function prepareAutoImports() {
  // The Vite config owns the import list and declaration output path; load it instead of duplicating either here.
  process.chdir(projectRoot);
  const loadedConfig = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    configPath,
    projectRoot,
  );

  if (!loadedConfig) {
    throw new Error(`Vite did not load a configuration from ${configPath}.`);
  }

  const autoImportPlugin = loadedConfig.config.plugins.find(plugin => plugin.name === 'unplugin-auto-import');
  if (!autoImportPlugin) {
    throw new Error('The Vite configuration does not include the unplugin-auto-import plugin.');
  }

  if (typeof autoImportPlugin.buildStart !== 'function' || typeof autoImportPlugin.buildEnd !== 'function') {
    throw new Error('The unplugin-auto-import plugin does not expose the required buildStart/buildEnd hooks.');
  }

  const previousDeclarationStat = await getDeclarationStat();

  // This scan and write use only the plugin hooks; no Vite server, dependency optimization, or bundle is started.
  await autoImportPlugin.buildStart.call(autoImportPlugin, {});
  await autoImportPlugin.buildEnd.call(autoImportPlugin, null);

  await waitForFreshDeclaration(previousDeclarationStat);

  console.log(`Generated auto-import declarations at ${declarationPath}.`);
}

try {
  await prepareAutoImports();
}
catch (error) {
  const details = error instanceof Error ? error.message : String(error);
  console.error(`[types:prepare] Failed to generate auto-import declarations: ${details}`);
  process.exitCode = 1;
}
