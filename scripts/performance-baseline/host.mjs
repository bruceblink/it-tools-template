import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, readFile, readdir, readlink } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem, version as osVersion } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(command + ' ' + args.join(' ') + ' failed: ' + String(result.stderr || result.stdout).trim());
  }
  return String(result.stdout ?? '').trim();
}

function runSyncBuffer(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'buffer',
    maxBuffer: 100 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(command + ' ' + args.join(' ') + ' failed.');
  }
  return result.stdout;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function parseShortStatusPaths(status) {
  return status ? status.split(/\r?\n/).filter(Boolean).map(line => line.slice(3)) : [];
}

export async function getSourceIdentity() {
  const commit = runSync('git', ['rev-parse', 'HEAD']);
  const status = runSyncBuffer('git', ['status', '--short']).toString('utf8').replace(/(?:\r?\n)+$/, '');
  const trackedDiff = runSyncBuffer('git', ['diff', '--binary', 'HEAD', '--']);
  const untrackedOutput = runSyncBuffer('git', ['ls-files', '--others', '--exclude-standard', '-z']);
  const untrackedPaths = untrackedOutput.toString('utf8').split('\0').filter(Boolean).sort();
  const fingerprint = createHash('sha256');
  fingerprint.update(commit);
  fingerprint.update('\0');
  fingerprint.update(status);
  fingerprint.update('\0');
  fingerprint.update(trackedDiff);

  for (const path of untrackedPaths) {
    const filePath = resolve(projectRoot, path);
    const relativePath = relative(projectRoot, filePath);
    if (relativePath === '..' || relativePath.startsWith('..' + sep)) {
      throw new Error('Untracked source path escapes the repository: ' + path);
    }
    const info = await lstat(filePath);
    fingerprint.update('\0' + path + '\0');
    fingerprint.update(info.isSymbolicLink() ? await readlink(filePath) : await readFile(filePath));
  }

  return {
    commit,
    dirty: status.length > 0,
    dirtyPaths: parseShortStatusPaths(status),
    workingTreeFingerprint: fingerprint.digest('hex'),
    lockfileSha256: sha256(await readFile(resolve(projectRoot, 'pnpm-lock.yaml'))),
  };
}

export async function measureDirectory(directory) {
  try {
    await access(directory);
  }
  catch {
    return { path: relative(projectRoot, directory), bytes: null, files: null, available: false };
  }

  let bytes = 0;
  let files = 0;
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      }
      else if (entry.isFile()) {
        const fileInfo = await lstat(absolute);
        bytes += fileInfo.size;
        files += 1;
      }
    }
  }
  await visit(directory);
  return { path: relative(projectRoot, directory), bytes, files, available: true };
}

async function findExistingFile(candidates) {
  for (const candidate of candidates) {
    try {
      const info = await lstat(candidate);
      if (info.isFile()) {
        return resolve(candidate);
      }
    }
    catch {
      // Try the next platform-specific candidate.
    }
  }
  return null;
}

export async function locateChrome() {
  const candidates = [];
  if (process.env.CHROME_BIN) {
    candidates.push(process.env.CHROME_BIN);
  }
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    candidates.push(
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
  }
  else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  }
  else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  const chrome = await findExistingFile(candidates);
  if (!chrome) {
    throw new Error('Chrome was not found. Set CHROME_BIN to a supported Chrome executable.');
  }
  return chrome;
}

export async function locateElectron({ useProjectRuntime = false } = {}) {
  const candidates = [];
  if (process.env.ELECTRON_BIN) {
    candidates.push(process.env.ELECTRON_BIN);
  }
  if (useProjectRuntime && process.platform === 'win32') {
    candidates.push(resolve(projectRoot, 'node_modules/electron/dist/electron.exe'));
  }
  else if (useProjectRuntime && process.platform === 'darwin') {
    candidates.push(resolve(projectRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
  }
  else if (useProjectRuntime) {
    candidates.push(resolve(projectRoot, 'node_modules/electron/dist/electron'));
  }
  else if (process.platform === 'win32') {
    candidates.push(resolve(projectRoot, 'release/win-unpacked/IT Tools.exe'));
  }
  else if (process.platform === 'darwin') {
    candidates.push(resolve(projectRoot, 'release/mac/IT Tools.app/Contents/MacOS/IT Tools'));
  }
  else {
    candidates.push(
      resolve(projectRoot, 'release/linux-unpacked/it-tools'),
      resolve(projectRoot, 'release/linux-unpacked/IT Tools'),
    );
  }
  const executable = await findExistingFile(candidates);
  if (!executable) {
    if (useProjectRuntime) {
      throw new Error('The installed Electron runtime was not found. Run pnpm install or set ELECTRON_BIN.');
    }
    throw new Error('The current platform unpacked Electron app was not found. Run electron-builder --dir first or set ELECTRON_BIN.');
  }
  return executable;
}

export async function findReleaseInstallers() {
  const releaseRoot = resolve(projectRoot, 'release');
  const found = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    }
    catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      }
      else if (entry.isFile() && /\.(?:dmg|appimage|deb|msi|zip)$/i.test(entry.name)) {
        const info = await lstat(path);
        found.push({ path: relative(projectRoot, path), bytes: info.size });
      }
      else if (entry.isFile() && /\.exe$/i.test(entry.name) && /setup|installer/i.test(entry.name)) {
        const info = await lstat(path);
        found.push({ path: relative(projectRoot, path), bytes: info.size });
      }
    }
  }
  await visit(releaseRoot);
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

