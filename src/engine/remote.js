'use strict';
/* Lee las ramas de un repositorio de GitHub sin tocar ninguna carpeta del usuario.
 *
 * Cómo: la primera vez hace un «clon desnudo sin archivos» (git clone --bare --filter=blob:none: solo el historial, pocos MB)
 * en la carpeta de datos de GitHelper; después, cada actualización es un git fetch. Con ese historial se dibuja el árbol de ramas.
 * Para repositorios privados se usan las credenciales que el propio Git del usuario ya tenga (Git Credential Manager, gh…);
 * esta lectura nunca abre ventanas de inicio de sesión ni pide claves: si no puede entrar, lo dice.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runProcess, git, LOG_LIMIT } = require('./git');
const { resolveExe } = require('./exe');
const { removeDir } = require('./files');
const GP = require('../shared/gitparse');
const { parseRepoUrl } = require('../shared/urls');

const CLONE_TIMEOUT = 5 * 60 * 1000;
const FETCH_TIMEOUT = 2 * 60 * 1000;
// Lectura automática: nada de ventanas ni preguntas (el Git Credential Manager usaría una ventana de inicio de sesión).
const QUIET_ENV = { GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };

const inflight = new Map();

function cacheDirFor(cacheRoot, url, urlOpts) {
  const info = parseRepoUrl(url, urlOpts);
  const key = info ? info.key : String(url);
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 8);
  const label = (info ? info.owner + '_' + info.repo : 'repo').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
  return path.join(cacheRoot, label + '_' + hash + '.git');
}

/** Traduce el error de git a algo que se entienda (y dice de qué tipo es, para que la interfaz pueda ayudar). */
function explainError(text) {
  const t = String(text || '');
  if (/could not read Username|Authentication failed|terminal prompts disabled|Permission denied|publickey|403|HTTP 401/i.test(t)) {
    return { kind: 'auth', message: 'No puedo leer ese repositorio. O no existe (revisa la dirección) o es privado y este ordenador no tiene la sesión de GitHub iniciada. Para uno privado, inicia sesión una vez con «gh auth login» en la Terminal externa.' };
  }
  if (/not found|does not exist|404|does not appear to be a git repository/i.test(t)) {
    return { kind: 'notfound', message: 'No encuentro ese repositorio. Revisa la dirección (usuario/repositorio).' };
  }
  if (/Could not resolve host|unable to access|timed out|Failed to connect|Connection (reset|refused)|Network is unreachable/i.test(t)) {
    return { kind: 'network', message: 'No he podido conectar con el servidor. Comprueba tu conexión a internet.' };
  }
  return { kind: 'other', message: 'Git no ha podido leer el repositorio: ' + (t.trim().split('\n').slice(-2).join(' ') || 'error desconocido') };
}

