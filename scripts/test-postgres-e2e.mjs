import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const image = 'postgres:17-alpine';
const containerName = `it-tools-postgres-e2e-${randomUUID().slice(0, 8)}`;
let containerId;
let testFailure;
let cleanupConfirmed = false;

try {
  const imageId = (await run('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).trim();
  console.info(`[postgres-e2e] image=${image} id=${imageId}`);

  containerId = (await run('docker', [
    'run', '--detach', '--rm', '--name', containerName,
    '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust',
    image,
  ])).trim();
  console.info('[postgres-e2e] start=running');

  const mappedPort = parseMappedPort(await run('docker', ['port', containerId, '5432/tcp']));
  await waitForPostgres(containerId);
  const serverVersion = (await run('docker', ['exec', containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', 'SHOW server_version'])).trim();
  if (Number(serverVersion.split('.')[0]) < 17) {
    throw new Error(`PostgreSQL baseline is below 17: ${serverVersion}`);
  }
  console.info(`[postgres-e2e] server=${serverVersion} port=127.0.0.1:${mappedPort}`);

  const buildExitCode = await runPnpm(['electron:build']);
  if (buildExitCode !== 0) {
    throw new Error(`Electron build exited with code ${buildExitCode}.`);
  }

  await run('docker', [
    'exec', containerId, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c',
    `CREATE TABLE public.s2a_structure_probe (probe_id integer PRIMARY KEY, probe_value text NOT NULL DEFAULT 'fixture');
     INSERT INTO public.s2a_structure_probe (probe_id, probe_value) VALUES (1, 'structure test');
     CREATE TABLE public.s2b_keyset_probe (probe_id integer PRIMARY KEY, probe_value text NOT NULL, nullable_value text);
     INSERT INTO public.s2b_keyset_probe (probe_id, probe_value, nullable_value) SELECT value, CASE WHEN value = 1 THEN repeat('x', 10000) ELSE 'row ' || value END, NULL FROM generate_series(1, 56) AS series(value);
     CREATE TABLE public.s2b_offset_probe (probe_value text NOT NULL);
     INSERT INTO public.s2b_offset_probe (probe_value) SELECT 'row ' || value FROM generate_series(1, 30) AS series(value);
     CREATE FUNCTION public.s2d_slow_text() RETURNS text LANGUAGE plpgsql VOLATILE AS $$ BEGIN PERFORM pg_sleep(30); RETURN 'slow'; END $$;
     CREATE VIEW public.s2d_slow_view AS SELECT value AS id, public.s2d_slow_text() AS delayed_value FROM generate_series(1, 1) AS series(value)`,
  ]);

  const serviceTestExitCode = await runPnpm(
    ['exec', 'vitest', 'run', 'electron/database/postgres-service.integration.test.ts', '--environment', 'jsdom'],
    { ...process.env, IT_TOOLS_TEST_POSTGRES_PORT: String(mappedPort) },
  );
  if (serviceTestExitCode !== 0) {
    throw new Error(`PostgreSQL row preview integration exited with code ${serviceTestExitCode}.`);
  }

  const exitCode = await runPlaywright(mappedPort);
  if (exitCode !== 0) {
    throw new Error(`Electron PostgreSQL metadata E2E exited with code ${exitCode}.`);
  }
}
catch (error) {
  testFailure = error;
}
finally {
  if (containerId) {
    try {
      await run('docker', ['rm', '--force', containerId]);
    }
    catch {
      // Docker can report that an auto-removed container is already gone; verify by id below.
    }
    try {
      const remaining = (await run('docker', ['ps', '--all', '--quiet', '--filter', `id=${containerId}`])).trim();
      cleanupConfirmed = remaining === '';
    }
    catch {
      cleanupConfirmed = false;
    }
  }
  else {
    cleanupConfirmed = true;
  }
  console.info(`[postgres-e2e] cleanup=${cleanupConfirmed ? 'confirmed' : 'failed'}`);
}

if (testFailure) {
  console.error(`[postgres-e2e] failed: ${getSafeErrorMessage(testFailure)}`);
}
if (testFailure || !cleanupConfirmed) {
  process.exitCode = 1;
}

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
    child.once('exit', code => resolve(code ?? 1));
  });
}

function parseMappedPort(value) {
  const match = value.match(/:(\d+)\s*$/m);
  if (!match) {
    throw new Error('Docker did not return a mapped PostgreSQL port.');
  }
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Docker returned an invalid mapped PostgreSQL port.');
  }
  return port;
}

async function waitForPostgres(id) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      await run('docker', ['exec', id, 'pg_isready', '-U', 'postgres', '-d', 'postgres']);
      return;
    }
    catch {
      await delay(500);
    }
  }
  throw new Error('The local PostgreSQL container did not become ready within 45 seconds.');
}

function runPlaywright(port) {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      'test:e2e:electron',
      '--grep',
      'connects over a trusted local socket and browses bounded keyset and offset pages',
    ], {
      env: { ...process.env, IT_TOOLS_TEST_POSTGRES_PORT: String(port) },
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
}

function getSafeErrorMessage(error) {
  if (error instanceof Error && error.message.startsWith('Electron PostgreSQL metadata E2E exited')) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith('PostgreSQL row preview integration exited')) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith('PostgreSQL baseline')) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith('The local PostgreSQL container')) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith('Docker returned')) {
    return error.message;
  }
  return 'Docker setup or the PostgreSQL check failed. Review the preceding non-secret diagnostics.';
}
