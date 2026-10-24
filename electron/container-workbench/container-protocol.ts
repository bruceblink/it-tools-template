import type {
  DockerContainer,
  DockerContainerState,
} from '../../src/shared/desktop-services/container-workbench';
import {
  CONTAINER_MAX_ITEMS,
  CONTAINER_MAX_OUTPUT_BYTES,
} from '../../src/shared/desktop-services/container-workbench';

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const containerIdPattern = /^[0-9a-f]{12,64}$/i;
const containerStates = new Set<DockerContainerState>([
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead',
]);

/** Accept only a request identifier; container data is always read from the Docker CLI. */
export function parseContainerListRequest(value: unknown): { requestId: string } | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.requestId !== 'string') {
    return null;
  }
  return requestIdPattern.test(value.requestId) ? { requestId: value.requestId } : null;
}

/** Parse the fixed six-field Docker format and reject the complete result on invalid or excessive data. */
export function parseDockerContainerList(output: string): DockerContainer[] | null {
  if (Buffer.byteLength(output, 'utf8') > CONTAINER_MAX_OUTPUT_BYTES) {
    return null;
  }
  const rows = output.split(/\r?\n/).filter(Boolean);
  if (rows.length > CONTAINER_MAX_ITEMS) {
    return null;
  }
  const containers: DockerContainer[] = [];
  for (const row of rows) {
    const fields = row.split('|');
    if (fields.length !== 6) {
      return null;
    }
    const [id, name, image, state, status, ports] = fields;
    if (
      !containerIdPattern.test(id ?? '') ||
      !bounded(name, 255) ||
      !bounded(image, 512) ||
      !bounded(state, 32) ||
      !bounded(status, 256, true) ||
      !bounded(ports, 2048, true)
    ) {
      return null;
    }
    containers.push({
      id,
      name,
      image,
      state: containerStates.has(state as DockerContainerState) ? (state as DockerContainerState) : 'unknown',
      status,
      ports,
    });
  }
  return containers;
}

function bounded(value: string | undefined, maxBytes: number, empty = false): value is string {
  return (
    typeof value === 'string' &&
    (empty || value.length > 0) &&
    Buffer.byteLength(value, 'utf8') <= maxBytes &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
