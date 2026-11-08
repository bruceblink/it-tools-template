#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = resolve(repositoryRoot, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const packageManagerMatch = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageJson.packageManager ?? '');
const requiredPnpmVersion = packageManagerMatch?.[1] ?? null;
const requiredNodeMajor = /^(?:>=)?(\d+)/.exec(packageJson.engines?.node ?? '')?.[1];

function commandName(command) {
  return process.platform === 'win32' && command === 'corepack' ? 'corepack.cmd' : command;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function parsePnpmVersion(value) {
  const match = /(?:^|\s)pnpm\/(\d+\.\d+\.\d+)(?:\s|$)/.exec(value ?? '')
    ?? /^(\d+\.\d+\.\d+)$/.exec(value ?? '');
  return match?.[1] ?? null;
}

export function hasConfiguredProxy(environment = process.env) {
  return ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']
    .some(name => typeof environment[name] === 'string' && environment[name].trim().length > 0);
}

export function electronExecutableRelativePath(platform) {
  switch (platform) {
    case 'darwin':
      return join('Electron.app', 'Contents', 'MacOS', 'Electron');
    case 'win32':
      return 'electron.exe';
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return 'electron';
    default:
      return null;
  }
}

export function electronPackageDirectory(root = repositoryRoot) {
  const packagePath = resolve(root, 'node_modules', 'electron', 'package.json');
  return existsSync(packagePath) ? dirname(packagePath) : null;
}

export function electronExecutablePath({ root = repositoryRoot, platform = process.platform, environment = process.env } = {}) {
  const relativePath = electronExecutableRelativePath(platform);
  const packageDirectory = electronPackageDirectory(root);
  if (!relativePath || !packageDirectory) {
    return null;
  }

  const pathFile = resolve(packageDirectory, 'path.txt');
  let installedPath = relativePath;
  if (existsSync(pathFile)) {
    const value = readFileSync(pathFile, 'utf8').trim();
    if (value) {
      installedPath = value;
    }
  }

  if (environment.ELECTRON_OVERRIDE_DIST_PATH) {
    return resolve(environment.ELECTRON_OVERRIDE_DIST_PATH, installedPath);
  }
  return resolve(packageDirectory, 'dist', installedPath);
}

export function isElectronInstalled(options = {}) {
  const executablePath = electronExecutablePath(options);
  return executablePath !== null && existsSync(executablePath);
}

function currentPnpmVersion() {
  const fromUserAgent = parsePnpmVersion(process.env.npm_config_user_agent);
  if (fromUserAgent) {
    return fromUserAgent;
  }

  const result = spawnSync(commandName('pnpm'), ['--version'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? parsePnpmVersion(result.stdout) : null;
}

export function assertSupportedRuntime({ nodeVersion = process.versions.node, pnpmVersion = currentPnpmVersion() } = {}) {
  const nodeMajor = Number.parseInt(nodeVersion.split('.')[0] ?? '', 10);
  if (!Number.isInteger(nodeMajor) || (requiredNodeMajor && nodeMajor < Number(requiredNodeMajor))) {
    throw new Error(`Node.js ${packageJson.engines.node} is required; found ${nodeVersion}.`);
  }
  if (requiredPnpmVersion && pnpmVersion !== requiredPnpmVersion) {
    throw new Error(
      `pnpm ${requiredPnpmVersion} is required; found ${pnpmVersion ?? 'unknown'}. `
      + `Run "corepack enable" and then "corepack pnpm setup:dev".`,
    );
  }
  return { nodeVersion, pnpmVersion };
}

function runCorepackPnpm(args, environment = process.env) {
  const result = spawnSync(commandName('corepack'), ['pnpm', ...args], {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`corepack pnpm ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

export function createElectronInstallEnvironment(environment = process.env) {
  const nextEnvironment = { ...environment };
  if (!nextEnvironment.ELECTRON_GET_USE_PROXY && hasConfiguredProxy(nextEnvironment)) {
    nextEnvironment.ELECTRON_GET_USE_PROXY = '1';
  }
  return nextEnvironment;
}

export function ensureElectron({ install = true, environment = process.env } = {}) {
  if (isElectronInstalled({ environment })) {
    console.log('Electron runtime is ready.');
    return;
  }
  if (!install) {
    throw new Error('Electron runtime is not installed. Run "corepack pnpm setup:electron".');
  }

  const installEnvironment = createElectronInstallEnvironment(environment);
  if (installEnvironment.ELECTRON_GET_USE_PROXY === '1' && !environment.ELECTRON_GET_USE_PROXY) {
    console.log('Detected an HTTP(S) proxy; enabling Electron downloader proxy support for this command.');
  }
  console.log('Installing the Electron runtime...');
  runCorepackPnpm(['exec', 'install-electron'], installEnvironment);
  if (!isElectronInstalled({ environment: installEnvironment })) {
    throw new Error('Electron download completed but the executable was not found in node_modules/electron/dist.');
  }
  console.log('Electron runtime is ready.');
}

function printUsage() {
  console.log([
    'Usage:',
    '  corepack pnpm setup:dev       install dependencies and the Electron runtime',
    '  corepack pnpm setup:electron  install or verify the Electron runtime',
    '  corepack pnpm setup:browsers  install Playwright browsers',
    '  corepack pnpm env:check       check the toolchain and Electron runtime',
  ].join('\n'));
}

function main() {
  const mode = process.argv[2] ?? '--electron';
  if (mode === '--help' || mode === '-h') {
    printUsage();
    return;
  }

  const runtime = assertSupportedRuntime();
  if (mode === '--check') {
    console.log(`Versions: pnpm ${runtime.pnpmVersion}, Node.js ${runtime.nodeVersion}`);
  }
  if (mode === '--install') {
    console.log('Installing locked project dependencies...');
    runCorepackPnpm(['install', '--frozen-lockfile'], createElectronInstallEnvironment());
    ensureElectron();
    return;
  }
  if (mode === '--electron') {
    ensureElectron();
    return;
  }
  if (mode === '--browsers') {
    console.log('Installing Playwright browsers...');
    runCorepackPnpm(['exec', 'playwright', 'install']);
    return;
  }
  if (mode === '--check') {
    ensureElectron({ install: false });
    console.log('Development environment is ready.');
    return;
  }

  printUsage();
  process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  }
  catch (error) {
    console.error(`Development environment setup failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
