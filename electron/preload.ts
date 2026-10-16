import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('itToolsDesktop', Object.freeze({
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:get-runtime-info'),
}));
