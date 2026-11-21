'use strict';
/* GitHelper · proceso principal de Electron. */
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Store = require('./src/engine/store');
const Git = require('./src/engine/git');
const Remote = require('./src/engine/remote');
const { resolveExe } = require('./src/engine/exe');
const { runCommand } = require('./src/engine/runner');
const { parseRepoUrl } = require('./src/shared/urls');

const E2E = process.argv.includes('--e2e');
if (process.env.GITHELPER_USERDATA) app.setPath('userData', process.env.GITHELPER_USERDATA);
// Solo en las pruebas automáticas: repositorios «remotos» que son carpetas del disco en vez de direcciones de internet.
const URL_OPTS = E2E ? { allowLocal: true } : {};

let win = null;
let data = Store.empty();
let cwd = null; // carpeta local del proyecto activo: donde trabaja la consola
let watcher = null;
let watchTimer = null;
let zoom = 1;
const running = new Map(); // id -> AbortController

// ---------- datos guardados ----------
const dataFile = () => path.join(app.getPath('userData'), 'datos.json');
// OJO: no se puede llamar «cache»: Chromium ya usa userData\Cache (Windows no distingue mayúsculas) y se mezclarían.
const cacheRoot = () => path.join(app.getPath('userData'), 'repos-github');
const zoomFile = () => path.join(app.getPath('userData'), 'zoom.json');

function saveData() {
  try { Store.save(dataFile(), data); } catch { /* no es crítico */ }
}

function loadZoom() {
  try { zoom = Math.max(0.7, Math.min(1.8, Number(JSON.parse(fs.readFileSync(zoomFile(), 'utf8')).zoom) || 1)); } catch { zoom = 1; }
}
function setZoom(z) {
  zoom = Math.max(0.7, Math.min(1.8, Math.round(z * 10) / 10));
  if (win) win.webContents.setZoomFactor(zoom);
  try { fs.mkdirSync(path.dirname(zoomFile()), { recursive: true }); fs.writeFileSync(zoomFile(), JSON.stringify({ zoom })); } catch { /* da igual */ }
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const cleanDir = (s) => path.resolve(String(s || '').trim().replace(/^"|"$/g, ''));

/** La dirección de «origin» de una carpeta (null si no es un repositorio o no tiene origin). */
async function originOf(dir) {
  if (!dir || !fs.existsSync(path.join(dir, '.git'))) return null;
  const r = await Git.git(dir, ['config', '--get', 'remote.origin.url']);
  return r.code === 0 ? r.out.trim() || null : null;
}

// ---------- vigilar la carpeta local ----------
function startWatching() {
  stopWatching();
  if (!cwd) return;
  try {
    watcher = fs.watch(cwd, { recursive: true }, (evt, filename) => {
      const f = String(filename || '').replace(/\\/g, '/');
      if (f.startsWith('.git/') || f === '.git') {
        const rel = f.slice(5);
        const interesting = rel === 'HEAD' || rel === 'index' || rel === 'MERGE_HEAD' || rel.startsWith('refs/') || rel === 'packed-refs';
        if (!interesting) return;
      }
      if (f.startsWith('node_modules/')) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        if (win && !win.isDestroyed()) win.webContents.send('repo:changed');
      }, 400);
    });
    watcher.on('error', () => stopWatching());
  } catch { /* la vigilancia es un extra: sin ella se refresca al ejecutar comandos */ }
}

function stopWatching() {
  if (watcher) { try { watcher.close(); } catch { /* ignorar */ } watcher = null; }
}

/** Cambia la carpeta con la que trabaja la consola (la del proyecto activo). */
function useCwd(dir) {
  cwd = dir || null;
  startWatching();
}

/** Pone en marcha el proyecto: su carpeta local, si existe. */
function applyProject(p) {
  const ok = !!(p && p.local && isDir(p.local));
  useCwd(ok ? p.local : null);
  return { missingLocal: !!(p && p.local && !ok) };
}

function resolveInitial() {
  if (process.env.GITHELPER_LOCAL) { // solo para las pruebas automáticas
    fs.mkdirSync(process.env.GITHELPER_LOCAL, { recursive: true });
    cwd = process.env.GITHELPER_LOCAL;
    return { missingLocal: false };
  }
  const p = Store.byId(data, data.selected.project);
  return applyProject(p);
}

