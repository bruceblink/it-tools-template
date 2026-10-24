import { composerize } from 'composerize-ts';
import { describe, expect, it } from 'vitest';
import { taskLimits } from '@/task-runner/task-runner.types';
import { executeDockerComposeTask } from './docker-compose-task.service';

function createRequest(value: string, maxOutputBytes = taskLimits.dockerRunToCompose.maxOutputBytes) {
  return {
    id: 1,
    inputVersion: 2,
    task: { kind: 'docker-run-to-compose' as const, value },
    maxOutputBytes,
  };
}

describe('Docker Run to Compose task service', () => {
  it('preserves compose output and diagnostic messages', () => {
    expect(executeDockerComposeTask(createRequest('docker run --name web -p 8080:80 --restart always nginx'), composerize)).toEqual({
      id: 1,
      inputVersion: 2,
      ok: true,
      result: {
        kind: 'docker-run-to-compose',
        yaml: "version: '3.9'\nservices:\n    nginx:\n        image: nginx\n        restart: always\n        ports:\n            - '8080:80'\n        container_name: web\n",
        messages: [],
      },
    });

    expect(executeDockerComposeTask(createRequest('docker run --rm --gpus all --name worker image:tag'), composerize)).toMatchObject({
      ok: true,
      result: {
        messages: [
          { type: 'notTranslatable', value: 'The option "--rm" could not be translated to docker-compose.yml.' },
          { type: 'notImplemented', value: 'The option "--gpus" is not yet implemented.' },
        ],
      },
    });
  });

  it('rejects input above the configured byte limit', () => {
    const request = createRequest('x'.repeat(taskLimits.dockerRunToCompose.maxInputBytes + 1));
    expect(executeDockerComposeTask(request, composerize)).toMatchObject({ ok: false, code: 'input-limit' });
  });

  it('enforces request output limits and the host output ceiling', () => {
    expect(executeDockerComposeTask(createRequest('docker run nginx', 1), composerize)).toMatchObject({ ok: false, code: 'output-limit' });
    const oversizedResult: typeof composerize = () => ({
      yaml: 'x'.repeat(taskLimits.dockerRunToCompose.maxOutputBytes),
      messages: [],
    });
    expect(executeDockerComposeTask(
      createRequest('docker run nginx', taskLimits.dockerRunToCompose.maxOutputBytes + 1),
      oversizedResult,
    )).toMatchObject({ ok: false, code: 'output-limit' });
  });

  it('rejects task kinds that are not supported by this worker', () => {
    const request = { ...createRequest('docker run nginx'), task: { kind: 'json-minify' as const, value: '{}' } };
    expect(executeDockerComposeTask(request, composerize)).toMatchObject({ ok: false, code: 'error' });
  });
});
