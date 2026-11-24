'use strict';
/* Ejecuta git/gh de verdad y lee el estado del repositorio local para dibujarlo. */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveExe } = require('./exe');
const { samePath } = require('./files');
const GP = require('../shared/gitparse');

const MAX_OUTPUT = 1500000; // bytes de texto como máximo por comando
const LOG_LIMIT = 300; // commits que se dibujan como máximo en cada visualizador

function baseEnv(extra) {
  return Object.assign({}, process.env, {
    GIT_TERMINAL_PROMPT: '0', // si falta la contraseña, que falle en vez de quedarse esperando
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GH_PAGER: 'cat',
    GIT_EDITOR: 'true', // «git commit» sin -m no abre editor: falla con un mensaje claro
    GIT_SEQUENCE_EDITOR: 'true',
    GIT_MERGE_AUTOEDIT: 'no',
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    LC_ALL: 'C', // mensajes de git en inglés, igual que en la documentación
    LANGUAGE: 'en',
  }, extra || {});
}

function killTree(child) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch { /* ya terminó */ }
}

/**
 * Ejecuta un programa sin shell (así no hay inyección de otros comandos).
 * @returns {Promise<{code:number, out:string, err:string, cancelled?:boolean, timedOut?:boolean, truncated?:boolean, notFound?:boolean}>}
 */
function runProcess(exeName, args, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const exe = resolveExe(exeName);
    if (!exe) { resolve({ code: 127, out: '', err: '', notFound: true }); return; }
    let child;
    try {
      child = spawn(exe, args, { cwd: o.cwd, env: baseEnv(o.env), windowsHide: true, stdio: [o.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: 126, out: '', err: String(e.message || e) });
      return;
    }
    if (o.input !== undefined) { // texto que se le pasa al programa por su entrada (p. ej. git patch-id)
      child.stdin.on('error', () => { /* el programa pudo cerrar la entrada antes de leerlo todo */ });
      child.stdin.end(o.input);
    }
    let out = '';
    let err = '';
    let bytes = 0;
    let truncated = false;
    let cancelled = false;
    let timedOut = false;
    const handle = (stream) => (text) => {
      if (truncated) return;
      bytes += text.length;
      if (bytes > MAX_OUTPUT) {
        truncated = true;
        if (o.onData) o.onData('\n[…salida demasiado larga: se corta aquí. Usa -n 20 o --oneline para ver menos.]\n', 'err');
        killTree(child);
        return;
      }
      if (stream === 'out') out += text; else err += text;
      if (o.onData) o.onData(text, stream);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', handle('out'));
    child.stderr.on('data', handle('err'));
    const timer = o.timeoutMs ? setTimeout(() => { timedOut = true; killTree(child); }, o.timeoutMs) : null;
    const onAbort = () => { cancelled = true; killTree(child); };
    if (o.signal) {
      if (o.signal.aborted) onAbort(); else o.signal.addEventListener('abort', onAbort, { once: true });
    }
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 126, out, err: err + String(e.message || e) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (o.signal) o.signal.removeEventListener('abort', onAbort);
      resolve({ code: code === null ? 1 : code, out, err, cancelled, timedOut, truncated });
    });
  });
}

/** Argumentos extra que añadimos a lo que escribe el usuario (no cambian su configuración, solo esta ejecución). */
function userGitArgs(argv, color) {
  const pre = ['-c', 'core.quotepath=false', '-c', 'init.defaultBranch=main', '-c', 'core.safecrlf=false'];
  if (color) pre.push('-c', 'color.ui=always');
  return pre.concat(argv);
}

// ---------- estado del repositorio local ----------

function git(cwd, args, extraEnv) {
  return runProcess('git', ['-c', 'core.quotepath=false'].concat(args), { cwd, env: Object.assign({ GIT_OPTIONAL_LOCKS: '0' }, extraEnv), timeoutMs: 20000 });
}

function parseRemotes(text) {
  const map = new Map();
  String(text || '').split('\n').forEach((line) => {
    const m = line.match(/^(\S+)\t(\S+) \((fetch|push)\)$/);
    if (!m) return;
    if (!map.has(m[1])) map.set(m[1], { name: m[1], url: m[2] });
    if (m[3] === 'fetch') map.get(m[1]).url = m[2];
  });
  return Array.from(map.values());
}

/**
 * Las subidas (git push) hechas desde esta carpeta, según el registro que git guarda de cada rama remota
 * (.git/logs/refs/remotes/*). Solo están las que se hicieron desde ESTE ordenador y que git aún no ha olvidado (unos 90 días).
 */
