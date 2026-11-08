#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { packPluginPackage, validatePluginSource } from './plugin-pack.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const typescriptCli = resolve(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const maximumTypecheckOutputBytes = 16 * 1024;

function usageError(message) {
  return new Error(`${message}\n${getUsage()}`);
}

/** Parse the one-command source check and signing workflow arguments. */
export function parsePluginBuildArguments(argv) {
  const flags = new Map();
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
    if (!['source', 'private-key', 'key-id', 'output', 'tsconfig'].includes(name)) {
      throw usageError(`Unknown option: --${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--') || flags.has(name)) {
      throw usageError(`Missing or repeated value for --${name}.`);
    }
    flags.set(name, value);
    index += 1;
  }

  const required = ['source', 'private-key', 'key-id', 'output'];
  const missing = required.filter(name => !flags.has(name));
  if (missing.length > 0) {
    throw usageError(`Missing required option${missing.length === 1 ? '' : 's'}: ${missing.map(name => `--${name}`).join(', ')}`);
  }

  return {
    sourceDirectory: resolve(flags.get('source')),
    privateKeyPath: resolve(flags.get('private-key')),
    keyId: flags.get('key-id'),
    outputPath: resolve(flags.get('output')),
    tsconfigPath: flags.has('tsconfig') ? resolve(flags.get('tsconfig')) : undefined,
    json,
  };
}

async function resolveTypecheckConfig(sourceDirectory, requestedPath) {
  const candidate = requestedPath ?? resolve(sourceDirectory, 'tsconfig.json');
  try {
    const metadata = await lstat(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('The TypeScript project configuration must be a regular file.');
    }
    return candidate;
  }
  catch (error) {
    if (!requestedPath && error?.code === 'ENOENT') {
      return undefined;
    }
    throw new Error(`The TypeScript project configuration could not be read: ${candidate}`, { cause: error });
  }
}

function formatTypecheckOutput(error) {
  const output = [error?.stdout, error?.stderr]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .trim();
  if (!output) {
    return '';
  }
  return output.length > maximumTypecheckOutputBytes
    ? `${output.slice(0, maximumTypecheckOutputBytes)}\n…`
    : output;
}

/** Run the repository-pinned TypeScript compiler without installing project dependencies. */
export async function typecheckPluginProject({ sourceDirectory, tsconfigPath }) {
  const configPath = await resolveTypecheckConfig(sourceDirectory, tsconfigPath);
  if (!configPath) {
    return { status: 'skipped', reason: 'no-tsconfig' };
  }

  try {
    await lstat(typescriptCli);
  }
  catch (error) {
    throw new Error('The repository TypeScript compiler is unavailable. Run `corepack pnpm setup:dev` before building a plugin.', { cause: error });
  }

  try {
    await execFileAsync(process.execPath, [typescriptCli, '--noEmit', '--project', configPath], {
      cwd: sourceDirectory,
      maxBuffer: maximumTypecheckOutputBytes,
    });
  }
  catch (error) {
    const detail = formatTypecheckOutput(error);
    throw new Error(`TypeScript check failed${detail ? `:\n${detail}` : '.'}`, { cause: error });
  }
  return { status: 'passed', configPath };
}

/** Validate source, typecheck an optional external project, then create a signed package. */
export async function buildPluginWorkflow(input) {
  const validated = await validatePluginSource({ sourceDirectory: input.sourceDirectory });
  const typecheck = await typecheckPluginProject(input);
  const packaged = await packPluginPackage({
    sourceDirectory: input.sourceDirectory,
    privateKeyPath: input.privateKeyPath,
    keyId: input.keyId,
    outputPath: input.outputPath,
  });
  return {
    sourceDirectory: validated.sourceDirectory,
    pluginId: validated.manifest.id,
    version: validated.manifest.version,
    fileCount: validated.files.length,
    expandedBytes: validated.expandedBytes,
    typecheck,
    package: packaged,
  };
}

function printReport(report, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const typecheckLine = report.typecheck.status === 'passed'
    ? `passed (${report.typecheck.configPath})`
    : 'skipped (no tsconfig.json; source validation still ran)';
  process.stdout.write([
    `Validated ${report.pluginId} ${report.version} (${report.fileCount} files, ${report.expandedBytes} bytes)`,
    `TypeScript check: ${typecheckLine}`,
    `Signed package (${report.package.archiveBytes} bytes): ${report.package.outputPath}`,
    'Next step: install the package in Electron Settings, verify the signer fingerprint, and approve only the capabilities you need.',
    '',
  ].join('\n'));
}

export async function runCli(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(getUsage());
    return;
  }
  const options = parsePluginBuildArguments(argv);
  const report = await buildPluginWorkflow(options);
  printReport(report, options.json);
}

export function getUsage() {
  return [
    'IT Tools external plugin validation and signing workflow',
    '  pnpm run plugin:build -- --source <plugin-directory> --private-key <external.pem> --key-id <publisher> --output <package.itplugin> [--tsconfig <project.json>] [--json]',
    '',
    'The command validates the source before signing, optionally runs the repository TypeScript compiler against an external project configuration, and never overwrites an existing package.',
    'Keep private keys outside the repository and treat the generated package as untrusted until the Electron host verifies its signer.',
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Plugin build failed.'}\n`);
    process.exitCode = 1;
  });
}
