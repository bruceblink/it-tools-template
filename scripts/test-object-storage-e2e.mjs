import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const image = 'rustfs/rustfs@sha256:1803faef57627e2d9c2e7d89d655d712ddded5389040054987163043fecb6a3c';
const containerName = `it-tools-storage-e2e-${randomUUID().slice(0, 8)}`;
const accessKey = 'ie-tools-e2e-access-controller';
const secretKey = 'synthetic-e2e-secret-not-for-production';
const bucket = `it-tools-e2e-${Date.now()}`;
let containerId;
let testFailure;
let cleanupConfirmed = false;

try {
  const imageId = (await run('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).trim();
  console.info(`[object-storage-e2e] image=${image} id=${imageId}`);
  containerId = (
    await run('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '--publish',
      '127.0.0.1::9000',
      '--env',
      `RUSTFS_ACCESS_KEY=${accessKey}`,
      '--env',
      `RUSTFS_SECRET_KEY=${secretKey}`,
      image,
    ])
  ).trim();
  console.info('[object-storage-e2e] start=running');
  const port = parseMappedPort(await run('docker', ['port', containerId, '9000/tcp']));
  await waitForStorage(port);
  console.info(`[object-storage-e2e] server=rustfs-1.0.1 port=127.0.0.1:${port}`);

  const buildExitCode = await runPnpm(['electron:build']);
  if (buildExitCode !== 0) {
    throw new Error(`Electron build exited with code ${buildExitCode}.`);
  }
  const testExitCode = await runPnpm(['test:e2e:electron', 'electron/object-storage.e2e.spec.ts'], {
    ...process.env,
    IT_TOOLS_TEST_STORAGE_ENDPOINT: `http://127.0.0.1:${port}`,
    IT_TOOLS_TEST_STORAGE_ACCESS_KEY: accessKey,
    IT_TOOLS_TEST_STORAGE_SECRET_KEY: secretKey,
    IT_TOOLS_TEST_STORAGE_BUCKET: bucket,
  });
  if (testExitCode !== 0) {
    throw new Error(`Object storage Electron E2E exited with code ${testExitCode}.`);
  }
} catch (error) {
  testFailure = error;
} finally {
  if (containerId) {
    try {
      await run('docker', ['rm', '--force', containerId]);
    } catch {
      /* verify by id below */
    }
    try {
      cleanupConfirmed =
        (await run('docker', ['ps', '--all', '--quiet', '--filter', `id=${containerId}`])).trim() === '';
    } catch {
      cleanupConfirmed = false;
    }
  } else {
    cleanupConfirmed = true;
  }
  console.info(`[object-storage-e2e] cleanup=${cleanupConfirmed ? 'confirmed' : 'failed'}`);
}
if (testFailure) console.error(`[object-storage-e2e] failed: ${safeMessage(testFailure)}`);
if (testFailure || !cleanupConfirmed) process.exitCode = 1;

async function run(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}
function runPnpm(args, environment = process.env) {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
function parseMappedPort(value) {
  const match = value.match(/:(\d+)\s*$/m);
  if (!match) throw new Error('Docker did not return a mapped RustFS port.');
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Docker returned an invalid RustFS port.');
  return port;
}
async function waitForStorage(port) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.status < 500) return;
    } catch {
      /* service is still starting */
    }
    await delay(500);
  }
  throw new Error('The local RustFS container did not become ready within 45 seconds.');
}
function safeMessage(error) {
  if (
    error instanceof Error &&
    /^(Electron build|Object storage Electron E2E|The local RustFS|Docker)/.test(error.message)
  )
    return error.message;
  return 'Docker setup or the object storage check failed. Review the preceding non-secret diagnostics.';
}
