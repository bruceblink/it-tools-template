import { ipcMain } from 'electron';
import type {
  ContainerWorkbenchResult,
} from '../../src/shared/desktop-services/container-workbench';
import { isTrustedDesktopSender } from '../plugin-ipc-security';
import { parseContainerListRequest } from './container-protocol';
import { ContainerWorkbenchService } from './container-service';

const LIST_CHANNEL = 'desktop:container-workbench:list';
const CANCEL_CHANNEL = 'desktop:container-workbench:cancel';

/** Expose only bounded read-only container metadata to the trusted application renderer. */
export function registerContainerWorkbenchIpc(dependencies: { trustedRendererUrl: () => string }) {
  const service = new ContainerWorkbenchService();

  ipcMain.handle(LIST_CHANNEL, (event, value: unknown) => {
    if (!isTrustedDesktopSender(event, dependencies.trustedRendererUrl())) {
      return Promise.resolve({ ok: false, error: 'untrusted-renderer' } satisfies ContainerWorkbenchResult<never>);
    }
    const input = parseContainerListRequest(value);
    return input
      ? service.list(event.sender.id, input.requestId)
      : Promise.resolve({ ok: false, error: 'invalid-request' } satisfies ContainerWorkbenchResult<never>);
  });

  ipcMain.handle(CANCEL_CHANNEL, (event, value: unknown): ContainerWorkbenchResult<boolean> => {
    if (!isTrustedDesktopSender(event, dependencies.trustedRendererUrl())) {
      return { ok: false, error: 'untrusted-renderer' };
    }
    const input = parseContainerListRequest(value);
    return input
      ? { ok: true, value: service.cancel(event.sender.id, input.requestId) }
      : { ok: false, error: 'invalid-request' };
  });

  return {
    closeRenderer: (rendererId: number) => service.closeRenderer(rendererId),
    shutdown: () => {
      service.shutdown();
      ipcMain.removeHandler(LIST_CHANNEL);
      ipcMain.removeHandler(CANCEL_CHANNEL);
    },
  };
}
