'use strict';
/* Utilidades de rutas y lectura de archivos para la consola. Todo se limita a la carpeta del repositorio local. */
const fs = require('fs');
const path = require('path');

const MAX_READ = 1024 * 1024;

function normPath(p) {
  let r = path.resolve(p);
  if (process.platform === 'win32') r = r.toLowerCase();
  return r.replace(/[\\/]+$/, '');
}

function samePath(a, b) {
  return normPath(a) === normPath(b);
}

/** Une una ruta relativa a la carpeta del repositorio sin dejar salirse de ella con «..». */
function safeJoin(root, rel) {
  const p = path.resolve(root, rel || '.');
  const r = path.relative(root, p);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error('Esa ruta está fuera de la carpeta del repositorio.');
  return p;
}

/** Lee un archivo de texto (con tope de tamaño). Devuelve { content } o { binary } / { tooBig }. */
function readFile(root, rel) {
  const p = safeJoin(root, rel);
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error('no es un archivo.');
  if (st.size > MAX_READ) return { tooBig: true };
  const buf = fs.readFileSync(p);
  if (buf.includes(0)) return { binary: true };
  return { content: buf.toString('utf8').replace(/^\uFEFF/, '') };
}

/**
 * Borra una carpeta entera aunque tenga archivos de solo lectura (git marca así sus paquetes y objetos).
 * En Windows, el rmSync de Electron falla con EPERM ante ellos: se les quita antes el atributo de solo lectura.
 */
function removeDir(dir) {
  const walk = (p) => {
    let st;
    try { st = fs.lstatSync(p); } catch { return; }
    if (st.isDirectory()) { try { fs.readdirSync(p).forEach((n) => walk(path.join(p, n))); } catch { /* sigue */ } }
    try { fs.chmodSync(p, 0o666); } catch { /* sigue */ }
  };
  walk(dir);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

module.exports = { samePath, normPath, safeJoin, readFile, removeDir };
