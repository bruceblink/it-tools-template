import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const execFileAsync = promisify(execFile);
const image = 'mysql:8.4';
const containerName = `it-tools-mysql-e2e-${randomUUID().slice(0, 8)}`;
const rootPassword = randomBytes(32).toString('hex');
const readerPassword = randomBytes(32).toString('hex');
const writerPassword = randomBytes(32).toString('hex');
let containerId;
let testFailure;
let cleanupConfirmed = false;

try {
  console.info(`[mysql-e2e] image=${image} action=pull`);
  await run('docker', ['pull', image]);
  const imageId = (await run('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])).trim();
  console.info(`[mysql-e2e] image=${image} id=${imageId}`);

  containerId = (await run('docker', [
    'run', '--detach', '--rm', '--name', containerName,
    '--publish', '127.0.0.1::3306',
    '--env', `MYSQL_ROOT_PASSWORD=${rootPassword}`,
    '--health-cmd', 'mysqladmin ping --host=127.0.0.1 --user=root --password="$MYSQL_ROOT_PASSWORD"',
    '--health-interval', '1s',
    '--health-timeout', '3s',
    '--health-retries', '60',
    image,
  ])).trim();
  console.info('[mysql-e2e] start=running');

  const mappedPort = parseMappedPort(await run('docker', ['port', containerId, '3306/tcp']));
  await waitForMySql(containerId);
  const serverVersion = (await runMySql(containerId, rootPassword, 'SELECT VERSION()')).trim();
  if (!/^8\.4\./.test(serverVersion)) {
    throw new Error(`MySQL baseline is not 8.4: ${serverVersion}`);
  }
  console.info(`[mysql-e2e] server=${serverVersion} port=127.0.0.1:${mappedPort}`);

  await runMySql(containerId, rootPassword, `
    CREATE DATABASE it_tools_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
    CREATE TABLE it_tools_e2e.s3_mysql_probe (
      id BIGINT NOT NULL,
      username VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      optional_value VARCHAR(32) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_s3_mysql_username (username),
      KEY idx_s3_mysql_created_at (created_at)
    );
    INSERT INTO it_tools_e2e.s3_mysql_probe (id, username, optional_value) VALUES (1, 'mysql-user', 'sample');
    CREATE VIEW it_tools_e2e.s3_mysql_probe_view AS SELECT id, username FROM it_tools_e2e.s3_mysql_probe;
    CREATE USER 'it_tools_reader'@'%' IDENTIFIED BY '${readerPassword}';
    GRANT SELECT, SHOW VIEW ON it_tools_e2e.* TO 'it_tools_reader'@'%';
    CREATE USER 'it_tools_writer'@'%' IDENTIFIED BY '${writerPassword}';
    GRANT SELECT, INSERT, UPDATE, DELETE, SHOW VIEW ON it_tools_e2e.* TO 'it_tools_writer'@'%';
  `);

  const environment = {
    ...process.env,
    IT_TOOLS_TEST_MYSQL_PORT: String(mappedPort),
    IT_TOOLS_TEST_MYSQL_PASSWORD: readerPassword,
    IT_TOOLS_TEST_MYSQL_WRITER_PASSWORD: writerPassword,
  };
  const buildExitCode = await runPnpm(['electron:build']);
  if (buildExitCode !== 0) {
    throw new Error(`Electron build exited with code ${buildExitCode}.`);
  }

  const serviceTestExitCode = await runPnpm(
    ['exec', 'vitest', 'run', 'electron/database/mysql-service.integration.test.ts', '--environment', 'jsdom'],
    environment,
  );
  if (serviceTestExitCode !== 0) {
    throw new Error(`MySQL metadata service integration exited with code ${serviceTestExitCode}.`);
  }

  const e2eExitCode = await runPnpm([
    'test:e2e:electron',
    '--grep',
    'connects with an ephemeral password and browses table data and structure',
  ], environment);
  if (e2eExitCode !== 0) {
    throw new Error(`Electron MySQL metadata E2E exited with code ${e2eExitCode}.`);
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
  console.info(`[mysql-e2e] cleanup=${cleanupConfirmed ? 'confirmed' : 'failed'}`);
}

if (testFailure) {
  console.error(`[mysql-e2e] failed: ${getSafeErrorMessage(testFailure)}`);
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

async function runMySql(id, password, sql) {
  return run('docker', [
    'exec', '--env', `MYSQL_PWD=${password}`, id,
    'mysql', '--user=root', '--batch', '--skip-column-names', '--execute', sql,
  ]);
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
    throw new Error('Docker did not return a mapped MySQL port.');
  }
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Docker returned an invalid mapped MySQL port.');
  }
  return port;
}

async function waitForMySql(id) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const health = (await run('docker', ['inspect', id, '--format', '{{.State.Health.Status}}'])).trim();
    if (health === 'healthy') {
      return;
    }
    if (health === 'unhealthy') {
      throw new Error('The local MySQL container reported an unhealthy state.');
    }
    await delay(500);
  }
  throw new Error('The local MySQL container did not become ready within 60 seconds.');
}

function getSafeErrorMessage(error) {
  if (error instanceof Error && error.message.startsWith('Electron build exited')) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith('MySQL metadata service integration exited')) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith('Electron MySQL metadata E2E exited')) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith('MySQL baseline')) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith('The local MySQL container')) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith('Docker returned')) {
    return error.message;
  }
  return 'Docker setup or the MySQL check failed. Review the preceding non-secret diagnostics.';
}
