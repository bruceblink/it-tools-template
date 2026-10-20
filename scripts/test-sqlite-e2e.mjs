import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fixtureDirectory = '';
let testFailure;
let cleanupConfirmed = false;

try {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'it-tools-sqlite-e2e-'));
  const fixturePath = join(fixtureDirectory, 'database.sqlite');
  const database = new DatabaseSync(fixturePath);
  try {
    database.exec(`
      CREATE TABLE s3_sqlite_probe (
        id INTEGER NOT NULL,
        username TEXT NOT NULL,
        nickname TEXT,
        payload BLOB,
        PRIMARY KEY (id, username)
      );
      CREATE UNIQUE INDEX uq_s3_sqlite_username ON s3_sqlite_probe(username);
      CREATE VIEW s3_sqlite_probe_view AS SELECT id, username FROM s3_sqlite_probe;
      INSERT INTO s3_sqlite_probe (id, username, nickname) VALUES (1, 'sqlite-user', 'local');
    `);
  }
  finally {
    database.close();
  }
  const version = new DatabaseSync(fixturePath, { readOnly: true });
  try {
    const row = version.prepare('SELECT sqlite_version() AS version').get();
    console.info(`[sqlite-e2e] sqlite=${row.version} fixture=temporary-local-file`);
  }
  finally {
    version.close();
  }

  const environment = { ...process.env, IT_TOOLS_TEST_SQLITE_FILE: fixturePath };
  const buildExitCode = await runPnpm(['electron:build']);
  if (buildExitCode !== 0) {
    throw new Error(`Electron build exited with code ${buildExitCode}.`);
  }

  const serviceTestExitCode = await runPnpm([
    'exec', 'vitest', 'run', 'electron/database/sqlite-service.integration.test.ts',
    'electron/database/protocol.test.ts', '--environment', 'jsdom',
  ], environment);
  if (serviceTestExitCode !== 0) {
    throw new Error(`SQLite metadata service integration exited with code ${serviceTestExitCode}.`);
  }

  const e2eExitCode = await runPnpm([
    'test:e2e:electron',
    '--grep',
    'opens a user-selected file read-only and browses its structure',
  ], environment);
  if (e2eExitCode !== 0) {
    throw new Error(`Electron SQLite metadata E2E exited with code ${e2eExitCode}.`);
  }
}
catch (error) {
  testFailure = error;
}
finally {
  if (fixtureDirectory) {
    try {
      await rm(fixtureDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      cleanupConfirmed = true;
    }
    catch {
      cleanupConfirmed = false;
    }
  }
  else {
    cleanupConfirmed = true;
  }
  console.info(`[sqlite-e2e] cleanup=${cleanupConfirmed ? 'confirmed' : 'failed'}`);
}

if (testFailure) {
  console.error(`[sqlite-e2e] failed: ${getSafeErrorMessage(testFailure)}`);
}
if (testFailure || !cleanupConfirmed) {
  process.exitCode = 1;
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

function getSafeErrorMessage(error) {
  if (error instanceof Error && error.message.startsWith('Electron build exited')) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith('SQLite metadata service integration exited')) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith('Electron SQLite metadata E2E exited')) {
    return error.message;
  }
  return 'SQLite setup or the local SQLite check failed. Review the preceding non-sensitive diagnostics.';
}
