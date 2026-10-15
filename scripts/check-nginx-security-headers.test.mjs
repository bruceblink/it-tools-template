// These tests use mocked Docker CLI results and never start a container.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { cleanupContainer, finishContainerCheck, runDocker } from './check-nginx-security-headers.mjs';

test('log read failure still attempts cleanup for the named container', async () => {
  const calls = [];
  const containerName = 'it-tools-security-headers-test-unique';
  const runDockerCommand = async (args) => {
    calls.push(args);
    throw new Error('mocked Docker logs failure');
  };
  let cleanupName;
  let errorOutput = '';

  await finishContainerCheck(containerName, new Error('mocked check failure'), {
    runDockerCommand,
    cleanup: async (name, passedRunner) => {
      cleanupName = name;
      assert.equal(passedRunner, runDockerCommand);
      return 'mocked cleanup';
    },
    writeError: message => { errorOutput += message; },
    writeOutput: () => {},
  });

  assert.deepEqual(calls, [['logs', '--tail', '80', containerName]]);
  assert.equal(cleanupName, containerName);
  assert.match(errorOutput, /cleanup will continue/);
});

test('daemon errors are not treated as proof that the container is absent', async () => {
  const containerName = 'it-tools-security-headers-test-unique';
  const calls = [];
  const runDockerCommand = async (args) => {
    calls.push(args);
    return { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' };
  };

  await assert.rejects(
    cleanupContainer(containerName, runDockerCommand),
    error => error instanceof AggregateError && /Could not verify cleanup/.test(error.message),
  );
  assert.deepEqual(calls, [
    ['container', 'inspect', containerName],
    ['rm', '--force', containerName],
    ['container', 'inspect', containerName],
  ]);
});

test('cleanup removes only its named container and verifies that name is absent', async () => {
  const containerName = 'it-tools-security-headers-test-unique';
  const calls = [];
  const runDockerCommand = async (args) => {
    calls.push(args);
    if (args[0] === 'container') {
      const inspectCount = calls.filter(call => call[0] === 'container').length;
      return inspectCount === 1
        ? { code: 0, stdout: '', stderr: '' }
        : { code: 1, stdout: '', stderr: `Error: No such object: ${containerName}` };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  assert.equal(await cleanupContainer(containerName, runDockerCommand), 'force-removed and verified');
  assert.deepEqual(calls, [
    ['container', 'inspect', containerName],
    ['rm', '--force', containerName],
    ['container', 'inspect', containerName],
  ]);
});

test('Docker CLI timeout terminates the mocked child process', async () => {
  const signals = [];
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      signals.push(signal);
      queueMicrotask(() => child.emit('close', null, signal));
      return true;
    };
    child.unref = () => {};
    return child;
  };

  await assert.rejects(
    runDocker(['version'], { timeoutMs: 5, spawnProcess }),
    /timed out after 5 ms/,
  );
  assert.deepEqual(signals, ['SIGTERM']);
});
