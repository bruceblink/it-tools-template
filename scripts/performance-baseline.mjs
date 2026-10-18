import { access, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { preview } from 'vite';
import {
  findReleaseInstallers,
  getSourceIdentity,
  hostDescription,
  locateChrome,
  locateElectron,
  measureDirectory,
  projectRoot,
  sha256,
} from './performance-baseline/host.mjs';
import {
  buildJsonWorkloads,
  mathWorkload,
  regexWorkload,
  routeCases,
  runElectronSample,
  runWebSample,
  summarizePlatform,
} from './performance-baseline/runtime.mjs';

const packageMetadata = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
const idleWindowMs = 3000;

function parseOptions(argv) {
  const options = { runs: 20, platform: 'all', output: 'docs/performance-baseline.json', force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
    }
    else if (argument === '--force') {
      options.force = true;
    }
    else if (['--runs', '--platform', '--output'].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for ' + argument);
      }
      index += 1;
      if (argument === '--runs') {
        options.runs = Number(value);
      }
      else if (argument === '--platform') {
        options.platform = value;
      }
      else {
        options.output = value;
      }
    }
    else {
      throw new Error('Unknown argument: ' + argument);
    }
  }

  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 100) {
    throw new Error('--runs must be an integer between 1 and 100.');
  }
  if (!['all', 'web', 'electron'].includes(options.platform)) {
    throw new Error('--platform must be all, web, or electron.');
  }
  return options;
}

function printHelp() {
  console.log([
    'Usage: pnpm perf:baseline -- [options]',
    '',
    'Options:',
    '  --runs <count>         Repetitions per selected platform (default: 20)',
    '  --platform <all|web|electron>  Select measured runtime (default: all)',
    '  --output <path>        JSON report path (default: docs/performance-baseline.json)',
    '  --force                Replace the selected report file',
    '',
    'Prerequisites: production dist/ and the current platform electron-builder unpacked app.',
    'Set CHROME_BIN and ELECTRON_BIN to override executable discovery.',
  ].join('\n'));
}

function displayPath(path) {
  const relativePath = relative(projectRoot, path);
  return relativePath === '..' || relativePath.startsWith('..' + sep)
    ? basename(path)
    : relativePath;
}

async function createEnvironmentReport(source, webDirectory, electronExecutable, bundleReport) {
  const machine = await hostDescription.hardware();
  const webArtifacts = await measureDirectory(webDirectory);
  const electronDirectory = electronExecutable ? dirname(electronExecutable) : null;
  const electronArtifacts = electronDirectory ? await measureDirectory(electronDirectory) : null;
  if (electronArtifacts) {
    electronArtifacts.path = displayPath(electronDirectory);
  }
  return {
    ...machine,
    runtime: {
      node: process.version,
      packageManager: packageMetadata.packageManager,
      electronDeclared: packageMetadata.devDependencies?.electron ?? packageMetadata.dependencies?.electron ?? null,
      electronRuntime: null,
      electronChrome: null,
      electronNode: null,
      appVersion: null,
      chrome: null,
    },
    source,
    artifacts: {
      web: { ...webArtifacts, mode: 'production Vite build' },
      electron: electronArtifacts ? {
        ...electronArtifacts,
        executable: displayPath(electronExecutable),
        executableBytes: (await lstat(electronExecutable)).size,
        mode: 'electron-builder unpacked production application',
      } : { available: false, reason: 'Electron runtime was not selected.' },
      installers: await findReleaseInstallers(),
      bundleBudgets: bundleReport?.budgets ?? null,
      bundlePrecacheBytes: bundleReport?.precache?.bytes ?? null,
      bundleInitialJavaScriptGzipBytes: bundleReport?.initial?.javaScriptGzipBytes ?? null,
      bundlePendingOptimizations: bundleReport?.pendingOptimizations ?? null,
    },
  };
}

function buildCoverage(selectedPlatforms, sampleCounts) {
  const measuredHost = machinePlatformName();
  const unmeasuredPlatforms = ['windows', 'linux', 'macos'].filter(name => name !== measuredHost);
  const gaps = [
    'Signed PDF file parsing was not measured; the baseline measures PDF dependency and page readiness.',
    'Camera and microphone permissions or capture were not requested; only Camera Recorder page readiness was measured.',
    'Catastrophic regex-backtracking payloads were excluded until P2 provides bounded, cancellable execution.',
    'Native-window timing and user-visible interaction require a separate Computer Use run; these samples use automated browser control.',
  ];
  if (unmeasuredPlatforms.length) {
    gaps.push('No measurements were taken on: ' + unmeasuredPlatforms.join(', ') + '.');
  }
  return {
    measuredHost,
    selectedRuntimes: selectedPlatforms,
    repetitionsPerRuntime: sampleCounts,
    meetsTwentyRunTarget: selectedPlatforms.every(runtime => sampleCounts[runtime] >= 20),
    unmeasuredPlatforms,
    gaps,
  };
}

function machinePlatformName() {
  if (process.platform === 'win32') {
    return 'windows';
  }
  if (process.platform === 'darwin') {
    return 'macos';
  }
  return process.platform;
}

