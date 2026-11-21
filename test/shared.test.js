'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRepoUrl, sameRepo } = require('../src/shared/urls');
const Shell = require('../src/shared/shell');
const GP = require('../src/shared/gitparse');
const G = require('../src/shared/graph');
const Cmds = require('../src/shared/commands-data');
const { interactiveBlock } = require('../src/shared/interactive');

// ---------- URLs ----------
test('urls: formas válidas de GitHub', () => {
  const a = parseRepoUrl('https://github.com/octo/hello');
  assert.equal(a.kind, 'github');
  assert.equal(a.label, 'octo/hello');
  assert.equal(a.url, 'https://github.com/octo/hello');
  assert.equal(parseRepoUrl('https://github.com/octo/hello.git').url, 'https://github.com/octo/hello');
  assert.equal(parseRepoUrl('  https://github.com/octo/hello/  ').label, 'octo/hello');
  assert.equal(parseRepoUrl('https://github.com/octo/hello/tree/main/src').label, 'octo/hello');
  assert.equal(parseRepoUrl('https://www.github.com/octo/hello').label, 'octo/hello');
  assert.equal(parseRepoUrl('git@github.com:octo/hello.git').label, 'octo/hello');
  assert.equal(parseRepoUrl('ssh://git@github.com/octo/hello.git').label, 'octo/hello');
  assert.equal(parseRepoUrl('https://github.com/octo/hello').web, 'https://github.com/octo/hello');
});

test('urls: otros servidores y rechazos', () => {
  assert.equal(parseRepoUrl('https://gitlab.com/grupo/proyecto.git').kind, 'other');
  assert.equal(parseRepoUrl('https://gitlab.com/grupo/proyecto.git').host, 'gitlab.com');
  [
    '', '   ', 'hello', 'github.com/octo/hello', 'https://github.com/octo', 'https://github.com/',
    '--upload-pack=calc', '-oProxyCommand=x', 'ext::sh -c calc', 'https://user:clave@github.com/octo/hello',
    'https://token@github.com/octo/hello', 'https://github.com/octo/hel lo', 'https://github.com/octo/hello;rm',
    'file:///C:/repo', 'C:\\repo', '/tmp/repo', 'https://github.com/../hello', 'javascript:alert(1)',
  ].forEach((u) => assert.equal(parseRepoUrl(u), null, 'debería rechazar: ' + JSON.stringify(u)));
  assert.equal(parseRepoUrl('x'.repeat(400)), null);
});

test('urls: carpetas solo en modo de pruebas', () => {
  assert.equal(parseRepoUrl('C:/datos/origin.git'), null);
  const l = parseRepoUrl('C:/datos/origin.git', { allowLocal: true });
  assert.equal(l.kind, 'local');
  assert.equal(parseRepoUrl('--oops', { allowLocal: true }), null);
});

test('urls: sameRepo ignora .git, mayúsculas y el protocolo', () => {
  assert.ok(sameRepo('https://github.com/Octo/Hello.git', 'git@github.com:octo/hello'));
  assert.ok(sameRepo('https://github.com/octo/hello', 'ssh://git@github.com/octo/hello.git'));
  assert.ok(!sameRepo('https://github.com/octo/hello', 'https://github.com/octo/otro'));
  assert.ok(!sameRepo('https://github.com/octo/hello', 'basura'));
});

// ---------- intérprete de la consola ----------
test('shell: comillas, && y redirección', () => {
  const r = Shell.parse('git commit -m "Primer commit" && git push');
  assert.equal(r.commands.length, 2);
  assert.deepEqual(r.commands[0].argv, ['git', 'commit', '-m', 'Primer commit']);
  const e = Shell.parse('echo "hola" >> notas.txt');
  assert.deepEqual(e.commands[0].redirect, { op: '>>', target: 'notas.txt' });
  assert.ok(Shell.parse('git log | head').error);
  assert.ok(Shell.parse('git status;ls').error);
  assert.ok(Shell.parse('echo "sin cerrar').error);
  assert.ok(Shell.parse('git add . &&').error);
});

// ---------- lectura de git ----------
test('gitparse: decoraciones y registro', () => {
  const d = GP.parseDecorations('HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main, refs/remotes/origin/HEAD, refs/heads/dev');
  assert.deepEqual(d.refs.map((r) => r.type + ':' + r.name + (r.head ? '*' : '')), ['branch:main*', 'tag:v1', 'remote:origin/main', 'branch:dev']);
  const log = 'a1\x1fb2 c3\x1fAna\x1f1700000000\x1fHEAD -> refs/heads/main\x1fFusión: x\x1e\nb2\x1f\x1fLuis\x1f1690000000\x1f\x1fprimero\x1e';
  const c = GP.parseLog(log);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].parents, ['b2', 'c3']);
  assert.equal(c[1].parents.length, 0);
});

