import { resolve } from 'node:path';
import { app, dialog, ipcMain, Notification, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import updaterPackage from 'electron-updater';
import { DesktopUpdateController } from './update-controller';
import { isTrustedDesktopSender } from '../plugin-ipc-security';

/** Exposes fixed update actions only to the application's current main window. */
export async function registerUpdateIpc(options: {
  getMainWindow(): BrowserWindow | null;
  trustedRendererUrl(): string;
}) {
  const { autoUpdater } = updaterPackage;
  autoUpdater.channel = 'latest';
  // GitHub keeps the previous block map under the previous release tag.
  autoUpdater.previousBlockmapBaseUrlOverride = `https://github.com/bruceblink/it-tools-template/releases/download/v${app.getVersion()}/`;
  const controller = new DesktopUpdateController({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    preferencesPath: resolve(app.getPath('userData'), 'app-update-preferences.json'),
    disabledReason: !app.isPackaged ? 'development'
      : !['win32', 'darwin', 'linux'].includes(process.platform) ? 'unsupported' : undefined,
  });
  let confirmingInstall = false;
  let notifiedVersion: string | undefined;
  let notification: Notification | undefined;
  const checkSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== options.getMainWindow()?.webContents
      || !isTrustedDesktopSender(event, options.trustedRendererUrl())) {
      throw new Error('Untrusted application update request.');
    }
  };
  const handlers = {
    'desktop:updates:state': () => controller.getState(),
    'desktop:updates:auto-check': (_event: IpcMainInvokeEvent, enabled: unknown) => {
      if (typeof enabled !== 'boolean') {
        throw new Error('Invalid automatic update setting.');
      }
      return controller.setAutoCheck(enabled);
    },
    'desktop:updates:check': () => controller.check(),
    'desktop:updates:download': () => controller.download(),
    'desktop:updates:cancel': () => controller.cancel(),
    'desktop:updates:install': async () => {
      const state = controller.getState();
      const window = options.getMainWindow();
      if (confirmingInstall || !window || (state.status !== 'downloaded' && state.error !== 'install-failed')) {
        return state;
      }
      confirmingInstall = true;
      try {
        const { response } = await dialog.showMessageBox(window, {
          type: 'question',
          title: '安装更新 / Install update',
          message: '保存当前工作并退出安装更新？ / Save your work and quit to install?',
          detail: '应用将关闭并启动更新。 / The application will close and start the update.',
          buttons: ['取消 / Cancel', '退出并安装 / Quit and install'],
          defaultId: 0,
          cancelId: 0,
        });
        return response === 1 ? controller.install() : controller.getState();
      }
      finally {
        confirmingInstall = false;
      }
    },
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      checkSender(event);
      return (handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)(event, ...args);
    });
  }
  const unsubscribe = controller.subscribe((state) => {
    const window = options.getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:updates:changed', state);
    }
    if (state.status === 'available' && state.availableVersion !== notifiedVersion && Notification.isSupported()) {
      notifiedVersion = state.availableVersion;
      notification?.close();
      notification = new Notification({
        title: 'IT Tools 更新 / Update',
        body: `${state.availableVersion} 已可下载。打开设置查看。 / Open Settings to download.`,
      });
      notification.on('click', () => {
        const current = options.getMainWindow();
        if (current && !current.isDestroyed()) {
          current.show();
          current.focus();
          void current.loadURL(new URL('settings', options.trustedRendererUrl()).href);
        }
      });
      notification.show();
    }
  });
  await controller.initialize();
  return {
    shutdown() {
      unsubscribe();
      notification?.close();
      controller.dispose();
      for (const channel of Object.keys(handlers)) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}