async function writeReport(outputPath, report, force) {
  const absolutePath = resolve(projectRoot, outputPath);
  const relativePath = relative(projectRoot, absolutePath);
  if (relativePath === '..' || relativePath.startsWith('..' + sep)) {
    throw new Error('Report output must stay inside the repository.');
  }
  await mkdir(dirname(absolutePath), { recursive: true });
  if (!force) {
    try {
      await access(absolutePath);
      throw new Error('Report already exists. Choose a new path or pass --force: ' + relativePath);
    }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('Report already exists.')) {
        throw error;
      }
    }
  }
  const temporaryPath = absolutePath + '.tmp-' + process.pid;
  await writeFile(temporaryPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await rm(absolutePath, { force: true });
  await rename(temporaryPath, absolutePath);
  return relativePath;
}

const options = parseOptions(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const webDirectory = resolve(projectRoot, 'dist');
const bundleReport = await readFile(resolve(webDirectory, 'bundle-report.json'), 'utf8').then(JSON.parse).catch(() => null);
const selectedPlatforms = options.platform === 'all' ? ['web', 'electron'] : [options.platform];
const chromeExecutable = selectedPlatforms.includes('web') ? await locateChrome() : null;
const electronExecutable = selectedPlatforms.includes('electron') ? await locateElectron() : null;
if (selectedPlatforms.includes('web')) {
  await access(resolve(webDirectory, 'index.html'));
}

const source = await getSourceIdentity();
const tempRoot = await mkdtemp(resolve(tmpdir(), 'it-tools-perf-'));
const workloads = buildJsonWorkloads(sha256);
const previewOptions = {
  root: projectRoot,
  configFile: resolve(projectRoot, 'vite.config.ts'),
  preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
};
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  status: 'measured',
  configuration: {
    runsRequested: options.runs,
    idleWindowMs,
    selectedPlatforms,
    webSource: 'dist served by Vite preview on loopback',
    webAutomation: 'headless Chrome with a fresh profile per run',
    electronAutomation: 'packaged application with a fresh user-data directory per run',
    syntheticInputIsolation: 'renderer reload between interaction workloads',
    routeCases: routeCases.map(({ id, path, query }) => ({ id, path, query })),
    syntheticInputs: {
      json: workloads.map(({ name, inputBytes, outputBytes, outputSha256 }) => ({ name, inputBytes, outputBytes, outputSha256 })),
      regex: { name: regexWorkload.name, pattern: regexWorkload.pattern, inputBytes: Buffer.byteLength(regexWorkload.text) },
      math: { name: mathWorkload.name, inputBytes: Buffer.byteLength(mathWorkload.expression), expectedResult: mathWorkload.result },
    },
    chromeExecutable: chromeExecutable ? basename(chromeExecutable) : null,
    electronExecutable: electronExecutable ? displayPath(electronExecutable) : null,
  },
  environment: await createEnvironmentReport(source, webDirectory, electronExecutable, bundleReport),
  samples: { web: [], electron: [] },
  failures: [],
  summary: { web: null, electron: null },
  coverage: null,
};

let previewServer;
try {
  if (selectedPlatforms.includes('web')) {
    previewServer = await preview(previewOptions);
    const address = previewServer.httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Vite preview did not expose a TCP port.');
    }
    report.configuration.webBaseUrl = 'http://127.0.0.1:' + address.port;
  }

  for (let index = 1; index <= options.runs; index += 1) {
    try {
      if (selectedPlatforms.includes('web')) {
        const sample = await runWebSample(index, { chromeExecutable }, report.configuration.webBaseUrl, workloads);
        report.samples.web.push(sample);
        report.environment.runtime.chrome = sample.browserVersion;
        console.log('[perf] Web run ' + index + '/' + options.runs + ': startup ' + sample.startupMs + ' ms');
      }
      if (selectedPlatforms.includes('electron')) {
        const sample = await runElectronSample(index, { electronExecutable }, tempRoot, workloads);
        report.samples.electron.push(sample);
        report.environment.runtime.electronRuntime = sample.electronVersion;
        report.environment.runtime.electronChrome = sample.electronChrome;
        report.environment.runtime.electronNode = sample.electronNode;
        report.environment.runtime.appVersion = sample.appVersion;
        console.log('[perf] Electron run ' + index + '/' + options.runs + ': startup ' + sample.startupMs + ' ms');
      }
    }
    catch (error) {
      report.failures.push({
        iteration: index,
        message: (error instanceof Error ? error.message : String(error)).split(/\r?\n/, 1)[0].slice(0, 400),
      });
      console.error('[perf] Stopped at run ' + index + ': ' + report.failures.at(-1).message);
      break;
    }
  }

  for (const runtime of selectedPlatforms) {
    report.summary[runtime] = summarizePlatform(report.samples[runtime], workloads);
  }
  const sampleCounts = Object.fromEntries(selectedPlatforms.map(runtime => [runtime, report.samples[runtime].length]));
  report.coverage = buildCoverage(selectedPlatforms, sampleCounts);
  if (report.failures.length || selectedPlatforms.some(runtime => report.samples[runtime].length !== options.runs)) {
    report.status = 'incomplete';
  }
  else if (options.runs < 20) {
    report.status = 'exploratory';
  }

  const outputPath = await writeReport(options.output, report, options.force);
  console.log('[perf] Report: ' + outputPath);
  console.log(JSON.stringify({
    status: report.status,
    samples: sampleCounts,
    summary: report.summary,
    gaps: report.coverage.gaps,
  }, null, 2));
  if (report.status === 'incomplete') {
    process.exitCode = 1;
  }
}
finally {
  await previewServer?.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}