async function readPushes(cwd) {
  const gp = await git(cwd, ['rev-parse', '--git-path', 'logs/refs/remotes']);
  if (gp.code !== 0) return [];
  const base = path.resolve(cwd, gp.out.trim());
  const out = [];
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.forEach((e) => {
      const name = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(path.join(dir, e.name), name); return; }
      if (/(^|\/)HEAD$/.test(name)) return;
      let text = '';
      try { text = fs.readFileSync(path.join(dir, e.name), 'utf8'); } catch { return; }
      GP.parsePushLog(text, name).forEach((p) => out.push(p));
    });
  };
  walk(base, '');
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, 80);
}

/**
 * Ramas locales en cuyo registro (reflog) consta que se hicieron commits EN ELLA. Sirve para distinguir una rama que ya se fusionó
 * por fast-forward (tuvo trabajo y ahora apunta a un commit de la principal) de una rama recién creada sin trabajo (solo «branch: Created from…»).
 */
async function branchesWithOwnCommits(cwd) {
  const gp = await git(cwd, ['rev-parse', '--git-path', 'logs/refs/heads']);
  const out = new Set();
  if (gp.code !== 0) return out;
  const base = path.resolve(cwd, gp.out.trim());
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.forEach((e) => {
      const name = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(path.join(dir, e.name), name); return; }
      let text = '';
      try { text = fs.readFileSync(path.join(dir, e.name), 'utf8'); } catch { return; }
      if (text.split('\n').some((l) => /\t(commit|cherry-pick|rebase \(pick\))/.test(l))) out.add(name);
    });
  };
  walk(base, '');
  return out;
}

/** Los «códigos de parche» (git patch-id) de lo que sale de un git diff / git log -p: sirven para saber si dos cambios son el mismo aunque estén en commits distintos. */
async function patchIds(cwd, gitArgs) {
  const d = await git(cwd, gitArgs);
  if (d.code !== 0 || !d.out.trim()) return [];
  const p = await runProcess('git', ['patch-id', '--stable'], { cwd, input: d.out, timeoutMs: 20000 });
  return p.code === 0 ? p.out.split('\n').map((l) => l.split(' ')[0]).filter(Boolean) : [];
}

const TRUNK_NAMES = ['main', 'master', 'trunk', 'develop'];
const mergedCache = new Map(); // «carpeta|rama|punta|punta de la principal|¿con trabajo propio?» -> true/false (solo se recalcula si cambia algo)

/**
 * Qué ramas locales da git por fusionadas en la principal, aunque la fusión no dejara un commit de fusión:
 *  - fast-forward (o fusión normal): su punta ya está en la historia de la principal Y tuvo commits propios (reflog);
 *  - rebase / cherry-pick: todos sus commits ya están en la principal con otro código (git cherry marca «-»).
 * Una fusión «squash» no deja rastro que git sepa leer: esa rama se sigue viendo como abierta.
 * @returns {Promise<{trunk:string|null, trunkSha:string|null, merged:string[]}>}
 */
async function readMergedBranches(cwd, branches) {
  const none = { trunk: null, trunkSha: null, merged: [] };
  const trunk = TRUNK_NAMES.find((t) => branches.includes(t));
  if (!trunk || branches.length < 2) return none;
  const heads = await git(cwd, ['for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/heads']);
  if (heads.code !== 0) return none;
  const shaOf = new Map();
  heads.out.split('\n').forEach((l) => { const m = l.match(/^([0-9a-f]{40}) (.+)$/); if (m) shaOf.set(m[2], m[1]); });
  const trunkSha = shaOf.get(trunk);
  if (!trunkSha) return none;
  const own = await branchesWithOwnCommits(cwd);
  const others = Array.from(shaOf.entries()).filter(([n]) => n !== trunk).slice(0, 40);
  const merged = [];
  const check = async ([name, sha]) => {
    const key = [cwd, name, sha, trunkSha, own.has(name)].join('|');
    if (!mergedCache.has(key)) {
      let result = false;
      const anc = await git(cwd, ['merge-base', '--is-ancestor', sha, trunkSha]);
      if (anc.code === 0) result = own.has(name);
      else if (anc.code === 1) {
        const ch = await git(cwd, ['cherry', trunk, sha]);
        const lines = ch.code === 0 ? ch.out.split('\n').filter(Boolean) : [];
        result = lines.length > 0 && lines.every((l) => l.startsWith('- '));
        if (!result) {
          // «squash»: todos los commits de la rama se juntaron en uno solo en la principal. Se compara el cambio total de la rama con el de cada commit
          // que la principal ha ganado desde que la rama salió de ella (sin escribir nada en el repositorio).
          const mb = await git(cwd, ['merge-base', trunk, sha]);
          const base = mb.code === 0 ? mb.out.trim() : '';
          if (base) {
            const mine = await patchIds(cwd, ['diff', '--no-color', base, sha]);
            if (mine.length === 1) {
              const theirs = await patchIds(cwd, ['log', '-p', '--no-color', '--no-merges', '-n', '200', base + '..' + trunk]);
              result = theirs.includes(mine[0]);
            }
          }
        }
      }
      if (mergedCache.size > 2000) mergedCache.clear();
      mergedCache.set(key, result);
    }
    if (mergedCache.get(key)) merged.push(name);
  };
  for (let i = 0; i < others.length; i += 6) await Promise.all(others.slice(i, i + 6).map(check)); // de 6 en 6, para no lanzar decenas de procesos a la vez
  return { trunk, trunkSha, merged };
}

