import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildPluginSourceSnapshot,
  type PluginSourceBuildInput,
  type PluginSourceBuildResult,
} from './plugin-source-build.ts';

interface PluginSourceBuildCliOptions extends PluginSourceBuildInput {
  readonly json: boolean;
}

function usageError(message: string): Error {
  return new Error(`${message}\n${getPluginSourceBuildUsage()}`);
}

export function parsePluginSourceBuildArguments(argv: readonly string[]): PluginSourceBuildCliOptions {
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      if (json) {
        throw usageError('The --json flag may only be provided once.');
      }
      json = true;
      continue;
    }
    if (!argument?.startsWith('--')) {
      throw usageError(`Unexpected argument: ${argument ?? ''}`);
    }
    const name = argument.slice(2);
    if (!['owner', 'name', 'commit', 'private-key', 'key-id', 'output', 'tsconfig'].includes(name)) {
      throw usageError(`Unknown option: --${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--') || values.has(name)) {
      throw usageError(`Missing or repeated value for --${name}.`);
    }
    values.set(name, value);
    index += 1;
  }

  const required = ['owner', 'name', 'commit', 'private-key', 'key-id', 'output'];
  const missing = required.filter(name => !values.has(name));
  if (missing.length > 0) {
    throw usageError(`Missing required option${missing.length === 1 ? '' : 's'}: ${missing.map(name => `--${name}`).join(', ')}`);
  }

  return {
    owner: values.get('owner')!,
    name: values.get('name')!,
    commitSha: values.get('commit')!,
    privateKeyPath: resolve(values.get('private-key')!),
    keyId: values.get('key-id')!,
    outputPath: resolve(values.get('output')!),
    ...(values.has('tsconfig') ? { tsconfigPath: resolve(values.get('tsconfig')!) } : {}),
    json,
  };
}

export async function runPluginSourceBuildCli(argv: readonly string[]): Promise<void> {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  if (normalizedArgv.length === 0 || normalizedArgv.includes('--help') || normalizedArgv.includes('-h')) {
    process.stdout.write(getPluginSourceBuildUsage());
    return;
  }

  try {
    const options = parsePluginSourceBuildArguments(normalizedArgv);
    const temporaryRoot = await mkdtemp(join(tmpdir(), '.it-tools-plugin-source-build-cli-'));
    try {
      const result = await buildPluginSourceSnapshot(options, {
        tempRoot: temporaryRoot,
        fetch: globalThis.fetch,
      });
      printPluginSourceBuildReport(result, options.json);
    }
    finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
  catch (error) {
    process.stderr.write(`${formatPluginSourceBuildError(error)}\n`);
    process.exitCode = 1;
  }
}

export function getPluginSourceBuildUsage(): string {
  return [
    'Build a fixed GitHub plugin source snapshot into a signed package.',
    '  corepack pnpm plugin:build-source -- --owner <owner> --name <repository> --commit <40-char-sha>',
    '    --private-key <external.pem> --key-id <publisher> --output <package.itplugin> [--tsconfig <project.json>] [--json]',
    '',
    'The command validates the repository and immutable commit, rejects unsafe archive entries,',
    'runs source validation and an optional no-emit TypeScript check, then signs the package.',
    'It does not run repository scripts or install dependencies. Keep the signing key outside the repository.',
    '',
  ].join('\n');
}

function printPluginSourceBuildReport(result: PluginSourceBuildResult, json: boolean): void {
  const report = {
    repository: result.source.repository,
    commitSha: result.source.commitSha,
    snapshotSha256: result.source.sha256,
    archiveBytes: result.source.archiveBytes,
    pluginId: result.build.pluginId,
    version: result.build.version,
    fileCount: result.build.fileCount,
    expandedBytes: result.build.expandedBytes,
    typecheck: result.build.typecheck,
    package: result.build.package,
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const typecheck = report.typecheck.status === 'passed'
    ? `passed (${report.typecheck.configPath})`
    : 'skipped (no tsconfig.json)';
  process.stdout.write([
    `Pinned ${report.repository}@${report.commitSha}`,
    `Validated ${report.pluginId} ${report.version} (${report.fileCount} files, ${report.expandedBytes} bytes)`,
    `Snapshot SHA-256: ${report.snapshotSha256}`,
    `TypeScript check: ${typecheck}`,
    `Signed package (${report.package.archiveBytes} bytes): ${report.package.outputPath}`,
    'Next step: install the package in desktop Settings, verify the signer fingerprint, and approve only the capabilities you need.',
    '',
  ].join('\n'));
}

function formatPluginSourceBuildError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'The plugin source build failed.';
}
