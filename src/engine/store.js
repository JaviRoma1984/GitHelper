'use strict';
/* Listas guardadas (repositorios de GitHub y carpetas locales). Un único archivo JSON en los datos de la aplicación.
 * El programa arranca VACÍO: solo se guarda lo que la persona pulsa «Guardar». */
const fs = require('fs');
const path = require('path');
const { parseRepoUrl } = require('../shared/urls');
const { normPath } = require('./files');

const VERSION = 1;
const MAX_ITEMS = 200;

function empty() {
  return { version: VERSION, repos: [], locals: [], selected: { repo: null, local: null } };
}

/** Deja el objeto en forma válida (por si el archivo está a medias o lo ha tocado alguien). */
function sanitize(raw, urlOpts) {
  const d = empty();
  if (!raw || typeof raw !== 'object') return d;
  const seenR = new Set();
  (Array.isArray(raw.repos) ? raw.repos : []).forEach((r) => {
    const info = r && typeof r.url === 'string' ? parseRepoUrl(r.url, urlOpts) : null;
    if (!info || seenR.has(info.key)) return;
    seenR.add(info.key);
    d.repos.push({ url: info.url, savedAt: typeof r.savedAt === 'string' ? r.savedAt : null });
  });
  const seenL = new Set();
  (Array.isArray(raw.locals) ? raw.locals : []).forEach((l) => {
    if (!l || typeof l.path !== 'string' || !l.path.trim()) return;
    const k = normPath(l.path);
    if (seenL.has(k)) return;
    seenL.add(k);
    d.locals.push({ path: l.path, savedAt: typeof l.savedAt === 'string' ? l.savedAt : null });
  });
  d.repos = d.repos.slice(0, MAX_ITEMS);
  d.locals = d.locals.slice(0, MAX_ITEMS);
  const sel = raw.selected || {};
  if (typeof sel.repo === 'string' && d.repos.some((r) => r.url === sel.repo)) d.selected.repo = sel.repo;
  if (typeof sel.local === 'string' && d.locals.some((l) => normPath(l.path) === normPath(sel.local))) d.selected.local = sel.local;
  return d;
}

function load(file, urlOpts) {
  try { return sanitize(JSON.parse(fs.readFileSync(file, 'utf8')), urlOpts); } catch { return empty(); }
}

function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function indexOfRepo(data, url, urlOpts) {
  const info = parseRepoUrl(url, urlOpts);
  if (!info) return -1;
  return data.repos.findIndex((r) => {
    const x = parseRepoUrl(r.url, urlOpts);
    return x && x.key === info.key;
  });
}

function indexOfLocal(data, dir) {
  const k = normPath(dir);
  return data.locals.findIndex((l) => normPath(l.path) === k);
}

module.exports = { empty, sanitize, load, save, indexOfRepo, indexOfLocal, MAX_ITEMS };
