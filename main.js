'use strict';
/* GitHelper · proceso principal de Electron. */
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Store = require('./src/engine/store');
const Git = require('./src/engine/git');
const Remote = require('./src/engine/remote');
const { runCommand } = require('./src/engine/runner');
const { parseRepoUrl } = require('./src/shared/urls');

const E2E = process.argv.includes('--e2e');
if (process.env.GITHELPER_USERDATA) app.setPath('userData', process.env.GITHELPER_USERDATA);
// Solo en las pruebas automáticas: repositorios «remotos» que son carpetas del disco en vez de direcciones de internet.
const URL_OPTS = E2E ? { allowLocal: true } : {};

let win = null;
let data = Store.empty();
let cwd = null; // carpeta del repositorio local con el que trabaja la consola
let watcher = null;
let watchTimer = null;
let zoom = 1;
const running = new Map(); // id -> AbortController

// ---------- datos guardados ----------
const dataFile = () => path.join(app.getPath('userData'), 'datos.json');
// OJO: no se puede llamar «cache»: Chromium ya usa userData\Cache (Windows no distingue mayúsculas) y se mezclarían.
const cacheRoot = () => path.join(app.getPath('userData'), 'repos-github');
const zoomFile = () => path.join(app.getPath('userData'), 'zoom.json');

function loadData() { data = Store.load(dataFile(), URL_OPTS); }
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

/** Cambia la carpeta de trabajo. Solo se recuerda como «seleccionada» si está en la lista guardada. */
function useLocal(dir) {
  cwd = dir || null;
  data.selected.local = cwd && Store.indexOfLocal(data, cwd) >= 0 ? data.locals[Store.indexOfLocal(data, cwd)].path : null;
  saveData();
  startWatching();
}

