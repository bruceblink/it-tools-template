import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const image = 'rustfs/rustfs@sha256:1803faef57627e2d9c2e7d89d655d712ddded5389040054987163043fecb6a3c';
const containerName = `it-tools-container-e2e-${randomUUID().slice(0, 8)}`;
const accessKey = 'it-tools-container-e2e-access';
const secretKey = 'synthetic-container-e2e-secret';
let containerId;
let testFailure;
let cleanupConfirmed = false;

try {
  const imageId = (await run('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).trim();
  console.info(`[container-workbench-e2e] image=${image} id=${imageId}`);
  const displayedImageId = imageId.replace(/^sha256:/, '').slice(0, 12);
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
  const mappedPort = parseMappedPort(await run('docker', ['port', containerId, '9000/tcp']));
  console.info(`[container-workbench-e2e] server=rustfs-1.0.1 port=127.0.0.1:${mappedPort}`);

  const buildExitCode = await runPnpm(['electron:build']);
  if (buildExitCode !== 0) {
    throw new Error(`Electron build exited with code ${buildExitCode}.`);
  }
  const testExitCode = await runPnpm(['test:e2e:electron', 'electron/container-workbench.e2e.spec.ts'], {
    ...process.env,
    IT_TOOLS_TEST_CONTAINER_NAME: containerName,
    IT_TOOLS_TEST_CONTAINER_IMAGE: displayedImageId,
  });
  if (testExitCode !== 0) {
    throw new Error(`Container workbench Electron E2E exited with code ${testExitCode}.`);
  }
} catch (error) {
  testFailure = error;
} finally {
  if (containerId) {
    try {
      await run('docker', ['rm', '--force', containerId]);
    } catch {
      /* verify by ID below */
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
  console.info(`[container-workbench-e2e] cleanup=${cleanupConfirmed ? 'confirmed' : 'failed'}`);
}
if (testFailure) console.error(`[container-workbench-e2e] failed: ${safeMessage(testFailure)}`);
if (testFailure || !cleanupConfirmed) process.exitCode = 1;

function run(command, args) {
  return execFileAsync(command, args, {
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  }).then(({ stdout }) => stdout);
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
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Docker returned an invalid port.');
  return port;
}

function safeMessage(error) {
  if (error instanceof Error && /^(Electron build|Container workbench Electron E2E|Docker)/.test(error.message)) {
    return error.message;
  }
  return 'Docker setup or the container workbench check failed. Review the preceding non-secret diagnostics.';
}
