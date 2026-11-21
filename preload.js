'use strict';
/* Puente seguro entre la interfaz y el programa: la interfaz solo puede llamar a lo que se expone aquí. */
const { contextBridge, ipcRenderer } = require('electron');

const call = (name, arg) => ipcRenderer.invoke(name, arg);

contextBridge.exposeInMainWorld('api', {
  init: () => call('app:init'),
  // repositorios de GitHub guardados
  saveRepo: (url) => call('repo:save', { url }),
  removeRepo: (url) => call('repo:remove', { url }),
  selectRepo: (url) => call('repo:select', { url }),
  loadRemote: (url, fetch) => call('remote:load', { url, fetch }),
  // carpetas locales guardadas
  saveLocal: (dir) => call('local:save', { dir }),
  removeLocal: (dir) => call('local:remove', { dir }),
  selectLocal: (dir) => call('local:select', { dir }),
  chooseLocal: () => call('local:choose'),
  localOrigins: () => call('local:origins'),
  getState: () => call('state:get'),
  // consola
  run: (id, argv, redirect) => call('term:run', { id, argv, redirect }),
  cancel: (id) => call('term:cancel', { id }),
  // varios
  copy: (text) => call('clipboard:write', { text }),
  openExternal: (url) => call('external:open', { url }),
  openTerminal: () => call('external:terminal'),
  openFolder: () => call('external:reveal'),
  onTermData: (cb) => ipcRenderer.on('term:data', (_e, d) => cb(d)),
  onRepoChanged: (cb) => ipcRenderer.on('repo:changed', () => cb()),
});
