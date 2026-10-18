import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('itToolsDesktop', Object.freeze({
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:get-runtime-info'),
  listPlugins: () => ipcRenderer.invoke('desktop:plugins:list'),
  installPluginPackage: () => ipcRenderer.invoke('desktop:plugins:install'),
  activatePlugin: (pluginId: string, version: string, grantedCapabilities: readonly string[]) =>
    ipcRenderer.invoke('desktop:plugins:activate', { pluginId, version, grantedCapabilities }),
  disablePlugin: (pluginId: string) => ipcRenderer.invoke('desktop:plugins:disable', { pluginId }),
  uninstallPlugin: (pluginId: string, version: string) =>
    ipcRenderer.invoke('desktop:plugins:uninstall', { pluginId, version }),
  listTrustedPluginSigners: () => ipcRenderer.invoke('desktop:plugins:trusted-signers:list'),
  previewPluginSigner: (input: unknown) => ipcRenderer.invoke('desktop:plugins:trusted-signers:preview', input),
  trustPluginSigner: (input: unknown, confirmedFingerprint: string) =>
    ipcRenderer.invoke('desktop:plugins:trusted-signers:add', { input, confirmedFingerprint }),
  revokePluginSigner: (keyId: string) => ipcRenderer.invoke('desktop:plugins:trusted-signers:remove', { keyId }),
}));
