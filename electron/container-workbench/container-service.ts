import { spawn, type ChildProcess } from 'node:child_process';
import type {
  ContainerWorkbenchError,
  ContainerWorkbenchResult,
  DockerContainer,
} from '../../src/shared/desktop-services/container-workbench';
import {
  CONTAINER_LIST_TIMEOUT_MS,
  CONTAINER_MAX_OUTPUT_BYTES,
} from '../../src/shared/desktop-services/container-workbench';
import { parseDockerContainerList } from './container-protocol';

interface ActiveRequest {
  requestId: string;
  child: ChildProcess;
  timer: NodeJS.Timeout;
  reason: ContainerWorkbenchError | null;
  spawnError: ContainerWorkbenchError | null;
  stdout: Buffer[];
  stdoutBytes: number;
}

/** Run one fixed, read-only Docker command per renderer with bounded time and output. */
export class ContainerWorkbenchService {
  private readonly active = new Map<number, ActiveRequest>();

  constructor(private readonly spawnCommand: typeof spawn = spawn) {}

  async list(rendererId: number, requestId: string): Promise<ContainerWorkbenchResult<DockerContainer[]>> {
    if (!isRequestId(requestId)) {
      return { ok: false, error: 'invalid-request' };
    }
    if (this.active.has(rendererId)) {
      return { ok: false, error: 'busy' };
    }

    let child: ChildProcess;
    try {
      child = this.spawnCommand(
        'docker',
        [
          'ps',
          '--all',
          '--last',
          '100',
          '--format',
          '{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}|{{.Ports}}',
        ],
        { shell: false, windowsHide: true, stdio: 'pipe' },
      );
    } catch {
      return { ok: false, error: 'docker-unavailable' };
    }

    return new Promise((resolve) => {
      const active: ActiveRequest = {
        requestId,
        child,
        timer: setTimeout(() => {
          if (!active.reason) {
            active.reason = 'timeout';
            child.kill();
          }
        }, CONTAINER_LIST_TIMEOUT_MS),
        reason: null,
        spawnError: null,
        stdout: [],
        stdoutBytes: 0,
      };
      this.active.set(rendererId, active);

      const finish = (result: ContainerWorkbenchResult<DockerContainer[]>) => {
        clearTimeout(active.timer);
        if (this.active.get(rendererId) === active) {
          this.active.delete(rendererId);
        }
        resolve(result);
      };

      if (!child.stdout || !child.stderr) {
        active.reason = 'service-unavailable';
        child.kill();
      } else {
        child.stdout.on('data', (chunk: Buffer | string) => {
          if (active.reason) {
            return;
          }
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          active.stdoutBytes += buffer.byteLength;
          if (active.stdoutBytes > CONTAINER_MAX_OUTPUT_BYTES) {
            active.reason = 'response-too-large';
            child.kill();
            return;
          }
          active.stdout.push(buffer);
        });
        child.stderr.resume();
      }

      child.once('error', (error: NodeJS.ErrnoException) => {
        active.spawnError = error.code === 'ENOENT' ? 'docker-unavailable' : 'docker-error';
      });
      child.once('close', (code) => {
        if (active.reason) {
          finish({ ok: false, error: active.reason });
        } else if (active.spawnError) {
          finish({ ok: false, error: active.spawnError });
        } else if (code !== 0) {
          finish({ ok: false, error: 'docker-error' });
        } else {
          const containers = parseDockerContainerList(Buffer.concat(active.stdout).toString('utf8'));
          finish(containers ? { ok: true, value: containers } : { ok: false, error: 'invalid-response' });
        }
      });
    });
  }

  cancel(rendererId: number, requestId: string): boolean {
    const active = this.active.get(rendererId);
    if (!active || active.requestId !== requestId || active.reason) {
      return false;
    }
    active.reason = 'cancelled';
    active.child.kill();
    return true;
  }

  closeRenderer(rendererId: number): void {
    const active = this.active.get(rendererId);
    if (!active || active.reason) {
      return;
    }
    active.reason = 'cancelled';
    active.child.kill();
  }

  shutdown(): void {
    for (const active of this.active.values()) {
      active.reason = 'cancelled';
      clearTimeout(active.timer);
      active.child.kill();
    }
    this.active.clear();
  }
}

function isRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
