const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('awladDesktop', {
  isElectron: true,
  getDesktopInfo: () => ipcRenderer.invoke('awlad:get-desktop-info'),
  openDataFolder: () => ipcRenderer.invoke('awlad:open-data-folder'),
  openBackupsFolder: () => ipcRenderer.invoke('awlad:open-backups-folder'),
  copyText: (text) => ipcRenderer.invoke('awlad:copy-text', text),
});
