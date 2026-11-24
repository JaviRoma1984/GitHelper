'use strict';
/* Pruebas con git de verdad, en carpetas temporales. Nunca se toca internet: el «GitHub» es un repositorio desnudo local. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Git = require('../src/engine/git');
const Remote = require('../src/engine/remote');
const Store = require('../src/engine/store');
const { runCommand } = require('../src/engine/runner');
const { resolveExe } = require('../src/engine/exe');

const HAS_GIT = !!resolveExe('git');
const OPTS = { allowLocal: true };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'githelper-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.com', '-c', 'core.autocrlf=false'].concat(args), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fwd = (p) => p.replace(/\\/g, '/');

/** Crea un repositorio con main, una rama dev y una fusión; y un «GitHub» desnudo clonado de él. */
function makeWorld(name) {
  const base = path.join(tmp, name);
  const work = path.join(base, 'work');
  fs.mkdirSync(work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'uno');
  git(work, 'switch', '-qc', 'dev');
  fs.writeFileSync(path.join(work, 'b.txt'), 'b\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'dos en dev');
  git(work, 'switch', '-q', 'main');
  fs.writeFileSync(path.join(work, 'c.txt'), 'c\n');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'tres en main');
  git(work, 'merge', '-q', '--no-ff', 'dev', '-m', 'fusion');
  git(work, 'tag', 'v1');
  const origin = path.join(base, 'origin.git');
  git(base, 'clone', '-q', '--bare', work, origin);
  git(work, 'remote', 'add', 'origin', fwd(origin));
  git(work, 'fetch', '-q', 'origin');
  git(work, 'branch', '-q', '-u', 'origin/main', 'main');
  return { base, work, origin: fwd(origin), cache: path.join(base, 'cache') };
}

test('git: estado de un repositorio local con rama, origen y cambios', { skip: !HAS_GIT }, async () => {
  const w = makeWorld('estado');
  fs.writeFileSync(path.join(w.work, 'nuevo.txt'), 'x\n');
  const st = await Git.getState(w.work);
  assert.ok(st.isRepo);
  assert.equal(st.branch, 'main');
  assert.equal(st.origin, w.origin);
  assert.ok(st.branches.includes('dev') && st.branches.includes('main'));
  assert.ok(st.remoteBranches.includes('origin/main'));
  assert.ok(st.tags.includes('v1'));
  assert.equal(st.commits.length, 4);
  assert.equal(st.files.length, 1);
  assert.equal(st.counts.untracked, 1);
  assert.equal(st.ahead, 0);
  assert.equal(st.behind, 0);
  const head = st.commits.find((c) => c.refs.some((r) => r.head));
  assert.ok(head && head.parents.length === 2);
});

test('git: carpeta sin repositorio, dentro de otro y que no existe', { skip: !HAS_GIT }, async () => {
  const plain = path.join(tmp, 'plano');
  fs.mkdirSync(plain, { recursive: true });
  const a = await Git.getState(plain);
  assert.equal(a.isRepo, false);
  assert.equal(a.exists, true);
  const w = makeWorld('dentro');
  const sub = path.join(w.work, 'sub');
  fs.mkdirSync(sub);
  const b = await Git.getState(sub);
  assert.equal(b.isRepo, false);
  assert.ok(b.parentRepo);
  const c = await Git.getState(path.join(tmp, 'no-existe'));
  assert.equal(c.exists, false);
  const d = await Git.getState(null);
  assert.equal(d.noFolder, true);
});

