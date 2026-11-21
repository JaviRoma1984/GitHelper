'use strict';
/* Localiza git.exe y gh.exe aunque la app se haya abierto desde el menú Inicio con un PATH reducido. */
const fs = require('fs');
const path = require('path');

const cache = new Map();

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function extraDirs(name) {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  if (name === 'git') return [path.join(pf, 'Git', 'cmd'), path.join(pf86, 'Git', 'cmd'), path.join(local, 'Programs', 'Git', 'cmd')];
  if (name === 'gh') return [path.join(pf, 'GitHub CLI'), path.join(pf86, 'GitHub CLI'), path.join(local, 'Programs', 'GitHub CLI')];
  return [];
}

/** Devuelve la ruta completa del .exe o null si no está instalado. */
function resolveExe(name, fresh) {
  if (!fresh && cache.has(name)) return cache.get(name);
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean).concat(extraDirs(name));
  const ext = process.platform === 'win32' ? '.exe' : '';
  let found = null;
  for (const d of dirs) {
    const p = path.join(d, name + ext);
    if (isFile(p)) { found = p; break; }
  }
  cache.set(name, found);
  return found;
}

module.exports = { resolveExe };