test('gitparse: parseGithubUrl sigue disponible', () => {
  assert.equal(GP.parseGithubUrl('https://github.com/a/b.git').repo, 'b');
});

// ---------- dibujo de ramas ----------
test('graph: main arriba, la rama en su carril y la fusión', () => {
  const commits = [
    { sha: 'm3', parents: ['m2', 'd2'], subject: 'fusión', refs: [{ type: 'branch', name: 'main', head: true }] },
    { sha: 'd2', parents: ['d1'], subject: 'dev 2', refs: [{ type: 'branch', name: 'dev' }] },
    { sha: 'm2', parents: ['m1'], subject: 'main 2', refs: [] },
    { sha: 'd1', parents: ['m1'], subject: 'dev 1', refs: [] },
    { sha: 'm1', parents: [], subject: 'inicio', refs: [] },
  ];
  const g = G.buildGraph(commits, { currentBranch: 'main', headSha: 'm3' });
  const by = Object.fromEntries(g.nodes.map((n) => [n.sha, n]));
  assert.equal(by.m3.lane, 0);
  assert.equal(by.m1.lane, 0);
  assert.ok(by.d2.lane > 0);
  assert.equal(by.d1.lane, by.d2.lane);
  assert.ok(by.m3.isMerge);
  assert.equal(g.headSha, 'm3');
  assert.ok(g.edges.some((e) => e.kind === 'merge'));
  assert.ok(g.edges.some((e) => e.kind === 'fork'));
  assert.ok(by.m1.x < by.m3.x, 'el tiempo avanza hacia la derecha');
});

test('graph: sin commits y con cambios sin guardar', () => {
  assert.equal(G.buildGraph([], {}).empty, true);
  const g = G.buildGraph([{ sha: 'a', parents: [], subject: 'x', refs: [{ type: 'branch', name: 'main', head: true }] }], { headSha: 'a', pending: { count: 2, staged: 1, conflicts: 0 } });
  assert.equal(g.pending.count, 2);
});

// ---------- lista de órdenes ----------
test('órdenes: datos completos y sin duplicados dentro de cada sección', () => {
  assert.ok(Cmds.total() >= 300, 'esperaba al menos 300 órdenes, hay ' + Cmds.total());
  const ids = new Set();
  Cmds.SECTIONS.forEach((s) => {
    assert.ok(!ids.has(s.id), 'sección repetida ' + s.id);
    ids.add(s.id);
    assert.ok(s.title && s.icon && s.items.length, s.id);
    const seen = new Set();
    s.items.forEach((it) => {
      assert.ok(it.c && it.d, 'orden sin comando o sin explicación en ' + s.id);
      assert.ok(!seen.has(it.c) || /bisect/.test(it.c), 'orden repetida en ' + s.id + ': ' + it.c);
      seen.add(it.c);
      assert.ok(/^(git|gh|ls|cat|echo|touch|mkdir|rm|pwd|clear|help)\b/.test(it.c), 'empieza raro: ' + it.c);
    });
  });
  ['git commit -m "mensaje"', 'git push', 'git pull', 'git merge <rama>', 'gh pr create --fill', 'gh repo create <nombre> --public --source=. --remote=origin', 'git rebase <rama>', 'git stash pop', 'git switch -c <nombre>']
    .forEach((c) => assert.ok(Cmds.SECTIONS.some((s) => s.items.some((i) => i.c === c)), 'falta ' + c));
});

test('órdenes: el buscador filtra por comando y por explicación', () => {
  const porComando = Cmds.filter('stash pop');
  assert.ok(porComando.length >= 1 && porComando[0].items.some((i) => i.c === 'git stash pop'));
  const porTexto = Cmds.filter('rama');
  assert.ok(porTexto.reduce((n, s) => n + s.items.length, 0) > 10);
  assert.deepEqual(Cmds.filter('zzzz-no-existe'), []);
  assert.equal(Cmds.filter('').length, Cmds.SECTIONS.length);
});

// ---------- comandos que no se pueden ejecutar en la consola ----------
test('interactivos: se detectan y los normales no', () => {
  assert.ok(interactiveBlock(['git', 'rebase', '-i', 'HEAD~3']));
  assert.ok(interactiveBlock(['git', 'add', '-p']));
  assert.ok(interactiveBlock(['gh', 'auth', 'login']));
  assert.ok(interactiveBlock(['gh', 'repo', 'create']));
  assert.equal(interactiveBlock(['gh', 'repo', 'create', 'mi-repo', '--public']), null);
  assert.equal(interactiveBlock(['git', 'commit', '-m', 'x']), null);
  assert.equal(interactiveBlock(['gh', 'auth', 'status']), null);
});
