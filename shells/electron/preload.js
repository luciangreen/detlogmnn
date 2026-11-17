// Gives the site its file bridge (window.lucianNative.fs) and commands on the computer
// (window.lucianNative.jobs), and nothing else of Node or Electron.
const { contextBridge, ipcRenderer } = require('electron');
const jobListeners = new Map();
ipcRenderer.on('lucian-job-event', (_e, { id, event, data }) => { jobListeners.get(id)?.(event, data); if (event === 'end') jobListeners.delete(id); });
let seq = 0;
contextBridge.exposeInMainWorld('lucianNative', {
  platform: process.platform,
  fs: (req) => ipcRenderer.invoke('lucian-fs', req),
  // commands on the computer: start(spec, onEvent(event, data)) -> id; input(id, text); cancel(id)
  jobs: {
    start: async (spec, onEvent) => { const id = `n${++seq}`; jobListeners.set(id, onEvent); await ipcRenderer.invoke('lucian-job-start', id, spec); return id; },
    input: (id, text) => ipcRenderer.invoke('lucian-job-input', id, text),
    cancel: (id) => ipcRenderer.invoke('lucian-job-cancel', id)
  }
});