async function readCache(dir, res) {
  const refs = await git(dir, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags']);
  refs.out.split('\n').forEach((r) => {
    if (r.startsWith('refs/heads/')) res.branches.push(r.slice(11));
    else if (r.startsWith('refs/tags/')) res.tags.push(r.slice(10));
  });
  const head = await git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']);
  res.defaultBranch = head.code === 0 ? head.out.trim() || null : null;
  if (!res.branches.length) { res.empty = true; return; }
  const log = await git(dir, ['log', '--branches', '--tags', '--topo-order', '-n', String(LOG_LIMIT), '--decorate=full', '--format=' + GP.LOG_FORMAT]);
  if (log.code === 0) res.commits = GP.parseLog(log.out);
}

async function doLoad(cacheRoot, url, opts) {
  const o = opts || {};
  const dir = cacheDirFor(cacheRoot, url, o.urlOpts);
  const res = {
    url, dir, ok: false, error: null, errorKind: null, stale: false, empty: false, cloned: false,
    commits: [], branches: [], tags: [], defaultBranch: null, fetchedAt: null, limit: LOG_LIMIT,
  };
  if (!resolveExe('git')) {
    res.error = 'No encuentro git.exe. Instala «Git for Windows» (https://git-scm.com/download/win) y vuelve a abrir GitHelper.';
    res.errorKind = 'nogit';
    return res;
  }
  fs.mkdirSync(cacheRoot, { recursive: true });
  const cached = fs.existsSync(path.join(dir, 'HEAD'));

  if (!cached) {
    removeDir(dir);
    const r = await runProcess('git', ['clone', '--bare', '--filter=blob:none', '--quiet', '--', url, dir], { env: QUIET_ENV, timeoutMs: CLONE_TIMEOUT });
    if (r.code !== 0) {
      removeDir(dir);
      const why = r.timedOut ? { kind: 'network', message: 'Tarda demasiado en responder. Inténtalo de nuevo.' } : explainError(r.err);
      res.error = why.message;
      res.errorKind = why.kind;
      return res;
    }
    res.cloned = true;
    res.fetchedAt = Date.now();
  } else if (o.fetch !== false) {
    const r = await runProcess('git', ['-C', dir, 'fetch', '--prune', '--force', '--update-head-ok', '--quiet', 'origin', '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*'],
      { env: QUIET_ENV, timeoutMs: FETCH_TIMEOUT });
    if (r.code !== 0) {
      // Se enseña lo que había guardado la última vez, avisando de que puede no estar al día.
      const why = r.timedOut ? { kind: 'network', message: 'Tarda demasiado en responder.' } : explainError(r.err);
      res.error = why.message;
      res.errorKind = why.kind;
      res.stale = true;
    } else {
      res.fetchedAt = Date.now();
      // La rama principal puede haber cambiado desde el último clon.
      const sym = await runProcess('git', ['-C', dir, 'ls-remote', '--symref', 'origin', 'HEAD'], { env: QUIET_ENV, timeoutMs: 20000 });
      const m = sym.code === 0 ? sym.out.match(/^ref: refs\/heads\/(\S+)\tHEAD/m) : null;
      if (m) await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/' + m[1]]);
    }
  } else {
    try { res.fetchedAt = fs.statSync(path.join(dir, 'FETCH_HEAD')).mtimeMs; } catch { res.fetchedAt = null; }
  }

  await readCache(dir, res);
  res.ok = !res.error || res.stale;
  return res;
}

/**
 * @param {string} cacheRoot carpeta donde viven los clones desnudos
 * @param {string} url dirección del repositorio
 * @param {{fetch?:boolean, urlOpts?:object}} [opts] fetch:false = solo lo que ya hay guardado, sin ir a internet
 */
function loadRemote(cacheRoot, url, opts) {
  const key = url + '|' + (opts && opts.fetch === false ? 'cache' : 'fetch');
  if (inflight.has(key)) return inflight.get(key);
  const p = doLoad(cacheRoot, url, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Borra la copia guardada de un repositorio (al quitarlo de la lista). Solo toca dentro de cacheRoot.
 * Si en ese momento se está leyendo ese mismo repositorio, espera a que acabe: si no, la lectura volvería a crear la copia.
 */
async function removeCache(cacheRoot, url, urlOpts) {
  const pending = [];
  inflight.forEach((p, k) => { if (k.startsWith(url + '|')) pending.push(p.catch(() => null)); });
  await Promise.all(pending);
  const dir = cacheDirFor(cacheRoot, url, urlOpts);
  const rel = path.relative(cacheRoot, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  try { removeDir(dir); return true; } catch { return false; }
}

/**
 * Al arrancar: borra las copias de repositorios que se miraron con «Ver» sin guardarlos (o que ya no están en la lista).
 * Solo toca carpetas «*.git» que estén directamente dentro de cacheRoot.
 */
function pruneCache(cacheRoot, keepUrls, urlOpts) {
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(cacheRoot); } catch { return 0; }
  const keep = new Set((keepUrls || []).map((u) => path.basename(cacheDirFor(cacheRoot, u, urlOpts))));
  names.forEach((n) => {
    if (!n.endsWith('.git') || keep.has(n)) return;
    try { removeDir(path.join(cacheRoot, n)); removed++; } catch { /* se intentará la próxima vez */ }
  });
  return removed;
}

module.exports = { loadRemote, removeCache, pruneCache, cacheDirFor, explainError };
