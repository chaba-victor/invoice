// Exposes the few desktop actions the app's pages can ask for (window.invoiceDesktop).
// Loaded only into the main window; main.js also checks that each call comes from it.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('invoiceDesktop', {
  getBackupInfo: () => ipcRenderer.invoke('backup:info'),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  openBackupsFolder: () => ipcRenderer.invoke('backup:open-folder'),
})