test('remoto: clona el historial sin archivos, lo lee y lo actualiza con fetch', { skip: !HAS_GIT }, async () => {
  const w = makeWorld('remoto');
  const a = await Remote.loadRemote(w.cache, w.origin, { urlOpts: OPTS });
  assert.equal(a.ok, true, a.error);
  assert.equal(a.cloned, true);
  assert.deepEqual(a.branches.sort(), ['dev', 'main']);
  assert.deepEqual(a.tags, ['v1']);
  assert.equal(a.defaultBranch, 'main');
  assert.equal(a.commits.length, 4);
  assert.ok(a.commits[0].refs.some((r) => r.head && r.name === 'main'), 'la punta de main lleva la marca de rama principal');
  // nada de archivos de trabajo en la copia guardada
  assert.equal(fs.existsSync(path.join(Remote.cacheDirFor(w.cache, w.origin, OPTS), 'a.txt')), false);

  // se sube algo nuevo al «GitHub» y se actualiza
  git(w.work, 'switch', '-qc', 'nueva');
  fs.writeFileSync(path.join(w.work, 'n.txt'), 'n\n');
  git(w.work, 'add', '.');
  git(w.work, 'commit', '-qm', 'en nueva');
  git(w.work, 'push', '-q', 'origin', 'nueva');
  const b = await Remote.loadRemote(w.cache, w.origin, { urlOpts: OPTS });
  assert.equal(b.ok, true, b.error);
  assert.equal(b.cloned, false);
  assert.ok(b.branches.includes('nueva'));
  assert.equal(b.commits.length, 5);

  // se borra la rama en «GitHub»: --prune la quita
  git(w.work, 'push', '-q', 'origin', '--delete', 'nueva');
  const c = await Remote.loadRemote(w.cache, w.origin, { urlOpts: OPTS });
  assert.ok(!c.branches.includes('nueva'));

  // sin ir a internet: solo lo guardado
  const d = await Remote.loadRemote(w.cache, w.origin, { fetch: false, urlOpts: OPTS });
  assert.equal(d.ok, true);
  assert.equal(d.commits.length, 4);
});

test('remoto: repositorio vacío, inexistente y borrado de la copia guardada', { skip: !HAS_GIT }, async () => {
  const base = path.join(tmp, 'vacio');
  fs.mkdirSync(base, { recursive: true });
  const bare = path.join(base, 'vacio.git');
  git(base, 'init', '-q', '--bare', bare);
  const cache = path.join(base, 'cache');
  const e = await Remote.loadRemote(cache, fwd(bare), { urlOpts: OPTS });
  assert.equal(e.ok, true, e.error);
  assert.equal(e.empty, true);
  assert.equal(e.commits.length, 0);

  const nope = await Remote.loadRemote(cache, fwd(path.join(base, 'no-existe.git')), { urlOpts: OPTS });
  assert.equal(nope.ok, false);
  assert.ok(nope.error && nope.errorKind);

  const dir = Remote.cacheDirFor(cache, fwd(bare), OPTS);
  assert.ok(fs.existsSync(dir));
  assert.equal(await Remote.removeCache(cache, fwd(bare), OPTS), true);
  assert.equal(fs.existsSync(dir), false);

  // borrar mientras se está leyendo: espera a que acabe la lectura y no deja la copia recreada
  const bare2 = path.join(base, 'otro.git');
  git(base, 'init', '-q', '--bare', bare2);
  const reading = Remote.loadRemote(cache, fwd(bare2), { urlOpts: OPTS });
  const removing = Remote.removeCache(cache, fwd(bare2), OPTS);
  await Promise.all([reading, removing]);
  assert.equal(fs.existsSync(Remote.cacheDirFor(cache, fwd(bare2), OPTS)), false);

  // al arrancar se limpian las copias de repositorios que no están guardados
  const keep = await Remote.loadRemote(cache, fwd(bare), { urlOpts: OPTS });
  const orphan = await Remote.loadRemote(cache, fwd(bare2), { urlOpts: OPTS });
  assert.ok(keep.ok && orphan.ok);
  assert.equal(Remote.pruneCache(cache, [fwd(bare)], OPTS), 1);
  assert.ok(fs.existsSync(Remote.cacheDirFor(cache, fwd(bare), OPTS)));
  assert.equal(fs.existsSync(Remote.cacheDirFor(cache, fwd(bare2), OPTS)), false);
});

test('remoto: explicaciones de los errores de git', () => {
  assert.equal(Remote.explainError("fatal: could not read Username for 'https://github.com': terminal prompts disabled").kind, 'auth');
  assert.equal(Remote.explainError('remote: Repository not found.').kind, 'notfound');
  assert.equal(Remote.explainError('fatal: unable to access: Could not resolve host: github.com').kind, 'network');
  assert.equal(Remote.explainError('algo raro').kind, 'other');
});

