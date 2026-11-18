const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('awladDesktop', {
  isElectron: true,
  getDesktopInfo: () => ipcRenderer.invoke('awlad:get-desktop-info'),
  openDataFolder: () => ipcRenderer.invoke('awlad:open-data-folder'),
  openBackupsFolder: () => ipcRenderer.invoke('awlad:open-backups-folder'),
  copyText: (text) => ipcRenderer.invoke('awlad:copy-text', text),
  getAutoStart: () => ipcRenderer.invoke('awlad:get-auto-start'),
  setAutoStart: (enabled) => ipcRenderer.invoke('awlad:set-auto-start', enabled),
  getTunnelStatus: () => ipcRenderer.invoke('awlad:get-tunnel-status'),
  startTunnel: (opts) => ipcRenderer.invoke('awlad:start-tunnel', opts),
  stopTunnel: () => ipcRenderer.invoke('awlad:stop-tunnel'),
  getTunnelAutoStart: () => ipcRenderer.invoke('awlad:get-tunnel-auto-start'),
  setTunnelAutoStart: (opts) => ipcRenderer.invoke('awlad:set-tunnel-auto-start', opts),
  offlineDb: {
    get: (store, key) => ipcRenderer.invoke('awlad:offline-get', store, key),
    set: (store, key, value) => ipcRenderer.invoke('awlad:offline-set', store, key, value),
    remove: (store, key) => ipcRenderer.invoke('awlad:offline-remove', store, key),
    readMedia: (mediaKey) => ipcRenderer.invoke('awlad:offline-read-media', mediaKey),
    writeMedia: (mediaKey, dataUrl) => ipcRenderer.invoke('awlad:offline-write-media', mediaKey, dataUrl),
  },
});
