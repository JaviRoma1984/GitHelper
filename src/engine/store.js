'use strict';
/* Proyectos guardados. Un proyecto = un nombre + la dirección de GitHub donde vive + la carpeta local donde vive.
 * Un único archivo JSON en los datos de la aplicación. El programa arranca VACÍO: solo se guarda lo que la persona agrega.
 *
 * Versión 1 (antigua): listas sueltas de repositorios y de carpetas. Se migra a proyectos (ver migrateV1 y pairByOrigin). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseRepoUrl, sameRepo } = require('../shared/urls');

const VERSION = 2;
const MAX_ITEMS = 200;
const NAME_MAX = 60;

const newId = () => crypto.randomBytes(6).toString('hex');
const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '');

function empty() {
  return { version: VERSION, projects: [], selected: { project: null } };
}

/** Un nombre que no se repita (sin distinguir mayúsculas): «Hola», «Hola (2)», «Hola (3)»… */
function uniqueName(base, taken) {
  const root = String(base || 'Proyecto').trim().slice(0, NAME_MAX) || 'Proyecto';
  let name = root;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = root.slice(0, NAME_MAX - 5) + ' (' + i + ')';
  return name;
}

function readRaw(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** ¿Es un archivo de la versión 1 (listas sueltas) que hay que convertir a proyectos? */
function needsMigration(raw) {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw.projects) && (Array.isArray(raw.repos) || Array.isArray(raw.locals));
}

/**
 * Versión 1 → proyectos: cada repositorio guardado pasa a ser un proyecto con solo su dirección y cada carpeta guardada, otro con solo su carpeta.
 * Enlazar cada carpeta con su repositorio (por el «origin» de git) necesita ejecutar git: lo hace pairByOrigin.
 */
function migrateV1(raw, urlOpts) {
  const projects = [];
  const taken = new Set();
  const byUrlKey = new Map();
  const byLocal = new Map();
  const add = (p) => { taken.add(p.name.toLowerCase()); projects.push(p); };
  (Array.isArray(raw.repos) ? raw.repos : []).forEach((r) => {
    const info = r && typeof r.url === 'string' ? parseRepoUrl(r.url, urlOpts) : null;
    if (!info || byUrlKey.has(info.key)) return;
    const p = { id: newId(), name: uniqueName(info.repo, taken), url: info.url, local: '', savedAt: typeof r.savedAt === 'string' ? r.savedAt : null };
    add(p);
    byUrlKey.set(info.key, p);
  });
  (Array.isArray(raw.locals) ? raw.locals : []).forEach((l) => {
    if (!l || typeof l.path !== 'string' || !l.path.trim()) return;
    const k = l.path.replace(/[\\/]+$/, '').toLowerCase();
    if (byLocal.has(k)) return;
    const p = { id: newId(), name: uniqueName(baseName(l.path), taken), url: '', local: l.path.trim(), savedAt: typeof l.savedAt === 'string' ? l.savedAt : null };
    add(p);
    byLocal.set(k, p);
  });
  const sel = raw.selected || {};
  let selectedId = null;
  if (typeof sel.repo === 'string') {
    const info = parseRepoUrl(sel.repo, urlOpts);
    if (info && byUrlKey.has(info.key)) selectedId = byUrlKey.get(info.key).id;
  }
  if (!selectedId && typeof sel.local === 'string') {
    const p = byLocal.get(sel.local.replace(/[\\/]+$/, '').toLowerCase());
    if (p) selectedId = p.id;
  }
  return { projects, selectedId };
}

/** Deja el objeto en forma válida (por si el archivo está a medias o lo ha tocado alguien) y convierte la versión 1. */
function sanitize(raw, urlOpts) {
  const d = empty();
  if (!raw || typeof raw !== 'object') return d;
  let src = raw;
  if (needsMigration(raw)) {
    const m = migrateV1(raw, urlOpts);
    src = { projects: m.projects, selected: { project: m.selectedId } };
  }
  const ids = new Set();
  const names = new Set();
  (Array.isArray(src.projects) ? src.projects : []).forEach((p) => {
    if (!p || typeof p !== 'object') return;
    const rawName = typeof p.name === 'string' ? p.name.trim() : '';
    let url = '';
    if (typeof p.url === 'string' && p.url.trim()) {
      const info = parseRepoUrl(p.url, urlOpts);
      if (info) url = info.url;
    }
    const local = typeof p.local === 'string' ? p.local.trim() : '';
    if (!rawName || (!url && !local)) return;
    let id = typeof p.id === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(p.id) && !ids.has(p.id) ? p.id : newId();
    while (ids.has(id)) id = newId();
    ids.add(id);
    const name = uniqueName(rawName, names);
    names.add(name.toLowerCase());
    d.projects.push({ id, name, url, local, savedAt: typeof p.savedAt === 'string' ? p.savedAt : null });
  });
  d.projects = d.projects.slice(0, MAX_ITEMS);
  const sel = src.selected && src.selected.project;
  if (typeof sel === 'string' && d.projects.some((p) => p.id === sel)) d.selected.project = sel;
  return d;
}

function load(file, urlOpts) {
  return sanitize(readRaw(file), urlOpts);
}

function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function byId(data, id) {
  return data.projects.find((p) => p.id === id) || null;
}

/** ¿Hay otro proyecto (distinto de exceptId) que use esa dirección de GitHub? (para no borrar la copia que comparte) */
function usesUrl(data, url, exceptId, urlOpts) {
  return !!url && data.projects.some((p) => p.id !== exceptId && p.url && sameRepo(p.url, url, urlOpts));
}

/**
 * Tras migrar de la versión 1: une cada proyecto «solo carpeta» con el proyecto «solo dirección» al que apunta su origin de git;
 * a las carpetas que apuntan a un GitHub que no estaba guardado se les pone esa dirección. originOf(dir) → Promise<string|null>.
 * @returns {Promise<number>} cuántos proyectos se han unido o completado
 */
async function pairByOrigin(data, originOf, urlOpts) {
  let changed = 0;
  for (const p of data.projects.slice()) {
    if (p.url || !p.local) continue;
    const origin = await originOf(p.local);
    const info = origin ? parseRepoUrl(origin, urlOpts) : null;
    if (!info) continue;
    const target = data.projects.find((q) => q !== p && q.url && !q.local && sameRepo(q.url, info.url, urlOpts));
    if (target) {
      target.local = p.local;
      if (data.selected.project === p.id) data.selected.project = target.id;
      data.projects.splice(data.projects.indexOf(p), 1);
    } else {
      p.url = info.url;
    }
    changed++;
  }
  return changed;
}

module.exports = { empty, readRaw, needsMigration, migrateV1, sanitize, load, save, byId, usesUrl, pairByOrigin, uniqueName, newId, MAX_ITEMS, NAME_MAX, VERSION };