test('consola: ejecuta git y los ayudantes en la carpeta local', { skip: !HAS_GIT }, async () => {
  const w = makeWorld('consola');
  const out = [];
  const hooks = { emit: (t) => out.push(t) };
  const run = (argv, redirect) => runCommand({ cwd: w.work }, { argv, redirect: redirect || null }, hooks);
  let r = await run(['git', 'branch', '--list']);
  assert.equal(r.code, 0);
  assert.ok(out.join('').includes('main'));
  r = await run(['echo', 'hola'], { op: '>', target: 'hola.txt' });
  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(path.join(w.work, 'hola.txt'), 'utf8'), 'hola\n');
  r = await run(['git', 'add', '.']);
  r = await run(['git', 'commit', '-m', 'desde la consola']);
  assert.equal(r.code, 0);
  r = await run(['git', 'push', 'origin', 'main']);
  assert.equal(r.code, 0);
  assert.equal(execFileSync('git', ['-C', w.origin, 'log', '-1', '--format=%s', 'main'], { encoding: 'utf8' }).trim(), 'desde la consola');
  // git apunta cada push en su registro: de ahí salen las marcas del dibujo
  const st = await Git.getState(w.work);
  const pushed = st.pushes.find((p) => p.ref === 'origin/main');
  assert.ok(pushed, 'el push queda apuntado en el registro de git');
  assert.equal(pushed.new, execFileSync('git', ['-C', w.work, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  assert.equal(pushed.old, execFileSync('git', ['-C', w.work, 'rev-parse', 'HEAD~1'], { encoding: 'utf8' }).trim());
  assert.ok(Math.abs(pushed.ts - Date.now() / 1000) < 120, 'con la hora de ahora');
  assert.ok(pushed.who);
  // los fetch no cuentan como push
  assert.ok(st.pushes.every((p) => p.new && p.old));
  // no se puede salir de la carpeta
  out.length = 0;
  r = await run(['cat', '../../fuera.txt']);
  assert.equal(r.code, 1);
  assert.match(out.join(''), /fuera de la carpeta/);
  // comandos desconocidos y bloqueados
  out.length = 0;
  r = await run(['powershell', '-c', 'dir']);
  assert.equal(r.code, 127);
  r = await run(['git', 'rebase', '-i', 'HEAD~2']);
  assert.equal(r.code, 2);
  // rm no sale de la carpeta ni borra la carpeta entera
  out.length = 0;
  r = await run(['rm', '-r', '.']);
  assert.equal(r.code, 1);
  assert.ok(fs.existsSync(path.join(w.work, '.git')));
});

test('almacén: guarda proyectos, deduplica nombres y descarta lo inválido', () => {
  const file = path.join(tmp, 'datos.json');
  assert.deepEqual(Store.load(file, OPTS), Store.empty());
  assert.equal(Store.empty().version, 2);
  const d = Store.empty();
  d.projects.push({ id: 'abc123def456', name: 'Mi proyecto', url: 'https://github.com/octo/hello', local: 'C:\\Proyectos\\Hello', savedAt: '2026-11-21T10:00:00.000Z' });
  d.selected.project = 'abc123def456';
  Store.save(file, d);
  const back = Store.load(file, OPTS);
  assert.equal(back.projects.length, 1);
  assert.deepEqual(back.projects[0], d.projects[0]);
  assert.equal(back.selected.project, 'abc123def456');
  assert.equal(Store.byId(back, 'abc123def456').name, 'Mi proyecto');
  assert.equal(Store.byId(back, 'nope'), null);

  // archivo estropeado, con direcciones peligrosas, nombres repetidos o proyectos sin nada
  fs.writeFileSync(file, JSON.stringify({
    version: 2,
    projects: [
      { id: 'aaaa1111', name: 'Uno', url: 'https://github.com/octo/hello.git', local: '' },
      { id: 'aaaa1111', name: 'uno', url: '', local: 'C:\\Otra' }, // mismo id y nombre que otro: se renombra y se le da otro id
      { id: 'bbbb2222', name: 'Peligroso', url: '--upload-pack=calc', local: '' }, // la dirección peligrosa se descarta y no queda nada
      { id: 'cccc3333', name: '', url: 'https://github.com/octo/x', local: '' }, // sin nombre
      { id: 'dddd4444', name: 'Solo carpeta', url: '', local: 'C:\\Carpeta' },
      { nada: 1 }, null, 'texto',
    ],
    selected: { project: 'no-existe' },
  }));
  const clean = Store.load(file, OPTS);
  assert.deepEqual(clean.projects.map((p) => p.name), ['Uno', 'uno (2)', 'Solo carpeta']);
  assert.equal(new Set(clean.projects.map((p) => p.id)).size, 3, 'ids únicos');
  assert.equal(clean.projects[0].url, 'https://github.com/octo/hello'); // normalizada, sin .git
  assert.equal(clean.selected.project, null);
  fs.writeFileSync(file, '{esto no es json');
  assert.deepEqual(Store.load(file, OPTS), Store.empty());
  assert.equal(Store.readRaw(file), null);
});

test('almacén: usesUrl sabe si otro proyecto comparte el mismo GitHub', () => {
  const d = Store.empty();
  d.projects.push({ id: 'p1p1p1p1', name: 'A', url: 'https://github.com/octo/hello', local: '' });
  d.projects.push({ id: 'p2p2p2p2', name: 'B', url: 'git@github.com:octo/hello.git', local: 'C:\\B' });
  assert.equal(Store.usesUrl(d, 'https://github.com/octo/hello', 'p1p1p1p1', OPTS), true);
  assert.equal(Store.usesUrl(d, 'https://github.com/octo/hello', 'p2p2p2p2', OPTS), true);
  d.projects.pop();
  assert.equal(Store.usesUrl(d, 'https://github.com/octo/hello', 'p1p1p1p1', OPTS), false);
  assert.equal(Store.usesUrl(d, '', 'x', OPTS), false);
});

test('almacén: los datos de la versión 1 (listas sueltas) se convierten en proyectos y se enlazan por el origin', { skip: !HAS_GIT }, async () => {
  const w = makeWorld('migracion'); // work (con origin = origin.git) + otra carpeta sin origin
  const suelta = path.join(w.base, 'suelta');
  fs.mkdirSync(suelta, { recursive: true });
  const adoptada = path.join(w.base, 'adoptada');
  fs.mkdirSync(adoptada, { recursive: true });
  git(adoptada, 'init', '-q', '-b', 'main');
  git(adoptada, 'remote', 'add', 'origin', 'https://github.com/octo/otro.git');

  const v1 = {
    version: 1,
    repos: [{ url: w.origin, savedAt: '2026-10-01T00:00:00.000Z' }, { url: 'https://github.com/octo/solo-url.git' }, { url: '--malo' }],
    locals: [{ path: w.work }, { path: suelta }, { path: adoptada }, { path: w.work.toUpperCase() }],
    selected: { repo: w.origin, local: w.work },
  };
  assert.equal(Store.needsMigration(v1), true);
  assert.equal(Store.needsMigration({ version: 2, projects: [] }), false);
  assert.equal(Store.needsMigration(null), false);

  const data = Store.sanitize(v1, OPTS);
  assert.equal(data.version, 2);
  // antes de enlazar: un proyecto por repositorio y uno por carpeta (la repetida en mayúsculas cuenta una sola vez en Windows)
  assert.ok(data.projects.every((p) => p.name && (p.url || p.local)));
  assert.ok(data.projects.some((p) => p.url === w.origin && !p.local));
  assert.ok(data.projects.some((p) => p.url === 'https://github.com/octo/solo-url' && !p.local));
  assert.ok(data.projects.some((p) => !p.url && p.local === w.work));
  assert.ok(Store.byId(data, data.selected.project), 'la selección se conserva');
  assert.equal(Store.byId(data, data.selected.project).url, w.origin);

  const originOf = async (dir) => {
    if (!fs.existsSync(path.join(dir, '.git'))) return null;
    const r = await Git.git(dir, ['config', '--get', 'remote.origin.url']);
    return r.code === 0 ? r.out.trim() : null;
  };
  const changed = await Store.pairByOrigin(data, originOf, OPTS);
  assert.ok(changed >= 2);
  const unido = data.projects.find((p) => p.url === w.origin);
  assert.equal(unido.local.toLowerCase(), w.work.toLowerCase(), 'la carpeta se une al proyecto de su GitHub');
  assert.equal(data.projects.filter((p) => p.local.toLowerCase() === w.work.toLowerCase()).length, 1, 'y no queda duplicada');
  assert.equal(data.selected.project, unido.id, 'la selección apunta al proyecto unido');
  const adopt = data.projects.find((p) => p.local === adoptada);
  assert.equal(adopt.url, 'https://github.com/octo/otro', 'una carpeta con origin de GitHub adopta esa dirección');
  assert.ok(data.projects.some((p) => p.local === suelta && !p.url), 'una carpeta sin origin se queda solo con la carpeta');
  assert.ok(data.projects.some((p) => p.url === 'https://github.com/octo/solo-url' && !p.local), 'una dirección sin carpeta se queda solo con la dirección');
  assert.equal(new Set(data.projects.map((p) => p.name.toLowerCase())).size, data.projects.length, 'nombres únicos');
});

test('ramas fusionadas: se reconocen fast-forward, fusión con commit, rebase y squash; no las abiertas ni las recién creadas', { skip: !HAS_GIT }, async () => {
  const commit = (cwd, f, m) => { fs.writeFileSync(path.join(cwd, f), m + '\n'); git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', m); };
  const x = (w, n) => { git(w, 'switch', '-qc', 'x'); for (let i = 1; i <= n; i++) commit(w, 'x' + i, 'x ' + i); git(w, 'switch', '-q', 'main'); };
  const casos = {
    abierta: { merged: false, hacer: (w) => { x(w, 1); } },
    'recién creada, sin trabajo': { merged: false, hacer: (w) => { git(w, 'branch', 'x'); } },
    'recién creada, y la principal avanza': { merged: false, hacer: (w) => { git(w, 'branch', 'x'); commit(w, 'm', 'main avanza'); } },
    'fast-forward (lo normal si la principal no avanzó)': { merged: true, hacer: (w) => { x(w, 2); git(w, 'merge', '-q', 'x'); } },
    'fast-forward y la principal sigue avanzando': { merged: true, hacer: (w) => { x(w, 1); git(w, 'merge', '-q', 'x'); commit(w, 'm', 'main sigue'); } },
    'fusión con commit de fusión': { merged: true, hacer: (w) => { x(w, 1); git(w, 'merge', '-q', '--no-ff', 'x', '-m', 'fusion'); } },
    'rebase / cherry-pick de un commit': { merged: true, hacer: (w) => { x(w, 1); commit(w, 'm', 'main avanza'); git(w, 'cherry-pick', 'x'); } },
    'rebase / cherry-pick de dos commits': { merged: true, hacer: (w) => { x(w, 2); commit(w, 'm', 'main avanza'); git(w, 'cherry-pick', 'x~1', 'x'); } },
    'squash de dos commits': { merged: true, hacer: (w) => { x(w, 2); git(w, 'merge', '-q', '--squash', 'x'); git(w, 'commit', '-qm', 'squash de x'); } },
    'squash y después la principal avanza': { merged: true, hacer: (w) => { x(w, 2); git(w, 'merge', '-q', '--squash', 'x'); git(w, 'commit', '-qm', 'squash de x'); commit(w, 'm', 'main sigue'); } },
    'con un cambio distinto en la principal (no es lo mismo)': { merged: false, hacer: (w) => { x(w, 1); commit(w, 'otro', 'otra cosa'); } },
  };
  let n = 0;
  for (const [nombre, caso] of Object.entries(casos)) {
    const w = path.join(tmp, 'fusionada-' + (++n));
    fs.mkdirSync(w, { recursive: true });
    git(w, 'init', '-q', '-b', 'main');
    commit(w, 'a', 'inicio');
    caso.hacer(w);
    const st = await Git.getState(w);
    const mainSha = git(w, 'rev-parse', 'main').trim();
    assert.equal(st.mergedTrunkSha, mainSha, nombre + ': la punta de la principal con la que se calcula');
    assert.equal(st.mergedBranches.includes('x'), caso.merged, nombre + ' → debía ' + (caso.merged ? '' : 'NO ') + 'darse por fusionada; sale: ' + JSON.stringify(st.mergedBranches));
    assert.ok(!st.mergedBranches.includes('main'), 'la principal nunca cuenta como fusionada');
  }
  // sin rama principal con nombre conocido no se inventa nada
  const sin = path.join(tmp, 'fusionada-sin-principal');
  fs.mkdirSync(sin, { recursive: true });
  git(sin, 'init', '-q', '-b', 'trabajo');
  commit(sin, 'a', 'inicio');
  git(sin, 'branch', 'otra');
  const st2 = await Git.getState(sin);
  assert.deepEqual(st2.mergedBranches, []);
  assert.equal(st2.mergedTrunkSha, null);
});

test('remoto: GitHelper reconoce por sí solo las ramas de GitHub ya fusionadas (sin ninguna carpeta local)', { skip: !HAS_GIT }, async () => {
  const w = makeWorld('remoto-fusionadas');
  const commit = (f, m) => { fs.writeFileSync(path.join(w.work, f), m + '\n'); git(w.work, 'add', '.'); git(w.work, 'commit', '-qm', m); };
  const rama = (nombre, n) => { git(w.work, 'switch', '-qc', nombre, 'main'); for (let i = 1; i <= n; i++) commit(nombre + i, nombre + ' ' + i); git(w.work, 'switch', '-q', 'main'); };
  rama('x', 1); // se fusionará por fast-forward
  rama('s', 2); // se fusionará con squash
  rama('r', 2); // se fusionará con rebase / cherry-pick
  git(w.work, 'branch', 'fresca'); // recién creada, sin trabajo propio
  git(w.work, 'push', '-q', 'origin', 'x', 's', 'r', 'fresca');

  const a = await Remote.loadRemote(w.cache, w.origin, { urlOpts: OPTS });
  assert.equal(a.ok, true, a.error);
  assert.deepEqual(a.mergedBranches, [], 'nada fusionado todavía');
  assert.equal(a.defaultBranch, 'main');
  assert.equal(a.trunkSha, git(w.work, 'rev-parse', 'main').trim());
  const mem = JSON.parse(fs.readFileSync(path.join(a.dir, 'githelper-ramas.json'), 'utf8'));
  assert.deepEqual(Object.keys(mem).sort(), ['r', 's', 'x'], 'se recuerda qué ramas han tenido trabajo propio (fresca, no)');

  // en GitHub se fusionan: x por fast-forward, s con squash y r con cherry-pick
  git(w.work, 'merge', '-q', 'x');
  git(w.work, 'merge', '-q', '--squash', 's');
  git(w.work, 'commit', '-qm', 'squash de s');
  git(w.work, 'cherry-pick', 'r~1', 'r');
  git(w.work, 'push', '-q', 'origin', 'main');

  const b = await Remote.loadRemote(w.cache, w.origin, { urlOpts: OPTS });
  assert.equal(b.ok, true, b.error);
  assert.deepEqual(b.mergedBranches.slice().sort(), ['r', 's', 'x'], 'x (la había visto con trabajo), s (squash) y r (cherry-pick)');
  assert.ok(!b.mergedBranches.includes('fresca'), 'una rama recién creada sin trabajo sigue abierta');
  assert.ok(!b.mergedBranches.includes('dev'), 'dev (fusión con commit de fusión) la cierra el dibujo por la historia, no esta lista');
  assert.equal(b.trunkSha, git(w.work, 'rev-parse', 'main').trim());

  // si GitHelper ve el repositorio por primera vez ya fusionado, solo se reconocen las fusiones que dejan huella en el contenido
  const c = await Remote.loadRemote(path.join(w.base, 'cache-nuevo'), w.origin, { urlOpts: OPTS });
  assert.deepEqual(c.mergedBranches.slice().sort(), ['r', 's'], 'x (fast-forward) ya fusionada la primera vez no se distingue de una recién creada');
  assert.ok(!c.mergedBranches.includes('fresca'));
});