function resolveInitialLocal() {
  if (process.env.GITHELPER_LOCAL) { // solo para las pruebas automáticas
    fs.mkdirSync(process.env.GITHELPER_LOCAL, { recursive: true });
    cwd = process.env.GITHELPER_LOCAL;
    return;
  }
  const sel = data.selected.local;
  cwd = sel && isDir(sel) ? sel : null;
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

const NO_FOLDER = 'Primero elige la carpeta de tu repositorio local (arriba a la derecha, en «Repositorio local»).';

handle('app:init', () => ({
  data, cwd, version: app.getVersion(), e2e: E2E,
  gitAvailable: !!require('./src/engine/exe').resolveExe('git'),
  ghAvailable: !!require('./src/engine/exe').resolveExe('gh'),
}));

// --- repositorios de GitHub ---
handle('repo:save', ({ url }) => {
  const info = parseRepoUrl(url, URL_OPTS);
  if (!info) return { error: 'Esa dirección no es válida. Ejemplo: https://github.com/usuario/repositorio' };
  const i = Store.indexOfRepo(data, url, URL_OPTS);
  let already = false;
  if (i >= 0) { already = true; data.repos[i].url = info.url; } else {
    if (data.repos.length >= Store.MAX_ITEMS) return { error: 'Ya hay demasiados repositorios guardados. Borra alguno.' };
    data.repos.push({ url: info.url, savedAt: new Date().toISOString() });
  }
  data.selected.repo = info.url;
  saveData();
  return { ok: true, already, url: info.url, data };
});

handle('repo:remove', async ({ url }) => {
  const i = Store.indexOfRepo(data, url, URL_OPTS);
  if (i < 0) return { error: 'Ese repositorio no está en la lista guardada.' };
  const removed = data.repos.splice(i, 1)[0];
  if (data.selected.repo === removed.url) data.selected.repo = null;
  saveData();
  await Remote.removeCache(cacheRoot(), removed.url, URL_OPTS);
  return { ok: true, data };
});

handle('repo:select', ({ url }) => {
  if (url == null || url === '') { data.selected.repo = null; saveData(); return { ok: true, data }; }
  const i = Store.indexOfRepo(data, url, URL_OPTS);
  data.selected.repo = i >= 0 ? data.repos[i].url : null; // lo no guardado se puede ver, pero no se recuerda
  saveData();
  return { ok: true, data };
});

handle('remote:load', async ({ url, fetch }) => {
  const info = parseRepoUrl(url, URL_OPTS);
  if (!info) return { error: 'Esa dirección no es válida. Ejemplo: https://github.com/usuario/repositorio' };
  const res = await Remote.loadRemote(cacheRoot(), info.url, { fetch: fetch !== false, urlOpts: URL_OPTS });
  return Object.assign({ info: { label: info.label, kind: info.kind, web: info.web, key: info.key } }, res, { dir: undefined });
});

// --- carpetas locales ---
handle('local:save', ({ dir }) => {
  if (!dir || !String(dir).trim()) return { error: 'Escribe la ruta de una carpeta.' };
  const target = cleanDir(dir);
  if (!isDir(target)) return { error: 'Esa carpeta no existe.' };
  const i = Store.indexOfLocal(data, target);
  const already = i >= 0;
  if (!already) {
    if (data.locals.length >= Store.MAX_ITEMS) return { error: 'Ya hay demasiadas carpetas guardadas. Borra alguna.' };
    data.locals.push({ path: target, savedAt: new Date().toISOString() });
  }
  useLocal(target);
  return { ok: true, already, dir: target, cwd, data };
});

handle('local:remove', ({ dir }) => {
  const i = Store.indexOfLocal(data, cleanDir(dir));
  if (i < 0) return { error: 'Esa carpeta no está en la lista guardada.' };
  data.locals.splice(i, 1); // solo se quita de la lista: la carpeta del disco NO se toca (y sigue abierta hasta que se elija otra)
  if (data.selected.local && Store.indexOfLocal(data, data.selected.local) < 0) data.selected.local = null;
  saveData();
  return { ok: true, data, cwd };
});

handle('local:select', ({ dir }) => {
  if (dir == null || dir === '') { useLocal(null); return { ok: true, cwd, data }; }
  const target = cleanDir(dir);
  if (!isDir(target)) return { error: 'Esa carpeta no existe.', missing: true, dir: target };
  useLocal(target);
  return { ok: true, cwd, data };
});

handle('local:choose', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Elige la carpeta de tu repositorio local',
    defaultPath: cwd || app.getPath('documents'),
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  useLocal(r.filePaths[0]);
  return { ok: true, cwd, data };
});

/** Para cada carpeta guardada, la dirección de su «origin» (así se enlaza una carpeta con su repositorio de GitHub). */
handle('local:origins', async () => {
  const list = await Promise.all(data.locals.slice(0, 60).map(async (l) => {
    if (!fs.existsSync(path.join(l.path, '.git'))) return { path: l.path, origin: null };
    const r = await Git.git(l.path, ['config', '--get', 'remote.origin.url']);
    return { path: l.path, origin: r.code === 0 ? r.out.trim() || null : null };
  }));
  return { list };
});

handle('state:get', () => Git.getState(cwd));

// --- consola ---
handle('term:run', async ({ id, argv, redirect }, event) => {
  if (!cwd) {
    event.sender.send('term:data', { id, text: NO_FOLDER + '\n', stream: 'err' });
    return { code: 2 };
  }
  const ac = new AbortController();
  running.set(id, ac);
  try {
    return await runCommand({ cwd }, { argv, redirect: redirect || null }, {
      signal: ac.signal,
      emit: (text, stream) => { if (!event.sender.isDestroyed()) event.sender.send('term:data', { id, text, stream }); },
    });
  } finally {
    running.delete(id);
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
  app.whenReady().then(() => {
    loadData();
    Remote.pruneCache(cacheRoot(), data.repos.map((r) => r.url), URL_OPTS);
    loadZoom();
    resolveInitialLocal();
    startWatching();
    createWindow();
    if (E2E) require('./scripts/e2e').run({ win, app, getCwd: () => cwd, getData: () => data, dataFile, cacheRoot });
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}
