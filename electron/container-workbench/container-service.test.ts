import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTAINER_LIST_TIMEOUT_MS, CONTAINER_MAX_OUTPUT_BYTES } from '../../src/shared/desktop-services/container-workbench';
import { ContainerWorkbenchService } from './container-service';

const requestId = '123e4567-e89b-42d3-a456-426614174000';

function createChild() {
  const child = new EventEmitter() as ChildProcess & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  });
  return child;
}

afterEach(() => vi.useRealTimers());

describe('container workbench service', () => {
  it('runs only the bounded read-only Docker listing command and returns approved fields', async () => {
    const child = createChild();
    const spawnCommand = vi.fn(() => child);
    const service = new ContainerWorkbenchService(spawnCommand as unknown as typeof import('node:child_process').spawn);
    const pending = service.list(7, requestId);
    expect(spawnCommand).toHaveBeenCalledWith(
      'docker',
      ['ps', '--all', '--last', '100', '--format', '{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}|{{.Ports}}'],
      { shell: false, windowsHide: true, stdio: 'pipe' },
    );
    child.stdout.write('0123456789ab|api|example/api:1|running|Up 2 minutes|127.0.0.1:8080->80/tcp\n');
    child.emit('close', 0, null);
    expect(await pending).toEqual({
      ok: true,
      value: [
        {
          id: '0123456789ab',
          name: 'api',
          image: 'example/api:1',
          state: 'running',
          status: 'Up 2 minutes',
          ports: '127.0.0.1:8080->80/tcp',
        },
      ],
    });
  });

  it('allows one request per renderer and cancels only the matching request', async () => {
    const child = createChild();
    const service = new ContainerWorkbenchService(vi.fn(() => child) as unknown as typeof import('node:child_process').spawn);
    const pending = service.list(7, requestId);
    expect(await service.list(7, '223e4567-e89b-42d3-a456-426614174000')).toEqual({ ok: false, error: 'busy' });
    expect(service.cancel(8, requestId)).toBe(false);
    expect(service.cancel(7, '223e4567-e89b-42d3-a456-426614174000')).toBe(false);
    expect(service.cancel(7, requestId)).toBe(true);
    expect(await pending).toEqual({ ok: false, error: 'cancelled' });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('times out and terminates the Docker process', async () => {
    vi.useFakeTimers();
    const child = createChild();
    const service = new ContainerWorkbenchService(vi.fn(() => child) as unknown as typeof import('node:child_process').spawn);
    const pending = service.list(7, requestId);
    await vi.advanceTimersByTimeAsync(CONTAINER_LIST_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: 'timeout' });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('kills the child when output exceeds the byte limit', async () => {
    const child = createChild();
    const service = new ContainerWorkbenchService(vi.fn(() => child) as unknown as typeof import('node:child_process').spawn);
    const pending = service.list(7, requestId);
    child.stdout.write(Buffer.alloc(CONTAINER_MAX_OUTPUT_BYTES + 1));
    expect(await pending).toEqual({ ok: false, error: 'response-too-large' });
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('reports a missing Docker executable without exposing process diagnostics', async () => {
    const spawnCommand = vi.fn(() => {
      throw Object.assign(new Error('private executable path'), { code: 'ENOENT' });
    });
    const service = new ContainerWorkbenchService(spawnCommand as unknown as typeof import('node:child_process').spawn);
    expect(await service.list(7, requestId)).toEqual({ ok: false, error: 'docker-unavailable' });
  });
});
