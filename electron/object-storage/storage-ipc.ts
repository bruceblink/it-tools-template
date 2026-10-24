import { ipcMain } from 'electron';
import type { StorageResult } from '../../src/shared/desktop-services/object-storage';
import { isTrustedDesktopSender } from '../plugin-ipc-security';
import { parseStorageConnect, parseStorageList, parseStoragePreview, parseStorageCancel } from './storage-protocol';
import { StorageService } from './storage-service';

/** Only the trusted main renderer can use its own memory-only S3 session. */
export function registerStorageIpc(dependencies: { trustedRendererUrl: () => string }) {
  const service = new StorageService();
  const channels: string[] = [];
  function handle<I, O>(name: string, parse: (value: unknown) => I | null, action: (renderer: number, input: I) => O) {
    const channel = `desktop:object-storage:${name}`;
    channels.push(channel);
    ipcMain.handle(channel, (event, value: unknown): O | StorageResult<never> => {
      if (!isTrustedDesktopSender(event, dependencies.trustedRendererUrl())) {
        return { ok: false, error: 'untrusted-renderer' };
      }
      const input = parse(value);
      return input === null ? { ok: false, error: 'invalid-request' } : action(event.sender.id, input);
    });
  }
  handle('connect', parseStorageConnect, (renderer, input) => service.connect(renderer, input));
  handle('list', parseStorageList, (renderer, input) => service.list(renderer, input));
  handle('preview', parseStoragePreview, (renderer, input) => service.preview(renderer, input));
  handle('cancel', parseStorageCancel, (renderer, input) => ({ ok: true, value: service.cancel(renderer, input) }));
  handle(
    'disconnect',
    (value) => (value === undefined ? true : null),
    (renderer) => {
      service.closeRenderer(renderer);
      return { ok: true, value: true };
    },
  );
  return {
    closeRenderer: (renderer: number) => service.closeRenderer(renderer),
    shutdown: () => {
      service.shutdown();
      for (const channel of channels) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}
