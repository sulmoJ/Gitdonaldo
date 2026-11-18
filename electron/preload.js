'use strict';

// Runs in the sandboxed renderer before the page. Exposes only the calls the UI needs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitdonaldo', {
  isDesktop: true,
  selectRepo: () => ipcRenderer.invoke('gitdonaldo:select-repo'),
  rememberRepo: (repoPath) => ipcRenderer.send('gitdonaldo:remember-repo', String(repoPath)),
  onOpenRepoRequest: (cb) => {
    ipcRenderer.on('gitdonaldo:open-repo-request', () => cb());
  },
});
