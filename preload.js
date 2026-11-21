'use strict';
/* Puente seguro entre la interfaz y el programa: la interfaz solo puede llamar a lo que se expone aquí. */
const { contextBridge, ipcRenderer } = require('electron');

const call = (name, arg) => ipcRenderer.invoke(name, arg);

contextBridge.exposeInMainWorld('api', {
  init: () => call('app:init'),
  // proyectos (nombre + GitHub + carpeta local)
  saveProject: (project) => call('project:save', project),
  removeProject: (id) => call('project:remove', { id }),
  selectProject: (id) => call('project:select', { id }),
  chooseFolder: () => call('dialog:folder'),
  folderOrigin: (dir) => call('local:origin', { dir }),
  // lectura de GitHub y estado de la carpeta local del proyecto activo
  loadRemote: (url, fetch) => call('remote:load', { url, fetch }),
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
  onTermEnd: (cb) => ipcRenderer.on('term:end', (_e, d) => cb(d)),
  onRepoChanged: (cb) => ipcRenderer.on('repo:changed', () => cb()),
});
