import type {
  ContainerListRequest,
  ContainerWorkbenchResult,
  DockerContainer,
} from '@/shared/desktop-services/container-workbench';

/** Return a fixed error when the Electron bridge is absent or rejects its request. */
async function callContainerWorkbench<T>(
  operation: (bridge: NonNullable<Window['itToolsDesktop']>) => Promise<ContainerWorkbenchResult<T>> | undefined,
): Promise<ContainerWorkbenchResult<T>> {
  const bridge = typeof window === 'undefined' ? undefined : window.itToolsDesktop;
  if (!bridge) {
    return { ok: false, error: 'service-unavailable' };
  }
  try {
    return (await operation(bridge)) ?? { ok: false, error: 'service-unavailable' };
  } catch {
    return { ok: false, error: 'service-unavailable' };
  }
}

export const listDockerContainers = (
  input: ContainerListRequest,
): Promise<ContainerWorkbenchResult<DockerContainer[]>> =>
  callContainerWorkbench((bridge) => bridge.listDockerContainers?.(input));

export const cancelDockerContainerRequest = (
  input: ContainerListRequest,
): Promise<ContainerWorkbenchResult<boolean>> =>
  callContainerWorkbench((bridge) => bridge.cancelDockerContainerRequest?.(input));
