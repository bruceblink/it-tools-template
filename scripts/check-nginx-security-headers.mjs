import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildResponseHeaders, loadSecurityHeaderConfig } from './sync-security-headers.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = 'nginx:stable-alpine';
const port = 18080;
const containerPrefix = 'it-tools-security-headers';
const startupTimeoutMs = 15000;
const requestTimeoutMs = 3000;
const dockerCommandTimeoutMs = 30000;
const dockerCommandKillGraceMs = 2000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function runDocker(args, {
  allowFailure = false,
  timeoutMs = dockerCommandTimeoutMs,
  spawnProcess = spawn,
} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnProcess('docker', args, {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeoutTimer;
    let killTimer;
    let hardKillTimer;

    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      clearTimeout(hardKillTimer);
    };
    const settle = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      callback();
    };
    const terminate = (signal) => {
      try {
        child.kill(signal);
      }
      catch {
        // Continue to the forced-termination attempt if the child is already unavailable.
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => settle(() => rejectPromise(error)));
    child.once('close', (code) => {
      const result = { code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() };
      if (timedOut) {
        settle(() => rejectPromise(new Error(`docker ${args.join(' ')} timed out after ${timeoutMs} ms.`)));
        return;
      }
      if (result.code !== 0 && !allowFailure) {
        settle(() => rejectPromise(new Error(`docker ${args.join(' ')} failed: ${result.stderr || result.stdout || `exit code ${result.code}`}`)));
        return;
      }
      settle(() => resolvePromise(result));
    });

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      killTimer = setTimeout(() => {
        terminate('SIGKILL');
        hardKillTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          settle(() => rejectPromise(new Error(`docker ${args.join(' ')} timed out after ${timeoutMs} ms and did not exit after forced termination.`)));
        }, dockerCommandKillGraceMs);
      }, dockerCommandKillGraceMs);
    }, timeoutMs);
  });
}

class CancellationRequestedError extends Error {
  constructor(signal, cause) {
    const detail = cause ? ` Last operation: ${errorMessage(cause)}` : '';
    super(`${signal} received; check cancelled.${detail}`, cause ? { cause } : undefined);
    this.name = 'CancellationRequestedError';
    this.signal = signal;
    this.exitCode = signal === 'SIGINT' ? 130 : 143;
  }
}

function createCancellationState() {
  let requestedSignal = null;

  const onSignal = (signal) => {
    if (requestedSignal !== null) {
      return;
    }
    requestedSignal = signal;
    try {
      process.stderr.write(`${signal} received; waiting for the current operation and cleanup.\n`);
    }
    catch {
      // A closed output stream must not interrupt cancellation cleanup.
    }
  };

  return {
    install() {
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
    },
    dispose() {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    },
    throwIfRequested() {
      if (requestedSignal !== null) {
        throw new CancellationRequestedError(requestedSignal);
      }
    },
    get signal() {
      return requestedSignal;
    },
  };
}

async function runDockerChecked(args, options, cancellation) {
  cancellation.throwIfRequested();
  const result = await runDocker(args, options);
  cancellation.throwIfRequested();
  return result;
}

function assertPortFree(host, selectedPort) {
  return new Promise((resolvePromise, rejectPromise) => {
    const probe = createServer();
    probe.once('error', (error) => {
      rejectPromise(new Error(`Cannot use ${host}:${selectedPort}; the port is already occupied (${error.message}).`));
    });
    probe.listen(selectedPort, host, () => {
      probe.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    });
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  }
  catch {
    return false;
  }
}

async function findBuildResources(distPath) {
  const indexHtml = await readFile(resolve(distPath, 'index.html'), 'utf8');
  const localResources = [...indexHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)]
    .map(match => match[1])
    .map((value) => {
      const url = new URL(value, 'http://security-header-audit.local/');
      return url.origin === 'http://security-header-audit.local' ? url.pathname : null;
    })
    .filter(Boolean);
  const javascript = localResources.find(path => /\.js$/i.test(path));
  const stylesheet = localResources.find(path => /\.css$/i.test(path));
  if (!javascript || !stylesheet) {
    throw new Error('dist/index.html must reference a same-origin JavaScript bundle and CSS bundle before this check runs.');
  }

  const paths = ['/', '/jwt-signer', javascript, stylesheet];
  for (const filename of ['sw.js', 'service-worker.js', 'manifest.webmanifest']) {
    if (await exists(resolve(distPath, filename))) {
      paths.push(`/${filename}`);
    }
  }
  return paths;
}

