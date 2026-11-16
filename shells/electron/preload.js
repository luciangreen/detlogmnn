// Gives the site its file bridge (window.lucianNative.fs) and nothing else of Node or Electron.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lucianNative', {
  platform: process.platform,
  fs: (req) => ipcRenderer.invoke('lucian-fs', req)
});