async function getState(cwd) {
  const state = {
    cwd: cwd || null,
    name: cwd ? path.basename(cwd) : '',
    noFolder: !cwd, // todavía no se ha elegido ninguna carpeta
    exists: false,
    gitAvailable: !!resolveExe('git'),
    ghAvailable: !!resolveExe('gh'),
    isRepo: false,
    parentRepo: null,
    error: null,
    branch: null,
    detached: false,
    unborn: false,
    headSha: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    counts: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
    merging: false,
    rebasing: false,
    remotes: [],
    origin: null,
    commits: [],
    branches: [],
    remoteBranches: [],
    tags: [],
    pushes: [],
    mergedBranches: [], // ramas que git da por fusionadas en la principal (fast-forward, rebase…)
    mergedTrunkSha: null, // la punta de la principal con la que se calculó lo anterior
    limit: LOG_LIMIT,
    empty: false,
  };
  if (!cwd) return state;
  try { state.exists = fs.statSync(cwd).isDirectory(); } catch { state.exists = false; }
  if (!state.exists || !state.gitAvailable) return state;
  try { state.empty = fs.readdirSync(cwd).length === 0; } catch { /* ignorar */ }

  const top = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) {
    if (/dubious ownership/i.test(top.err)) state.error = 'dubious ownership';
    return state;
  }
  const topDir = top.out.trim();
  if (!samePath(topDir, cwd)) { state.parentRepo = topDir; return state; }
  state.isRepo = true;

  const [status, refs, remotes, gitDir] = await Promise.all([
    git(cwd, ['status', '--porcelain=v2', '--branch', '-z']),
    git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags']),
    git(cwd, ['remote', '-v']),
    git(cwd, ['rev-parse', '--git-dir']),
  ]);

  if (status.code === 0) {
    const st = GP.parseStatus(status.out);
    state.files = st.files;
    state.counts = st.counts;
    state.upstream = st.branch.upstream;
    state.ahead = st.branch.ahead;
    state.behind = st.branch.behind;
    if (st.branch.head === '(detached)') { state.detached = true; state.branch = null; } else state.branch = st.branch.head;
    if (st.branch.oid === '(initial)') state.unborn = true; else state.headSha = st.branch.oid;
  }

  refs.out.split('\n').forEach((r) => {
    if (r.startsWith('refs/heads/')) state.branches.push(r.slice(11));
    else if (r.startsWith('refs/remotes/')) { const n = r.slice(13); if (!/\/HEAD$/.test(n)) state.remoteBranches.push(n); }
    else if (r.startsWith('refs/tags/')) state.tags.push(r.slice(10));
  });
  state.remotes = parseRemotes(remotes.out);
  const origin = state.remotes.find((r) => r.name === 'origin');
  state.origin = origin ? origin.url : null;

  if (gitDir.code === 0) {
    const gd = path.resolve(cwd, gitDir.out.trim());
    const has = (n) => fs.existsSync(path.join(gd, n));
    state.merging = has('MERGE_HEAD');
    state.rebasing = has('rebase-merge') || has('rebase-apply');
  }

  if (!state.unborn) {
    const log = await git(cwd, ['log', '--branches', '--remotes', '--tags', 'HEAD', '--topo-order', '-n', String(LOG_LIMIT), '--decorate=full', '--format=' + GP.LOG_FORMAT]);
    if (log.code === 0) state.commits = GP.parseLog(log.out);
    state.pushes = await readPushes(cwd);
    const mb = await readMergedBranches(cwd, state.branches);
    state.mergedBranches = mb.merged;
    state.mergedTrunkSha = mb.trunkSha;
  }
  return state;
}

module.exports = { runProcess, userGitArgs, getState, readPushes, readMergedBranches, baseEnv, parseRemotes, git, LOG_LIMIT };
