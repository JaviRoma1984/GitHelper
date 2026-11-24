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

test('gitparse: del registro de una rama remota solo salen los push (no los fetch ni los borrados)', () => {
  const zero = '0'.repeat(40);
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const text = [
    zero + ' ' + a + ' Ana <ana@example.com> 1700000000 +0100\tupdate by push',
    a + ' ' + b + ' Ana <ana@example.com> 1700000100 +0100\tfetch origin: fast-forward',
    a + ' ' + b + ' Luis Pérez <luis@example.com> 1700000200 +0000\tupdate by push',
    b + ' ' + zero + ' Ana <ana@example.com> 1700000300 +0000\tupdate by push',
    'basura',
  ].join('\n') + '\n';
  const r = GP.parsePushLog(text, 'origin/main');
  assert.deepEqual(r, [
    { ref: 'origin/main', old: zero, new: a, who: 'Ana', ts: 1700000000 },
    { ref: 'origin/main', old: a, new: b, who: 'Luis Pérez', ts: 1700000200 },
  ]);
  assert.deepEqual(GP.parsePushLog('', 'x'), []);
});

test('graph: cada push se marca en el commit donde acabó y recuerda qué commits subió', () => {
  const commits = [
    { sha: 'c3', parents: ['c2'], subject: 'tercero', refs: [{ type: 'branch', name: 'main', head: true }] },
    { sha: 'c2', parents: ['c1'], subject: 'segundo', refs: [] },
    { sha: 'c1', parents: ['c0'], subject: 'primero', refs: [] },
    { sha: 'c0', parents: [], subject: 'inicio', refs: [] },
  ];
  const g = G.buildGraph(commits, {
    currentBranch: 'main', headSha: 'c3',
    pushes: [
      { ref: 'origin/main', old: 'c1', new: 'c3', ts: 1700000200, who: 'Ana' }, // subió c3 y c2
      { ref: 'origin/main', old: '0000', new: 'c1', ts: 1700000000, who: 'Ana' }, // primer push de main: todo lo que había
      { ref: 'origin/main', old: 'c0', new: 'ffff', ts: 1699999999, who: 'Ana' }, // ese commit ya no está: se ignora
    ],
  });
  assert.equal(g.pushMarks.length, 2);
  const m3 = g.pushMarks.find((m) => m.sha === 'c3');
  const by = Object.fromEntries(g.nodes.map((n) => [n.sha, n]));
  assert.equal(m3.x, by.c3.x);
  assert.equal(m3.items.length, 1);
  assert.deepEqual(m3.items[0].commits.map((c) => c.subject), ['tercero', 'segundo']);
  assert.equal(m3.items[0].count, 2);
  assert.equal(m3.items[0].isNew, false);
  const m1 = g.pushMarks.find((m) => m.sha === 'c1');
  assert.equal(m1.items[0].isNew, true);
  assert.deepEqual(m1.items[0].commits.map((c) => c.subject), ['primero', 'inicio']);
  // dos push que acaban en el mismo commit comparten marca, el más reciente primero
  const dos = G.buildGraph(commits, {
    currentBranch: 'main', headSha: 'c3',
    pushes: [{ ref: 'origin/main', old: 'c1', new: 'c3', ts: 10, who: 'A' }, { ref: 'copia/main', old: 'c1', new: 'c3', ts: 20, who: 'A' }],
  });
  assert.equal(dos.pushMarks.length, 1);
  assert.deepEqual(dos.pushMarks[0].items.map((i) => i.ref), ['copia/main', 'origin/main']);
  // el punto de partida queda fuera de lo dibujado: se avisa de que es parcial
  const fuera = G.buildGraph(commits, { currentBranch: 'main', headSha: 'c3', pushes: [{ ref: 'origin/main', old: 'zz99', new: 'c3', ts: 5, who: 'A' }] });
  assert.equal(fuera.pushMarks[0].items[0].partial, true);
  // un push de una rama nueva solo cuenta lo que tiene de más que la principal
  const conRama = G.buildGraph([
    { sha: 'd1', parents: ['m1'], subject: 'en dev', refs: [{ type: 'branch', name: 'dev' }] },
    { sha: 'm1', parents: [], subject: 'inicio', refs: [{ type: 'branch', name: 'main', head: true }] },
  ], { currentBranch: 'main', headSha: 'm1', pushes: [{ ref: 'origin/dev', old: '0000', new: 'd1', ts: 7, who: 'A' }] });
  assert.deepEqual(conRama.pushMarks[0].items[0].commits.map((c) => c.subject), ['en dev']);
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

test('graph: main es una línea larga que sigue de largo mientras otra rama avanza en paralelo', () => {
  const commits = [
    { sha: 'd3', parents: ['d2'], subject: 'dev 3', refs: [{ type: 'branch', name: 'dev', head: true }] },
    { sha: 'd2', parents: ['d1'], subject: 'dev 2', refs: [] },
    { sha: 'd1', parents: ['m2'], subject: 'dev 1', refs: [] },
    { sha: 'm2', parents: ['m1'], subject: 'main 2', refs: [{ type: 'branch', name: 'main' }] },
    { sha: 'm1', parents: [], subject: 'inicio', refs: [] },
  ];
  const g = G.buildGraph(commits, { currentBranch: 'dev', headSha: 'd3' });
  const by = Object.fromEntries(g.nodes.map((n) => [n.sha, n]));
  assert.ok(g.rail, 'debe haber raíl de la rama principal');
  assert.equal(g.rail.name, 'main');
  assert.equal(g.rail.y, g.top, 'va en el carril de arriba');
  assert.equal(g.rail.x1, by.m1.x, 'empieza en el primer commit de main');
  assert.equal(g.rail.tipX, by.m2.x, 'el tramo sólido acaba en el último commit de main');
  assert.equal(g.rail.lastX, by.d3.x, 'y la línea sigue hasta donde llega la rama más avanzada');
  assert.ok(g.rail.lastX > g.rail.tipX);
  assert.ok(by.d3.lane > 0 && by.m2.lane === 0);
  // sin rama principal con nombre, no se inventa un raíl para una rama cualquiera
  const solo = G.buildGraph([
    { sha: 'b2', parents: ['b1'], subject: 'x', refs: [{ type: 'branch', name: 'zeta' }] },
    { sha: 'b1', parents: [], subject: 'y', refs: [{ type: 'branch', name: 'alfa' }] },
  ], {});
  assert.equal(solo.rail, null);
});

test('graph: cada rama tiene su línea larga y su color, también la que no tiene commits propios (develop)', () => {
  const commits = [
    { sha: 'f2', parents: ['f1'], subject: 'feature 2', refs: [{ type: 'branch', name: 'feature', head: true }] },
    { sha: 'f1', parents: ['m2'], subject: 'feature 1', refs: [] },
    { sha: 'm2', parents: ['m1'], subject: 'main 2', refs: [{ type: 'branch', name: 'main' }, { type: 'branch', name: 'develop' }, { type: 'remote', name: 'origin/develop' }] },
    { sha: 'm1', parents: [], subject: 'inicio', refs: [] },
  ];
  const g = G.buildGraph(commits, { currentBranch: 'feature', headSha: 'f2' });
  assert.equal(g.rail.name, 'main');
  const byName = Object.fromEntries(g.rails.map((r) => [r.name, r]));
  assert.deepEqual(Object.keys(byName).sort(), ['develop', 'feature'], 'develop (sin commits propios) y feature tienen línea; main tiene la suya aparte');
  assert.equal(byName.develop.virtual, true);
  assert.equal(byName.feature.virtual, false);
  assert.notEqual(byName.develop.lane, byName.feature.lane, 'cada rama en su carril');
  assert.ok(byName.develop.lane > 0 && byName.feature.lane > 0);
  const m2 = g.nodes.find((n) => n.sha === 'm2');
  assert.equal(byName.develop.anchor.x, m2.x, 'develop sale del commit al que apunta');
  assert.ok(byName.develop.tipX > m2.x);
  // colores: todos distintos y las etiquetas usan el color de su rama
  const idx = [0, byName.develop.colorIdx, byName.feature.colorIdx];
  assert.equal(new Set(idx.map((i) => G.colorFor(i))).size, 3);
  assert.equal(g.branchColors.develop, byName.develop.colorIdx);
  assert.equal(g.branchColors.feature, byName.feature.colorIdx);
  assert.equal(g.branchColors.main, 0);
});

test('graph: una rama ya fusionada en su madre se ve abierta, con su recorrido y cerrada (sin línea larga); la que sigue abierta, sí', () => {
  const commits = [
    { sha: 'm3', parents: ['m2', 'd2'], subject: 'fusión de dev', refs: [{ type: 'branch', name: 'main', head: true }] },
    { sha: 'x2', parents: ['x1'], subject: 'nueva 2', refs: [{ type: 'branch', name: 'nueva' }] },
    { sha: 'x1', parents: ['m2'], subject: 'nueva 1', refs: [] },
    { sha: 'd2', parents: ['d1'], subject: 'dev 2', refs: [{ type: 'branch', name: 'dev' }] },
    { sha: 'd1', parents: ['m1'], subject: 'dev 1', refs: [] },
    { sha: 'm2', parents: ['m1'], subject: 'main 2', refs: [] },
    { sha: 'm1', parents: [], subject: 'inicio', refs: [] },
  ];
  const g = G.buildGraph(commits, { currentBranch: 'main', headSha: 'm3' });
  const names = g.rails.map((r) => r.name);
  assert.ok(!names.includes('dev'), 'dev ya está fusionada en main: sin línea larga');
  assert.ok(names.includes('nueva'), 'nueva sigue abierta: con línea larga');
  assert.equal(g.segments.find((s) => s.name === 'dev').merged, true);
  assert.equal(g.segments.find((s) => s.name === 'nueva').merged, false);
  // sigue estando representada: sus commits en su carril, el cruce de salida y el de fusión
  const by = Object.fromEntries(g.nodes.map((n) => [n.sha, n]));
  assert.ok(by.d1.lane > 0 && by.d1.lane === by.d2.lane);
  assert.ok(g.edges.some((e) => e.kind === 'fork' && e.from === 'm1' && e.to === 'd1'), 'sale de main');
  assert.ok(g.edges.some((e) => e.kind === 'merge' && e.from === 'd2' && e.to === 'm3'), 'y se cierra con la fusión');
  // una rama sin commits propios (develop recién creada) sigue abierta aunque main haya avanzado
  const solo = G.buildGraph([
    { sha: 'm2', parents: ['m1'], subject: 'main 2', refs: [{ type: 'branch', name: 'main', head: true }] },
    { sha: 'm1', parents: [], subject: 'inicio', refs: [{ type: 'branch', name: 'develop' }] },
  ], { currentBranch: 'main', headSha: 'm2' });
  assert.deepEqual(solo.rails.map((r) => r.name), ['develop']);
});

test('graph: «estás aquí» señala el commit donde se está (y su rama) o, si no está, hasta dónde llega la rama', () => {
  const commits = [
    { sha: 'f2', parents: ['f1'], subject: 'feature 2', refs: [{ type: 'branch', name: 'feature', head: true }] },
    { sha: 'f1', parents: ['m2'], subject: 'feature 1', refs: [] },
    { sha: 'm2', parents: ['m1'], subject: 'main 2', refs: [{ type: 'branch', name: 'main' }] },
    { sha: 'm1', parents: [], subject: 'inicio', refs: [] },
  ];
  const exacto = G.buildGraph(commits, { currentBranch: 'feature', headSha: 'f2', youAreAt: 'f2', youAreOn: 'feature' });
  const by = Object.fromEntries(exacto.nodes.map((n) => [n.sha, n]));
  assert.equal(exacto.here.sha, 'f2');
  assert.equal(exacto.here.exact, true);
  assert.equal(exacto.here.branch, 'feature');
  assert.equal(exacto.here.x, by.f2.x);
  assert.equal(exacto.here.y, by.f2.y);
  assert.ok(exacto.branchColors.feature > 0, 'la flecha usará el color de la rama feature');
  // el commit exacto no está en el dibujo (HEAD aún sin subir): se señala hasta dónde llega la rama
  const sinSubir = G.buildGraph(commits, { currentBranch: 'feature', youAreAt: 'nuevo-local', youAreOn: 'feature' });
  assert.equal(sinSubir.here.sha, 'f2');
  assert.equal(sinSubir.here.exact, false);
  // la rama tampoco está: no hay flecha
  assert.equal(G.buildGraph(commits, { currentBranch: 'main', youAreAt: 'nuevo-local', youAreOn: 'otra' }).here, null);
  // sin pedirlo, no hay flecha; con ella, el dibujo es más alto (sitio para la flecha)
  const sin = G.buildGraph(commits, { currentBranch: 'feature', headSha: 'f2' });
  assert.equal(sin.here, null);
  assert.equal(exacto.height, sin.height + G.HERE_PAD);
});

test('graph: una rama fusionada SIN commit de fusión (fast-forward, rebase, squash) pierde su línea al infinito', () => {
  // fast-forward: «x» apunta a un commit de la principal y git la da por fusionada
  const ff = [
    { sha: 'm3', parents: ['m2'], subject: 'tercero', refs: [{ type: 'branch', name: 'main', head: true }, { type: 'branch', name: 'x' }] },
    { sha: 'm2', parents: ['m1'], subject: 'segundo', refs: [] },
    { sha: 'm1', parents: [], subject: 'inicio', refs: [] },
  ];
  const abierta = G.buildGraph(ff, { currentBranch: 'main', headSha: 'm3' });
  assert.ok(abierta.rails.some((r) => r.name === 'x'), 'sin saber que se fusionó, una rama sin commits propios se ve abierta');
  const cerrada = G.buildGraph(ff, { currentBranch: 'main', headSha: 'm3', mergedBranches: ['x'], mergedTrunkSha: 'm3' });
  assert.ok(!cerrada.rails.some((r) => r.name === 'x'), 'fusionada: sin línea larga');
  assert.deepEqual(cerrada.mergedBranches, ['x']);
  assert.ok(cerrada.nodes.find((n) => n.sha === 'm3').chips.some((c) => c.name === 'x'), 'pero su etiqueta sigue sobre el commit donde quedó');
  assert.equal(cerrada.rails.length, 0);
  // rebase / squash: «x» tiene sus propios commits, que no están en la historia de la principal
  const real = [
    { sha: 's3', parents: ['m2'], subject: 'squash de x', refs: [{ type: 'branch', name: 'main', head: true }] },
    { sha: 'x2', parents: ['x1'], subject: 'x dos', refs: [{ type: 'branch', name: 'x' }] },
    { sha: 'x1', parents: ['m1'], subject: 'x uno', refs: [] },
    { sha: 'm2', parents: ['m1'], subject: 'segundo', refs: [] },
    { sha: 'm1', parents: [], subject: 'inicio', refs: [] },
  ];
  assert.ok(G.buildGraph(real, { currentBranch: 'main' }).rails.some((r) => r.name === 'x'), 'sin saberlo, sigue abierta');
  const sq = G.buildGraph(real, { currentBranch: 'main', mergedBranches: ['x'], mergedTrunkSha: 's3' });
  assert.ok(!sq.rails.some((r) => r.name === 'x'));
  assert.equal(sq.segments.find((s) => s.name === 'x').merged, true);
  // se sigue viendo su recorrido: sale de la principal y avanza en su carril
  const by = Object.fromEntries(sq.nodes.map((n) => [n.sha, n]));
  assert.ok(by.x1.lane > 0 && by.x1.lane === by.x2.lane);
  assert.ok(sq.edges.some((e) => e.kind === 'fork' && e.from === 'm1' && e.to === 'x1'));
  // si la principal es OTRA punta (p. ej. GitHub aún no tiene la fusión), el dato local no se aplica
  const otra = G.buildGraph(real, { currentBranch: 'main', mergedBranches: ['x'], mergedTrunkSha: 'otra-punta' });
  assert.ok(otra.rails.some((r) => r.name === 'x'), 'no se cierra hasta que la principal sea la misma');
  assert.equal(otra.segments.find((s) => s.name === 'x').merged, false);
});

test('graph: la fusión se reconoce aunque el commit del que salió la rama quede fuera de lo dibujado', () => {
  const commits = [
    { sha: 'M', parents: ['m2', 'x1'], subject: 'fusión de x', refs: [{ type: 'branch', name: 'main', head: true }] },
    { sha: 'x1', parents: ['fuera-1'], subject: 'x uno', refs: [{ type: 'branch', name: 'x' }] },
    { sha: 'm2', parents: ['fuera-2'], subject: 'segundo', refs: [] },
  ];
  const g = G.buildGraph(commits, { currentBranch: 'main', headSha: 'M' });
  assert.equal(g.segments.find((s) => s.name === 'x').merged, true);
  assert.ok(!g.rails.some((r) => r.name === 'x'));
});


test('graph: el zoom sube y baja de nivel en nivel y nunca se sale de los límites', () => {
  const L = G.ZOOM_LEVELS;
  assert.ok(L.includes(1), 'existe el 100 %');
  assert.ok(L.every((v, i) => i === 0 || v > L[i - 1]), 'niveles en orden');
  assert.equal(G.nextZoom(1, 1), 1.25);
  assert.equal(G.nextZoom(1, -1), 0.8);
  assert.equal(G.nextZoom(1, 0), 1);
  assert.equal(G.nextZoom(1.1, 1), 1.25, 'desde un valor intermedio parte del nivel más cercano');
  assert.equal(G.nextZoom(L[L.length - 1], 1), L[L.length - 1], 'no pasa del máximo');
  assert.equal(G.nextZoom(L[0], -1), L[0], 'no baja del mínimo');
  let z = L[0];
  const subida = [z];
  for (let i = 0; i < L.length + 3; i++) { z = G.nextZoom(z, 1); subida.push(z); }
  assert.deepEqual(subida.slice(0, L.length), L, 'sube pasando por todos los niveles');
  assert.equal(subida[subida.length - 1], L[L.length - 1]);
});


test('graph: con muchas ramas (más que colores en la paleta) todas siguen teniendo un color distinto', () => {
  const commits = [];
  for (let i = 1; i <= 14; i++) commits.push({ sha: 'b' + i, parents: ['m1'], subject: 'rama ' + i, refs: [{ type: 'branch', name: 'rama' + String(i).padStart(2, '0') }] });
  commits.push({ sha: 'm1', parents: [], subject: 'inicio', refs: [{ type: 'branch', name: 'main', head: true }] });
  const g = G.buildGraph(commits, { currentBranch: 'main', headSha: 'm1' });
  assert.equal(g.rails.length, 14);
  const colors = g.rails.map((r) => G.colorFor(r.colorIdx));
  colors.push(G.colorFor(0));
  assert.equal(new Set(colors).size, 15, 'ningún color repetido');
  assert.equal(new Set(g.rails.map((r) => r.lane)).size, 14, 'un carril para cada rama');
  assert.ok(g.height > g.top + 13 * G.LANE_H);
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
