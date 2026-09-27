// Bridge for the "Reset Invoice password" window (reset-password.html) only.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('passwordReset', {
  getAccount: () => ipcRenderer.invoke('reset:account'),
  submit: (password) => ipcRenderer.invoke('reset:submit', password),
  close: () => ipcRenderer.invoke('reset:close'),
})