// ---------- ventana ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#0d1117',
    title: 'GitHelper',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: !E2E,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!E2E) win.show(); });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F12' || (ctrl && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools();
    } else if (ctrl && (input.key === '+' || input.key === '=')) {
      setZoom(zoom + 0.1); event.preventDefault();
    } else if (ctrl && input.key === '-') {
      setZoom(zoom - 0.1); event.preventDefault();
    } else if (ctrl && input.key === '0') {
      setZoom(1); event.preventDefault();
    }
  });
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(zoom || 1));
  win.on('closed', () => { win = null; stopWatching(); });
}

// ---------- IPC ----------
function handle(name, fn) {
  ipcMain.handle(name, async (event, arg) => {
    try { return await fn(arg || {}, event); } catch (e) { return { error: String((e && e.message) || e) }; }
  });
}

const NO_FOLDER = 'El proyecto activo no tiene carpeta local. Elige un proyecto que la tenga (arriba, en «Proyectos activos») o añádesela con ✎ Editar.';
const BAD_URL = 'La dirección de GitHub no es válida. Ejemplo: https://github.com/usuario/repositorio';
let initialMissing = false;

handle('app:init', () => ({
  data, cwd, missingLocal: initialMissing, version: app.getVersion(), e2e: E2E,
  gitAvailable: !!resolveExe('git'),
  ghAvailable: !!resolveExe('gh'),
}));

// --- proyectos ---
/** Crea o edita un proyecto (nombre + GitHub + carpeta local) y lo deja como proyecto activo. */
handle('project:save', async ({ id, name, url, local }) => {
  const nm = String(name == null ? '' : name).trim();
  if (!nm) return { error: 'Ponle un nombre al proyecto.' };
  if (nm.length > Store.NAME_MAX) return { error: 'El nombre es demasiado largo (máximo ' + Store.NAME_MAX + ' letras).' };
  if (data.projects.some((p) => p.id !== id && p.name.toLowerCase() === nm.toLowerCase())) return { error: 'Ya hay un proyecto con ese nombre. Elige otro.' };

  let cleanUrl = '';
  if (url && String(url).trim()) {
    const info = parseRepoUrl(url, URL_OPTS);
    if (!info) return { error: BAD_URL };
    cleanUrl = info.url;
  }
  let cleanLocal = '';
  if (local && String(local).trim()) {
    const target = cleanDir(local);
    if (!isDir(target)) return { error: 'Esa carpeta no existe: ' + target };
    cleanLocal = target;
  }
  if (!cleanUrl && !cleanLocal) return { error: 'Pon al menos la dirección de GitHub o la carpeta local (lo ideal: las dos).' };

  let project;
  let oldUrl = '';
  if (id) {
    project = Store.byId(data, id);
    if (!project) return { error: 'Ese proyecto ya no existe.' };
    oldUrl = project.url;
    Object.assign(project, { name: nm, url: cleanUrl, local: cleanLocal });
  } else {
    if (data.projects.length >= Store.MAX_ITEMS) return { error: 'Ya hay demasiados proyectos. Borra alguno.' };
    project = { id: Store.newId(), name: nm, url: cleanUrl, local: cleanLocal, savedAt: new Date().toISOString() };
    data.projects.push(project);
  }
  data.selected.project = project.id;
  saveData();
  // si al editar se cambió la dirección de GitHub, la copia que se había descargado de la anterior ya no hace falta
  if (oldUrl && oldUrl !== cleanUrl && !Store.usesUrl(data, oldUrl, project.id, URL_OPTS)) await Remote.removeCache(cacheRoot(), oldUrl, URL_OPTS);
  const st = applyProject(project);
  return { ok: true, project, data, cwd, missingLocal: st.missingLocal, created: !id };
});

/** Quita un proyecto de la lista. NO borra nada en GitHub ni en el disco (solo la copia de solo lectura que GitHelper descargó para dibujarlo). */
handle('project:remove', async ({ id }) => {
  const i = data.projects.findIndex((p) => p.id === id);
  if (i < 0) return { error: 'Ese proyecto no está en la lista.' };
  const removed = data.projects.splice(i, 1)[0];
  if (data.selected.project === id) { data.selected.project = null; useCwd(null); }
  saveData();
  if (removed.url && !Store.usesUrl(data, removed.url, id, URL_OPTS)) await Remote.removeCache(cacheRoot(), removed.url, URL_OPTS);
  return { ok: true, data, cwd };
});

