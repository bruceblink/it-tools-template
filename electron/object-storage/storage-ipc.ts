import { BrowserWindow, dialog, ipcMain, webContents } from 'electron';
import type { StorageResult } from '../../src/shared/desktop-services/object-storage';
import { isTrustedDesktopSender } from '../plugin-ipc-security';
import {
  parseStorageConnect,
  parseStorageList,
  parseStoragePreview,
  parseStorageCancel,
  parseStorageUpload,
} from './storage-protocol';
import { StorageService } from './storage-service';
import { createStorageClient } from './storage-client';

/** Only the trusted main renderer can use its own memory-only S3 session. */
export function registerStorageIpc(dependencies: { trustedRendererUrl: () => string }) {
  const service = new StorageService(createStorageClient, {
    selectUpload: async (renderer) => {
      const parent = getWindow(renderer);
      if (!parent) {
        return null;
      }
      const selected = await dialog.showOpenDialog(parent, { title: 'Upload object', properties: ['openFile'] });
      return selected.canceled ? null : (selected.filePaths[0] ?? null);
    },
    selectDownload: async (renderer, key) => {
      const parent = getWindow(renderer);
      if (!parent) {
        return null;
      }
      const leaf =
        key
          .split(/[\\/]/)
          .pop()
          ?.replace(/[<>:"|?*\x00-\x1f]/g, '_')
          .slice(0, 120) || 'object';
      const selected = await dialog.showSaveDialog(parent, { title: 'Download object', defaultPath: leaf });
      return selected.canceled ? null : (selected.filePath ?? null);
    },
    confirm: async (renderer, operation, bucket, key) => {
      const parent = getWindow(renderer);
      if (!parent) {
        return false;
      }
      const result = await dialog.showMessageBox(parent, {
        type: 'warning',
        title: operation === 'delete' ? 'Delete object' : 'Replace object',
        message: operation === 'delete' ? 'Delete this object?' : 'Replace this object if it exists?',
        detail: `Bucket: ${bucket}\nObject: ${key}`,
        buttons: ['Cancel', operation === 'delete' ? 'Delete' : 'Replace'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    progress: (renderer, progress) => {
      const contents = webContents.fromId(renderer);
      if (contents && !contents.isDestroyed()) {
        try {
          contents.send('desktop:object-storage:progress', progress);
        } catch {
          // Closing a renderer only drops progress notifications; the request signal owns cancellation.
        }
      }
    },
  });
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
  handle('upload', parseStorageUpload, (renderer, input) => service.upload(renderer, input));
  handle('download', parseStoragePreview, (renderer, input) => service.download(renderer, input));
  handle('delete', parseStoragePreview, (renderer, input) => service.delete(renderer, input));
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

function getWindow(renderer: number): BrowserWindow | null {
  const contents = webContents.fromId(renderer);
  return contents && !contents.isDestroyed() ? BrowserWindow.fromWebContents(contents) : null;
}