function parseCpuTime(value) {
  const parts = value.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part))) {
    return 0;
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

function collectWindowsProcessTree(rootPid) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$rootPid = __ROOT_PID__',
    '$processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)',
    '$ids = [System.Collections.Generic.HashSet[int]]::new()',
    '[void]$ids.Add($rootPid)',
    'do {',
    '  $changed = $false',
    '  foreach ($process in $processes) {',
    '    if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) { $changed = $true }',
    '  }',
    '} while ($changed)',
    '$metrics = @()',
    'foreach ($id in $ids) {',
    '  $process = Get-Process -Id $id -ErrorAction SilentlyContinue',
    '  if ($null -ne $process) {',
    '    $cpu = 0.0',
    '    if ($null -ne $process.CPU) { $cpu = [double]$process.CPU }',
    '    $metrics += [pscustomobject]@{ workingSetBytes = [long]$process.WorkingSet64; privateBytes = [long]$process.PrivateMemorySize64; cpuSeconds = $cpu }',
    '  }',
    '}',
    "if ($metrics.Count -eq 0) { throw 'Process tree is unavailable.' }",
    '$workingSet = ($metrics | Measure-Object -Property workingSetBytes -Sum).Sum',
    '$private = ($metrics | Measure-Object -Property privateBytes -Sum).Sum',
    '$cpuTotal = ($metrics | Measure-Object -Property cpuSeconds -Sum).Sum',
    '[pscustomobject]@{ processCount = $metrics.Count; workingSetBytes = [long]$workingSet; privateBytes = [long]$private; cpuSeconds = [double]$cpuTotal; cpuTimeResolution = "PowerShell Get-Process CPU seconds" } | ConvertTo-Json -Compress',
  ].join('\n').replace('__ROOT_PID__', String(rootPid));
  const stdout = runSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  return JSON.parse(stdout);
}

function collectUnixProcessTree(rootPid) {
  const output = runSync('ps', ['-axo', 'pid=,ppid=,rss=,time=']);
  const processes = output.split(/\r?\n/).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([0-9:]+)$/);
    if (!match) {
      return null;
    }
    return {
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      residentKb: Number(match[3]),
      cpuSeconds: parseCpuTime(match[4]),
    };
  }).filter(Boolean);
  const processIds = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (processIds.has(process.parentPid) && !processIds.has(process.pid)) {
        processIds.add(process.pid);
        changed = true;
      }
    }
  }
  const children = processes.filter(process => processIds.has(process.pid));
  if (!children.length) {
    throw new Error('Process tree is unavailable for PID ' + rootPid);
  }
  return {
    processCount: children.length,
    workingSetBytes: children.reduce((sum, process) => sum + process.residentKb * 1024, 0),
    privateBytes: null,
    cpuSeconds: children.reduce((sum, process) => sum + process.cpuSeconds, 0),
    cpuTimeResolution: 'ps cumulative CPU time rounded to seconds',
  };
}

export function collectProcessTree(rootPid) {
  if (!rootPid) {
    throw new Error('The browser or Electron process ID is unavailable.');
  }
  return process.platform === 'win32'
    ? collectWindowsProcessTree(rootPid)
    : collectUnixProcessTree(rootPid);
}

export function calculateIdleCpuPercent(before, after, durationMs, logicalCores = cpus().length) {
  const seconds = Math.max(0, after.cpuSeconds - before.cpuSeconds);
  return Math.round((seconds / (durationMs / 1000) / logicalCores) * 10000) / 100;
}

export const hostDescription = {
  name(value) {
    if (value === 'win32') {
      return 'windows';
    }
    if (value === 'darwin') {
      return 'macos';
    }
    return value;
  },
  async hardware() {
    const cpu = cpus();
    return {
      os: {
        platform: platform(),
        name: this.name(platform()),
        release: release(),
        version: osVersion(),
        architecture: arch(),
      },
      hardware: {
        cpuModel: cpu[0]?.model ?? null,
        logicalCores: cpu.length,
        totalMemoryBytes: totalmem(),
      },
    };
  },
};
