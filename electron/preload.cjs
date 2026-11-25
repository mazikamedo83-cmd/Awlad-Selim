const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('awladDesktop', {
  isElectron: true,
  platform: process.platform,
  getDesktopInfo: () => ipcRenderer.invoke('awlad:get-desktop-info'),
  openDataFolder: () => ipcRenderer.invoke('awlad:open-data-folder'),
  openBackupsFolder: () => ipcRenderer.invoke('awlad:open-backups-folder'),
  copyText: (text) => ipcRenderer.invoke('awlad:copy-text', text),
  offlineDb: {
    get: (namespace, key) => ipcRenderer.invoke('awlad:offline-kv-get', namespace, key),
    set: (namespace, key, value) => ipcRenderer.invoke('awlad:offline-kv-set', namespace, key, value),
    remove: (namespace, key) => ipcRenderer.invoke('awlad:offline-kv-delete', namespace, key),
    writeMedia: (mediaKey, dataUrl) => ipcRenderer.invoke('awlad:offline-media-write', mediaKey, dataUrl),
    readMedia: (mediaKey) => ipcRenderer.invoke('awlad:offline-media-read', mediaKey),
  },
  secureVault: {
    getItem: (key) => ipcRenderer.invoke('awlad:secure-vault-get', key),
    setItem: (key, value) => ipcRenderer.invoke('awlad:secure-vault-set', key, value),
    removeItem: (key) => ipcRenderer.invoke('awlad:secure-vault-delete', key),
  },
});
