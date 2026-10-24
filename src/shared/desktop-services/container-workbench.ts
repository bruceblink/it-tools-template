export type ContainerWorkbenchError =
  | 'invalid-request'
  | 'untrusted-renderer'
  | 'busy'
  | 'cancelled'
  | 'timeout'
  | 'response-too-large'
  | 'docker-unavailable'
  | 'docker-error'
  | 'invalid-response'
  | 'service-unavailable';

export type ContainerWorkbenchResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ContainerWorkbenchError };

export interface ContainerListRequest {
  requestId: string;
}

export type DockerContainerState =
  | 'created'
  | 'running'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'exited'
  | 'dead'
  | 'unknown';

/** Deliberately excludes labels, environment variables, mounts, and logs. */
export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: DockerContainerState;
  status: string;
  ports: string;
}

export const CONTAINER_LIST_TIMEOUT_MS = 10_000;
export const CONTAINER_MAX_OUTPUT_BYTES = 512 * 1024;
export const CONTAINER_MAX_ITEMS = 100;