function assertHeaders(response, expectedHeaders, path) {
  for (const [name, value] of expectedHeaders) {
    const actual = response.headers.get(name);
    if (actual !== value) {
      throw new Error(`${path} returned ${name}: ${JSON.stringify(actual)}; expected ${JSON.stringify(value)}.`);
    }
  }
}

async function waitUntilReady(url, cancellation) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    cancellation.throwIfRequested();
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
    }
    catch {
      // The container can take a short time to bind the published port.
    }
    cancellation.throwIfRequested();
    if (response?.ok) {
      return response;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200));
  }
  throw new Error(`Nginx did not become ready at ${url} within ${startupTimeoutMs} ms.`);
}

async function inspectResponse(baseUrl, path, expectedHeaders, contentTypePrefix, cancellation) {
  cancellation.throwIfRequested();
  const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(requestTimeoutMs) });
  cancellation.throwIfRequested();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}.`);
  }
  assertHeaders(response, expectedHeaders, path);
  if (contentTypePrefix && !response.headers.get('content-type')?.startsWith(contentTypePrefix)) {
    throw new Error(`${path} returned an unexpected Content-Type: ${response.headers.get('content-type')}.`);
  }
  process.stdout.write(`HTTP ${response.status} ${path}: security headers verified.\n`);
}

async function verifyErrorResponse(baseUrl, expectedHeaders, cancellation) {
  cancellation.throwIfRequested();
  const response = await fetch(baseUrl, {
    method: 'POST',
    body: '',
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  cancellation.throwIfRequested();
  if (response.status < 400) {
    throw new Error(`POST / returned HTTP ${response.status}; expected an error response to verify Nginx always headers.`);
  }
  assertHeaders(response, expectedHeaders, 'POST / error response');
  process.stdout.write(`HTTP ${response.status} POST /: always headers verified on an error response.\n`);
}

// Remove only this run's unique container, then verify that Docker no longer lists it.
function isMissingContainer(result, containerName) {
  const output = `${result.stderr}\n${result.stdout}`;
  return result.code !== 0
    && (output.includes(`No such object: ${containerName}`)
      || output.includes(`No such container: ${containerName}`));
}

function dockerCommandError(args, result) {
  return new Error(`docker ${args.join(' ')} failed: ${result.stderr || result.stdout || `exit code ${result.code}`}`);
}

export async function cleanupContainer(containerName, runDockerCommand = runDocker) {
  const inspectArgs = ['container', 'inspect', containerName];
  let initialError;
  try {
    const existing = await runDockerCommand(inspectArgs, { allowFailure: true });
    if (isMissingContainer(existing, containerName)) {
      return 'not created or already removed';
    }
    if (existing.code !== 0) {
      initialError = dockerCommandError(inspectArgs, existing);
    }
  }
  catch (error) {
    initialError = error;
  }

  const removeArgs = ['rm', '--force', containerName];
  let removeError;
  try {
    const removed = await runDockerCommand(removeArgs, { allowFailure: true });
    if (removed.code !== 0 && !isMissingContainer(removed, containerName)) {
      removeError = dockerCommandError(removeArgs, removed);
    }
  }
  catch (error) {
    removeError = error;
  }

  let remaining;
  try {
    remaining = await runDockerCommand(inspectArgs, { allowFailure: true });
  }
  catch (error) {
    throw new AggregateError([initialError, removeError, error].filter(Boolean), `Could not verify cleanup for container ${containerName}.`);
  }
  if (isMissingContainer(remaining, containerName)) {
    return initialError || removeError ? 'absence verified after a cleanup error' : 'force-removed and verified';
  }
  if (remaining.code === 0) {
    throw new AggregateError([initialError, removeError].filter(Boolean), `Container cleanup failed; ${containerName} still exists.`);
  }

  throw new AggregateError([initialError, removeError, dockerCommandError(inspectArgs, remaining)].filter(Boolean), `Could not verify cleanup for container ${containerName}.`);
}

export async function finishContainerCheck(containerName, checkError, {
  runDockerCommand = runDocker,
  cleanup = cleanupContainer,
  skipLogs = checkError instanceof CancellationRequestedError,
  writeError = message => process.stderr.write(message),
  writeOutput = message => process.stdout.write(message),
} = {}) {
  let logsError;
  if (checkError && !skipLogs) {
    try {
      const args = ['logs', '--tail', '80', containerName];
      const logs = await runDockerCommand(args, { allowFailure: true });
      if (logs.stdout || logs.stderr) {
        writeError(`Container logs:\n${logs.stdout}\n${logs.stderr}\n`);
      }
      else if (logs.code !== 0) {
        logsError = dockerCommandError(args, logs);
      }
    }
    catch (error) {
      logsError = error;
    }
    if (logsError) {
      try {
        writeError(`Container log read failed; cleanup will continue: ${errorMessage(logsError)}\n`);
      }
      catch {
        // A closed output stream must not prevent container cleanup.
      }
    }
  }

  const cleanupResult = await cleanup(containerName, runDockerCommand);
  try {
    writeOutput(`Container cleanup: ${cleanupResult}.\n`);
  }
  catch {
    // Cleanup has already completed; keep output errors from changing that result.
  }
  return logsError;
}

// Defer cancellation until the current bounded operation ends, then always clean up an attempted run.
async function main(args) {
  const cancellation = createCancellationState();
  cancellation.install();
  let checkError;
  let containerName;
  let dockerRunAttempted = false;

  try {
    if (args.length !== 1 || args[0] !== '--dist-ready') {
      throw new Error('Run only after the final dist build is ready: node scripts/check-nginx-security-headers.mjs --dist-ready');
    }

    const distPath = resolve(repositoryRoot, 'dist');
    if (!await exists(resolve(distPath, 'index.html'))) {
      throw new Error('dist/index.html is missing; build the final distribution before running this check.');
    }
    cancellation.throwIfRequested();

    const dockerVersion = await runDockerChecked(['version', '--format', '{{.Server.Version}}'], undefined, cancellation);
    const imageMetadata = await runDockerChecked(['image', 'inspect', '--format', '{{.Id}}|{{json .RepoDigests}}', image], undefined, cancellation);
    containerName = `${containerPrefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const host = '127.0.0.1';
    const baseUrl = `http://${host}:${port}/`;
    const config = await loadSecurityHeaderConfig();
    const expectedHeaders = buildResponseHeaders(config);
    const paths = await findBuildResources(distPath);
    cancellation.throwIfRequested();

    await assertPortFree(host, port);
    cancellation.throwIfRequested();
    process.stdout.write(`Docker Server version: ${dockerVersion.stdout}\n`);
    process.stdout.write(`Nginx image reference: ${image}\n`);
    process.stdout.write(`Nginx image ID and RepoDigests: ${imageMetadata.stdout}\n`);
    process.stdout.write(`Container name: ${containerName}\n`);
    process.stdout.write(`Port mapping: ${host}:${port}->80 (checked free before start)\n`);

    dockerRunAttempted = true;
    await runDockerChecked([
      'run', '--detach', '--rm',
      '--name', containerName,
      '--publish', `${host}:${port}:80`,
      '--mount', `type=bind,source=${distPath},target=/usr/share/nginx/html,readonly`,
      '--mount', `type=bind,source=${resolve(repositoryRoot, 'nginx.conf')},target=/etc/nginx/conf.d/default.conf,readonly`,
      image,
    ], undefined, cancellation);
    process.stdout.write('Container startup: successful.\n');

    const version = await runDockerChecked(['exec', containerName, 'nginx', '-v'], undefined, cancellation);
    process.stdout.write(`Nginx binary version: ${version.stderr || version.stdout}\n`);
    await runDockerChecked(['exec', containerName, 'nginx', '-t'], undefined, cancellation);
    process.stdout.write('nginx -t: successful.\n');
    await waitUntilReady(baseUrl, cancellation);

    for (const path of paths) {
      const contentType = path.endsWith('.js') ? 'application/javascript'
        : path.endsWith('.css') ? 'text/css'
          : path.endsWith('.html') || path === '/' || !path.includes('.') ? 'text/html'
            : undefined;
      await inspectResponse(baseUrl, path, expectedHeaders, contentType, cancellation);
    }
    await verifyErrorResponse(baseUrl, expectedHeaders, cancellation);
    cancellation.throwIfRequested();
  }
  catch (error) {
    checkError = error;
  }
  finally {
    try {
      if (dockerRunAttempted && containerName) {
        try {
          await finishContainerCheck(containerName, checkError, { skipLogs: cancellation.signal !== null });
        }
        catch (cleanupError) {
          if (checkError) {
            checkError = new AggregateError([checkError, cleanupError], 'Nginx header check failed and container cleanup also failed.');
          }
          else {
            checkError = cleanupError;
          }
        }
      }
    }
    finally {
      cancellation.dispose();
    }
  }

  if (cancellation.signal) {
    if (checkError && !(checkError instanceof CancellationRequestedError)) {
      process.stderr.write(`The check stopped with an error: ${errorMessage(checkError)}\n`);
    }
    throw new CancellationRequestedError(cancellation.signal, checkError);
  }
  if (checkError) {
    throw checkError;
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = error instanceof CancellationRequestedError ? error.exitCode : 1;
  });
}
