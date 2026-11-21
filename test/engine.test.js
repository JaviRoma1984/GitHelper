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

test('almacén: guarda, ordena, deduplica y descarta lo inválido', () => {
  const file = path.join(tmp, 'datos.json');
  assert.deepEqual(Store.load(file, OPTS), Store.empty());
  const d = Store.empty();
  d.repos.push({ url: 'https://github.com/octo/hello' });
  d.locals.push({ path: 'C:\\Proyectos\\Hello' });
  d.selected = { repo: 'https://github.com/octo/hello', local: 'C:\\Proyectos\\Hello' };
  Store.save(file, d);
  const back = Store.load(file, OPTS);
  assert.equal(back.repos.length, 1);
  assert.equal(back.selected.repo, 'https://github.com/octo/hello');
  assert.equal(Store.indexOfRepo(back, 'git@github.com:Octo/Hello.git', OPTS), 0);
  assert.equal(Store.indexOfLocal(back, 'c:\\proyectos\\hello\\'), process.platform === 'win32' ? 0 : -1);

  // archivo estropeado o con direcciones peligrosas
  fs.writeFileSync(file, JSON.stringify({
    repos: [{ url: '--upload-pack=calc' }, { url: 'https://github.com/octo/hello' }, { url: 'https://github.com/octo/hello.git' }, { nada: 1 }, null],
    locals: [{ path: '' }, { path: 'C:\\A' }, { path: 'c:\\a' }],
    selected: { repo: 'https://github.com/otro/otro', local: 'C:\\no\\guardada' },
  }));
  const clean = Store.load(file, OPTS);
  assert.equal(clean.repos.length, 1);
  assert.equal(clean.locals.length, process.platform === 'win32' ? 1 : 2);
  assert.equal(clean.selected.repo, null);
  assert.equal(clean.selected.local, null);
  fs.writeFileSync(file, '{esto no es json');
  assert.deepEqual(Store.load(file, OPTS), Store.empty());
});