handle('project:select', ({ id }) => {
  if (id == null || id === '') {
    data.selected.project = null;
    useCwd(null);
    saveData();
    return { ok: true, data, cwd, missingLocal: false };
  }
  const p = Store.byId(data, id);
  if (!p) return { error: 'Ese proyecto ya no existe.' };
  data.selected.project = p.id;
  const st = applyProject(p);
  saveData();
  return { ok: true, data, cwd, missingLocal: st.missingLocal };
});

handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Elige la carpeta local del proyecto',
    defaultPath: cwd || app.getPath('documents'),
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  return { path: r.filePaths[0] };
});

/** El «origin» de una carpeta, para proponer la dirección de GitHub al crear un proyecto. */
handle('local:origin', async ({ dir }) => {
  if (!dir || !String(dir).trim()) return { origin: null };
  const target = cleanDir(dir);
  return { origin: isDir(target) ? await originOf(target) : null };
});

handle('remote:load', async ({ url, fetch }) => {
  const info = parseRepoUrl(url, URL_OPTS);
  if (!info) return { error: BAD_URL };
  const res = await Remote.loadRemote(cacheRoot(), info.url, { fetch: fetch !== false, urlOpts: URL_OPTS });
  return Object.assign({ info: { label: info.label, kind: info.kind, web: info.web, key: info.key } }, res, { dir: undefined });
});

handle('state:get', () => Git.getState(cwd));

// --- consola ---
handle('term:run', async ({ id, argv, redirect }, event) => {
  const send = (channel, payload) => { if (!event.sender.isDestroyed()) event.sender.send(channel, payload); };
  if (!cwd) {
    send('term:data', { id, text: NO_FOLDER + '\n', stream: 'err' });
    send('term:end', { id });
    return { code: 2 };
  }
  const ac = new AbortController();
  running.set(id, ac);
  try {
    return await runCommand({ cwd }, { argv, redirect: redirect || null }, {
      signal: ac.signal,
      emit: (text, stream) => send('term:data', { id, text, stream }),
    });
  } finally {
    running.delete(id);
    // El aviso de «terminado» va por el mismo canal que el texto: así la interfaz sabe que ya llegó todo (la respuesta de invoke
    // viaja por otro camino y a veces se adelantaba, dejando sin mostrar la salida de los comandos muy rápidos).
    send('term:end', { id });
  }
});

handle('term:cancel', ({ id }) => {
  const ac = running.get(id);
  if (ac) ac.abort();
  return true;
});

// --- varios ---
handle('clipboard:write', ({ text }) => { clipboard.writeText(String(text)); return true; });

handle('external:open', ({ url }) => {
  if (!/^https:\/\/[^\s]+$/.test(String(url))) return { error: 'Dirección no válida.' };
  shell.openExternal(url);
  return { ok: true };
});

handle('external:terminal', () => {
  if (!cwd) throw new Error(NO_FOLDER);
  // Abre una ventana normal de PowerShell en la carpeta del repositorio, para cosas interactivas (gh auth login...).
  spawn('cmd.exe', ['/c', 'start', '', 'powershell.exe', '-NoExit'], { cwd, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return { ok: true };
});

handle('external:reveal', () => {
  if (!cwd) throw new Error(NO_FOLDER);
  shell.openPath(cwd);
  return { ok: true };
});

// ---------- arranque ----------
if (!E2E && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(async () => {
    const raw = Store.readRaw(dataFile());
    data = Store.sanitize(raw, URL_OPTS);
    if (Store.needsMigration(raw)) {
      // Versión antigua (listas sueltas de repositorios y carpetas): se convierte a proyectos, enlazando cada carpeta con su GitHub por el «origin».
      // Antes se guarda una copia de los datos antiguos, por si hiciera falta recuperarlos.
      try { fs.copyFileSync(dataFile(), path.join(path.dirname(dataFile()), 'datos-version1-copia.json')); } catch { /* sin copia: se sigue */ }
      await Store.pairByOrigin(data, originOf, URL_OPTS);
      saveData();
    }
    Remote.pruneCache(cacheRoot(), data.projects.map((p) => p.url).filter(Boolean), URL_OPTS);
    loadZoom();
    initialMissing = resolveInitial().missingLocal;
    createWindow();
    if (E2E) require('./scripts/e2e').run({ win, app, getCwd: () => cwd, getData: () => data, dataFile, cacheRoot });
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}
