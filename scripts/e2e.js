'use strict';
/* Prueba de extremo a extremo: abre la aplicación de verdad, la maneja como una persona y saca capturas.
 * Uso:  electron . --e2e   con variables de entorno que apunten a carpetas TEMPORALES (nunca a tus carpetas):
 *   GITHELPER_USERDATA     datos del programa (proyectos guardados, copias de GitHub)
 *   GITHELPER_E2E_BASE     carpeta de trabajo de la prueba (aquí se crean los repositorios de ejemplo)
 *   GITHELPER_E2E_OUT      capturas e informe
 *   GITHELPER_E2E_STATE    archivo donde un escenario deja lo que el siguiente debe encontrar
 *   GITHELPER_E2E_SCENARIO = completo | reabrir | migracion
 * El «GitHub» de la prueba es un repositorio desnudo en una carpeta temporal: no se toca internet ni ninguna cuenta.
 * Los escenarios completo → reabrir se lanzan uno tras otro con los mismos datos: equivale a cerrar y reabrir el programa.
 * El escenario migracion arranca con un archivo de datos de la versión 1 (listas sueltas) que el lanzador prepara antes.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

exports.run = async function run({ win, app, getCwd, getData, dataFile, cacheRoot }) {
  const outDir = process.env.GITHELPER_E2E_OUT || path.join(__dirname, '..', '.e2e-tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const scenario = process.env.GITHELPER_E2E_SCENARIO || 'completo';
  const base = process.env.GITHELPER_E2E_BASE;
  const stateFile = process.env.GITHELPER_E2E_STATE;
  const wc = win.webContents;
  const results = [];
  const consoleErrors = [];
  wc.on('console-message', (event) => {
    const e = event && event.level !== undefined ? event : { level: 0, message: '' };
    if (e.level === 'error' || e.level >= 3) consoleErrors.push(String(e.message));
  });

  // Datos personales de quien ejecuta la prueba (usuario de Windows, nombre y correo de Git). NUNCA deben aparecer en la interfaz
  // de una persona nueva. Se calculan al momento: no hay ningún nombre escrito en el código.
  const personalWords = () => {
    const words = new Set();
    try { words.add(require('os').userInfo().username); } catch { /* sin usuario */ }
    ['user.name', 'user.email'].forEach((k) => {
      try {
        const v = execFileSync('git', ['config', '--global', k], { encoding: 'utf8' }).trim();
        if (v) words.add(k === 'user.email' ? v.split('@')[0] : v);
      } catch { /* sin configuración global */ }
    });
    return Array.from(words).filter((w) => w && w.length >= 4);
  };
  const PERSONAL = new RegExp(personalWords().map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '$^', 'i');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const exec = (code) => wc.executeJavaScript(code, true);
  const check = (name, cond, detail) => {
    results.push({ name, ok: !!cond, detail: cond ? undefined : String(detail === undefined ? '' : detail) });
    process.stdout.write((cond ? 'OK   ' : 'FALLA') + '  ' + name + (cond ? '' : '  -> ' + detail) + '\n');
  };
  // La captura puede fallar de forma pasajera (p. ej. «UnknownVizError» si Windows pausa el dibujo de la ventana): se reintenta.
  const shot = async (name) => {
    await sleep(350);
    for (let i = 0; i < 4; i++) {
      try {
        const img = await wc.capturePage();
        fs.writeFileSync(path.join(outDir, name + '.png'), img.toPNG());
        return;
      } catch (e) {
        if (i === 3) { process.stdout.write('AVISO  no se pudo sacar la captura ' + name + ': ' + (e && e.message) + '\n'); return; }
        try { win.showInactive(); win.webContents.invalidate(); } catch { /* ignorar */ }
        await sleep(700);
      }
    }
  };
  const waitFor = async (fn, ms) => {
    const end = Date.now() + (ms || 15000);
    for (;;) {
      let v = false;
      try { v = await fn(); } catch { v = false; }
      if (v) return true;
      if (Date.now() > end) return false;
      await sleep(120);
    }
  };
  const $val = (id) => exec('document.getElementById(' + JSON.stringify(id) + ').value');
  const $text = (sel) => exec('(document.querySelector(' + JSON.stringify(sel) + ') || {innerText: ""}).innerText');
  const $count = (sel) => exec('document.querySelectorAll(' + JSON.stringify(sel) + ').length');
  const $click = (sel) => exec('document.querySelector(' + JSON.stringify(sel) + ').click()');
  const $type = (id, value) => exec('(() => { const e = document.getElementById(' + JSON.stringify(id) + '); e.focus(); e.value = ' + JSON.stringify(value) + '; e.dispatchEvent(new Event("input", {bubbles:true})); })()');
  const $change = (id) => exec('document.getElementById(' + JSON.stringify(id) + ').dispatchEvent(new Event("change", {bubbles:true}))');
  const $disabled = (id) => exec('document.getElementById(' + JSON.stringify(id) + ').disabled');
  const rect = (id) => exec('(() => { const r = document.getElementById(' + JSON.stringify(id) + ').getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right}; })()');
  const run = (line) => exec('window.__gh.runLine(' + JSON.stringify(line) + ')');
  const consoleText = () => exec('document.getElementById("console-out").innerText');
  const chips = (graphId) => exec('Array.from(document.querySelectorAll("#' + graphId + ' .chip")).map((c) => c.getAttribute("data-name"))');
  const nodes = (graphId) => $count('#' + graphId + ' .g-node');
  const strip = (id) => exec('document.getElementById(' + JSON.stringify(id) + ').innerText');
  const toastText = () => exec('document.getElementById("toast").textContent');
  const readData = () => {
    try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); } catch { return { projects: [], selected: {} }; } // sin archivo = nada guardado
  };
  const projects = () => readData().projects || [];
  const fwd = (p) => p.replace(/\\/g, '/');
  const dumpUi = () => exec(`(() => { const parts = [document.body.innerText, document.title];
    document.querySelectorAll('input,textarea').forEach((e) => parts.push(e.value, e.placeholder || '', e.title || ''));
    document.querySelectorAll('[title]').forEach((e) => parts.push(e.getAttribute('title')));
    return parts.join('\\n'); })()`);
  const dbg = async () => JSON.stringify(await exec('({label: document.getElementById("project-btn-label").innerText, url: document.getElementById("pi-url").innerText, path: document.getElementById("pi-path").innerText, strip: document.getElementById("remote-strip").innerText, g: document.getElementById("remote-graph").innerText.slice(0,120), rn: document.querySelectorAll("#remote-graph .g-node").length, ln: document.querySelectorAll("#local-graph .g-node").length, modal: !document.getElementById("modal").hidden, form: !document.getElementById("pform").hidden, toast: document.getElementById("toast").textContent})'));

  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.com', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main'].concat(args), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  /** Carpeta local con main, dev (fusionada) y develop (sin commits propios) + su «GitHub» (repositorio desnudo) enlazado como origin. */
  function makeRepo(name, extraCommits) {
    const dir = path.join(base, name);
    const work = path.join(dir, 'trabajo');
    fs.mkdirSync(work, { recursive: true });
    git(work, 'init', '-q', '-b', 'main');
    const put = (f, t, msg) => { fs.writeFileSync(path.join(work, f), t + '\n'); git(work, 'add', '.'); git(work, 'commit', '-qm', msg); };
    put('a.txt', 'a', 'Primer commit');
    git(work, 'switch', '-qc', 'dev');
    put('b.txt', 'b', 'Trabajo en dev');
    git(work, 'switch', '-q', 'main');
    put('c.txt', 'c', 'Cambio en main');
    git(work, 'merge', '-q', '--no-ff', 'dev', '-m', 'Fusion de dev');
    git(work, 'tag', 'v1');
    git(work, 'branch', 'develop'); // rama sin commits propios (apunta al mismo commit que main): también debe verse como una línea
    for (let i = 0; i < (extraCommits || 0); i++) put('x' + i + '.txt', 'x' + i, 'Extra ' + (i + 1));
    const bare = path.join(dir, 'github.git');
    git(dir, 'clone', '-q', '--bare', work, bare);
    git(work, 'remote', 'add', 'origin', fwd(bare));
    git(work, 'fetch', '-q', 'origin');
    git(work, 'branch', '-q', '-u', 'origin/main', 'main');
    return { dir, work, bare: fwd(bare) };
  }

  // ---------------------------------------------------------------- manejo de «Proyectos activos»
  const menuOpen = () => exec('!document.getElementById("project-menu").hidden');
  const openMenu = async () => { if (!(await menuOpen())) await $click('#project-btn'); };
  const label = () => $text('#project-btn-label');
  const rows = () => exec(`Array.from(document.querySelectorAll('#project-items .pm-item')).map((r) => ({ id: r.getAttribute('data-id'), name: r.querySelector('.pm-name').textContent, sub: r.querySelector('.pm-sub').textContent, sel: r.classList.contains('sel') }))`);
  const rowAct = (name, sel) => exec(`(() => { const r = Array.from(document.querySelectorAll('#project-items .pm-item')).find((x) => x.querySelector('.pm-name').textContent === ${JSON.stringify(name)}); r.querySelector(${JSON.stringify(sel)}).click(); })()`);
  const formOpen = () => exec('!document.getElementById("pform").hidden');
  const formError = () => $text('#pf-error');
  const fillForm = async (p) => {
    await $type('pf-name', p.name || '');
    await $type('pf-url', p.url || '');
    await $type('pf-local', p.local || '');
  };
  const newForm = async () => { await openMenu(); await $click('#btn-project-new'); };
  /** Agrega un proyecto como lo haría una persona: desplegable → «Agregar proyecto» → rellenar → Guardar. */
  const createProject = async (p) => { await newForm(); await fillForm(p); await $click('#pf-save'); };
  const pick = async (name) => { await openMenu(); await rowAct(name, '.pm-pick'); };
  const settled = (rn, ln) => waitFor(async () => (await nodes('remote-graph')) === rn && (await nodes('local-graph')) === ln, 20000);

  // ---------------------------------------------------------------- lectura de las líneas, flechas y marcas de los dibujos
  const railInfo = (graphId) => exec(`(() => {
    const g = document.querySelector('#${graphId} .g-rail'); if (!g) return null;
    const ext = g.querySelector('.g-rail-ext').getAttribute('d'); const x2 = parseFloat(ext.split('L')[1]);
    const xs = Array.from(document.querySelectorAll('#${graphId} .g-shape')).map((e) => parseFloat(e.getAttribute('cx') || e.getAttribute('points').split(',')[0]));
    const svg = document.querySelector('#${graphId} svg').getBoundingClientRect().width;
    const panel = document.getElementById('${graphId.replace('graph', 'scroll')}').clientWidth;
    return { x2, maxNode: Math.max.apply(null, xs), svg, panel, label: g.querySelector('.g-rail-label').textContent, title: g.querySelector('title').textContent };
  })()`);
  const railList = (graphId) => exec(`Array.from(document.querySelectorAll('#${graphId} .g-rail')).map((g) => {
    const ext = g.querySelector('.g-rail-ext'); const m = ext.getAttribute('d').match(/^M([\\d.]+) ([\\d.]+)/);
    const lab = g.querySelector('.g-rail-label');
    return { name: g.getAttribute('data-branch'), virtual: g.classList.contains('virtual'), y: parseFloat(m[2]), stroke: ext.getAttribute('stroke'), label: lab.textContent, labelFill: lab.style.fill };
  })`);
  const hereInfo = (graphId) => exec(`(() => { const g = document.querySelector('#${graphId} .g-here'); if (!g) return null;
    const pts = g.querySelector('.g-here-head').getAttribute('points').split(' ').map((p) => p.split(',').map(Number));
    const stem = g.querySelector('.g-here-stem');
    return { count: document.querySelectorAll('#${graphId} .g-here').length, color: g.style.getPropertyValue('--c').trim(), pointsUp: pts[1][1] < pts[0][1] && pts[1][1] < pts[2][1], stemBelowHead: parseFloat(stem.getAttribute('y')) > pts[1][1], label: g.querySelector('.g-here-label').textContent,
      labelBelow: parseFloat(g.querySelector('.g-here-label').getAttribute('y')) > parseFloat(stem.getAttribute('y')) + parseFloat(stem.getAttribute('height')) - 2 && g.querySelector('.g-here-label').getAttribute('text-anchor') === 'middle' }; })()`);
  const hoverPush = async (graphId) => {
    await exec(`document.querySelector('#${graphId} .g-push').dispatchEvent(new MouseEvent('mouseover', {bubbles:true, clientX: 400, clientY: 300}))`);
    return exec(`(() => { const t = document.getElementById('tip'); return { shown: !t.hidden, text: t.innerText }; })()`);
  };

  // ===================================================================================
  async function scenarioCompleto() {
    // ---------- 1. Arranque vacío (nada de datos personales, nada guardado) ----------
    await sleep(500);
    check('arranca sin carpeta local', getCwd() === null, getCwd());
    check('«Proyectos activos» arranca sin ningún proyecto elegido', (await label()) === '— elige un proyecto —', await label());
    check('no hay nada guardado', projects().length === 0 && getData().projects.length === 0, JSON.stringify(getData()));
    check('con cero proyectos las flechas ‹ › están desactivadas', (await $disabled('btn-project-prev')) && (await $disabled('btn-project-next')), '');
    check('y los botones de abrir web y abrir carpeta también', (await $disabled('btn-remote-web')) && (await $disabled('btn-folder')), '');
    check('la barra dice «Proyectos activos:»', (await $text('.pb-label')).includes('Proyectos activos:'), await $text('.pb-label'));
    check('la consola da la bienvenida', (await consoleText()).includes('Bienvenido a GitHelper'), '');
    check('el panel de GitHub explica qué hacer', (await $text('#remote-graph')).includes('Aquí se dibujan las ramas de tu repositorio de GitHub'), await $text('#remote-graph'));
    check('el panel local explica qué hacer', (await $text('#local-graph')).includes('Aquí se dibujan las ramas de tu repositorio local'), await $text('#local-graph'));
    const ui0 = await dumpUi();
    check('la interfaz de arranque no contiene datos personales de quien la ejecuta', !PERSONAL.test(ui0), (ui0.match(PERSONAL) || [''])[0]);
    check('no menciona ninguna cuenta de GitHub concreta (solo el ejemplo «usuario/repositorio»)', !/github\.com\/(?!usuario\/repositorio)[\w.-]+\/[\w.-]+/i.test(ui0), (ui0.match(/github\.com\/[\w.-]+\/[\w.-]+/i) || [''])[0]);
    await shot('01-vacio');

    // ---------- 2. El desplegable: agregar y borrar proyectos ----------
    check('el desplegable está cerrado al arrancar', !(await menuOpen()), '');
    await $click('#project-btn');
    check('al pulsar «Proyectos activos» se abre el desplegable', await menuOpen(), '');
    check('vacío, invita a agregar el primero', (await $text('#project-menu')).includes('Todavía no hay ningún proyecto') && (await $text('#btn-project-new')).includes('Agregar proyecto'), await $text('#project-menu'));
    await shot('01b-desplegable-vacio');
    await $click('#project-btn');
    check('y se cierra al volver a pulsar', !(await menuOpen()), '');

    // ---------- 3. La distribución pedida ----------
    const rr = await rect('remote-panel');
    const rl = await rect('local-panel');
    const rc = await rect('console-panel');
    const rk = await rect('cmds-panel');
    const rt = await rect('top');
    check('cabecera arriba, luego los dos visualizadores y debajo la consola', rt.b <= rr.y + 1 && rt.b <= rl.y + 1 && rr.b <= rc.y + 8 && rl.b <= rc.y + 8, JSON.stringify({ rt, rr, rl, rc }));
    check('el visualizador de GitHub está a la izquierda del local, a la misma altura', rr.r <= rl.x + 8 && Math.abs(rr.y - rl.y) < 2 && Math.abs(rr.h - rl.h) < 2, JSON.stringify({ rr, rl }));
    check('los dos visualizadores reparten el ancho a partes iguales', Math.abs(rr.w - rl.w) < 3 && rr.w > 400, JSON.stringify({ rr: rr.w, rl: rl.w }));
    check('la lista de órdenes está a la derecha de la consola', rk.x >= rc.r - 2 && Math.abs(rk.y - rc.y) < 3, JSON.stringify({ rk, rc }));
    check('los tres paneles son visibles', rr.h > 150 && rl.h > 150 && rc.h > 120, JSON.stringify({ rr: rr.h, rl: rl.h, rc: rc.h }));

    // ---------- 4. Formulario de proyecto: validaciones ----------
    const p1 = makeRepo('proyecto1');
    await newForm();
    check('«＋ Agregar proyecto» abre el formulario con nombre, GitHub y carpeta local', (await formOpen()) && !(await menuOpen()) && (await $text('#pf-title')) === 'Nuevo proyecto', await $text('#pf-title'));
    await shot('02-formulario');
    await $click('#pf-save');
    check('sin nombre avisa y no guarda', /nombre/i.test(await formError()) && projects().length === 0 && (await formOpen()), await formError());
    await fillForm({ name: 'Solo nombre' });
    await $click('#pf-save');
    check('con solo el nombre pide al menos GitHub o la carpeta', /al menos/i.test(await formError()) && projects().length === 0, await formError());
    await fillForm({ name: 'Mala URL', url: 'hola esto no es una url' });
    await $click('#pf-save');
    check('una dirección rara se rechaza', /no es válida/.test(await formError()) && projects().length === 0, await formError());
    await fillForm({ name: 'Opcion', url: '--upload-pack=calc' });
    await $click('#pf-save');
    check('una dirección que parece una opción de git se rechaza', /no es válida/.test(await formError()) && projects().length === 0, await formError());
    await fillForm({ name: 'Sin carpeta', local: path.join(base, 'no-existe-nunca') });
    await $click('#pf-save');
    check('una carpeta que no existe se rechaza', /no existe/.test(await formError()) && projects().length === 0, await formError());
    await $click('#pf-cancel');
    check('Cancelar cierra el formulario sin guardar nada', !(await formOpen()) && projects().length === 0, '');
    await newForm();
    await exec('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}))');
    check('Escape también lo cierra', !(await formOpen()), '');

    // ---------- 5. Crear el primer proyecto: sabe su GitHub y su carpeta local ----------
    await createProject({ name: 'Proyecto uno', url: p1.bare, local: p1.work });
    check('se guarda el proyecto y se cierra el formulario', await waitFor(async () => !(await formOpen()) && projects().length === 1), JSON.stringify(projects()) + await formError());
    const pr1 = projects()[0] || {};
    check('el archivo de datos guarda nombre, GitHub y carpeta local juntos', pr1.name === 'Proyecto uno' && pr1.url === p1.bare && path.resolve(pr1.local).toLowerCase() === path.resolve(p1.work).toLowerCase() && readData().selected.project === pr1.id, JSON.stringify(readData()));
    check('el proyecto queda elegido en el desplegable', (await label()) === 'Proyecto uno', await label());
    check('arriba se ve su GitHub y su carpeta', (await $text('#pi-url')).includes(p1.bare) && (await $text('#pi-path')).toLowerCase().includes('proyecto1'), await $text('#pi-url') + ' | ' + await $text('#pi-path'));
    check('se dibujan las ramas de GitHub y las locales, las dos', await settled(4, 4), 'nodos ' + await nodes('remote-graph') + '/' + await nodes('local-graph'));
    check('abrir carpeta queda activo (abrir web solo existe con direcciones de internet, no con las de prueba)', !(await $disabled('btn-folder')), '');
    check('el prompt de la consola muestra carpeta y rama', (await $text('#prompt')).includes('trabajo (main)'), await $text('#prompt'));
    check('la consola trabaja en la carpeta del proyecto', await (async () => { await run('pwd'); return (await consoleText()).toLowerCase().includes(p1.work.toLowerCase()); })(), '');
    check('la franja de GitHub resume ramas y commits', /3 ramas/.test(await strip('remote-strip')) && /4 commits/.test(await strip('remote-strip')), await strip('remote-strip'));
    check('el repositorio no se copia como carpeta de trabajo (solo hay copia desnuda en los datos del programa)', fs.readdirSync(cacheRoot()).length === 1, fs.readdirSync(cacheRoot()).join(','));
    const hr0 = await rect('remote-scroll');
    const hl0 = await rect('local-scroll');
    check('los dos dibujos empiezan a la misma altura (cabeceras alineadas)', Math.abs(hr0.y - hl0.y) < 2, JSON.stringify({ remoto: hr0.y, local: hl0.y }));
    await shot('03-proyecto-uno');

    // ---------- 6. Líneas, colores, nombres y flechas ----------
    const rch = await chips('remote-graph');
    check('el visualizador de GitHub muestra main, dev, develop y la etiqueta v1', ['main', 'dev', 'develop', 'v1'].every((n) => rch.includes(n)), JSON.stringify(rch));
    check('una fusión aparece como rombo', (await $count('#remote-graph polygon.g-shape')) === 1, await $count('#remote-graph polygon.g-shape'));
    const lch = await chips('local-graph');
    check('el visualizador local muestra además origin/main (la copia de GitHub que recuerda tu Git)', lch.includes('origin/main') && lch.includes('main'), JSON.stringify(lch));
    const ri = await railInfo('remote-graph');
    check('main se dibuja como una línea larga que sigue más allá de su último commit', ri && ri.label === 'main' && ri.x2 > ri.maxNode + 40, JSON.stringify(ri));
    check('y esa línea llega hasta el borde derecho del panel', ri && ri.svg >= ri.panel - 16, JSON.stringify(ri));
    const rails0 = await railList('remote-graph');
    const names0 = rails0.map((r) => r.name).sort();
    check('main y develop (abiertas) tienen su línea larga; dev, ya fusionada en main, no', JSON.stringify(names0) === JSON.stringify(['develop', 'main']), JSON.stringify(names0));
    check('dev sigue representada (etiqueta, sus commits y la fusión que la cierra), solo sin la línea al infinito', (await chips('remote-graph')).includes('dev') && (await $count('#remote-graph .g-edge')) >= 4, JSON.stringify(await chips('remote-graph')));
    check('«develop», que no tiene commits propios, también se ve como línea', rails0.some((r) => r.name === 'develop' && r.virtual), JSON.stringify(rails0));
    check('cada línea va en su carril y cada rama tiene un color distinto', new Set(rails0.map((r) => r.y)).size === rails0.length && new Set(rails0.map((r) => r.stroke)).size === rails0.length, JSON.stringify(rails0.map((r) => [r.name, r.y, r.stroke])));
    check('en cada línea sale su nombre, en el color de su rama, como en main', rails0.every((r) => r.label === r.name && r.labelFill), JSON.stringify(rails0.map((r) => [r.name, r.label, r.labelFill])));
    const chipDevelop = await exec(`(() => { const c = document.querySelector('#remote-graph .chip[data-name=develop]'); return c ? c.getAttribute('style') : null; })()`);
    const devRail = rails0.find((r) => r.name === 'develop');
    check('la etiqueta «develop» (sobre un commit de main) lleva el color de la línea de develop', !!chipDevelop && !!devRail && chipDevelop.includes(devRail.stroke), JSON.stringify({ chipDevelop, stroke: devRail && devRail.stroke }));
    const mainRail = rails0.find((r) => r.name === 'main');
    const hereL0 = await waitFor(async () => !!(await hereInfo('local-graph'))) && await hereInfo('local-graph');
    check('estás en main: una flecha de abajo hacia arriba señala el punto actual, con el color de main y «Posición actual» debajo', hereL0 && hereL0.count === 1 && hereL0.pointsUp && hereL0.stemBelowHead && hereL0.labelBelow && hereL0.label === 'Posición actual' && hereL0.color === mainRail.stroke, JSON.stringify(hereL0));
    const hereR0 = await waitFor(async () => !!(await hereInfo('remote-graph'))) && await hereInfo('remote-graph');
    check('el dibujo de GitHub señala el mismo punto (tu commit ya está allí)', hereR0 && hereR0.count === 1 && hereR0.pointsUp && hereR0.label === 'Posición actual' && hereR0.color === mainRail.stroke, JSON.stringify(hereR0));

    // ---------- 7. Consola: trabajar en el proyecto y subir ----------
    await run('git switch -c prueba');
    await run('echo "hola desde GitHelper" > hola.txt');
    await run('git add .');
    await run('git commit -m "Commit desde la consola"');
    check('el commit hecho en la consola aparece en el dibujo local', await waitFor(async () => (await nodes('local-graph')) === 5), 'nodos: ' + await nodes('local-graph'));
    check('la rama nueva «prueba» aparece como etiqueta local', (await chips('local-graph')).includes('prueba'), JSON.stringify(await chips('local-graph')));
    check('GitHub todavía no tiene esa rama', (await nodes('remote-graph')) === 4 && !(await chips('remote-graph')).includes('prueba'), '');
    check('la franja local avisa de que la rama no está subida', (await strip('local-strip')).includes('rama sin subir'), await strip('local-strip'));
    check('antes de subirla, GitHub no tiene tu rama: no hay flecha allí y la franja lo avisa', await waitFor(async () => (await strip('remote-strip')).includes('«prueba» aún no está en GitHub')) && (await $count('#remote-graph .g-here')) === 0, await strip('remote-strip'));
    check('antes de hacer push no hay ninguna marca de push (los fetch no cuentan)', (await $count('#local-graph .g-push')) === 0 && (await $count('#remote-graph .g-push')) === 0, 'local ' + await $count('#local-graph .g-push') + ' / GitHub ' + await $count('#remote-graph .g-push'));
    await shot('04-commit-local');
    await run('git push -u origin prueba');
    check('tras subir, el dibujo de GitHub se actualiza solo con la rama nueva', await waitFor(async () => (await nodes('remote-graph')) === 5 && (await chips('remote-graph')).includes('prueba'), 20000), JSON.stringify(await chips('remote-graph')) + ' nodos: ' + await nodes('remote-graph'));
    check('y la copia local recuerda origin/prueba', await waitFor(async () => (await chips('local-graph')).includes('origin/prueba')), JSON.stringify(await chips('local-graph')));
    check('de verdad llegó al «GitHub» de la prueba', git(p1.work, '-C', p1.bare, 'log', '-1', '--format=%s', 'prueba').trim() === 'Commit desde la consola', '');
    check('tras subir, la franja de GitHub ya no avisa', await waitFor(async () => !(await strip('remote-strip')).includes('aún no está en GitHub')), await strip('remote-strip'));
    check('tras subir hay una marca de push en cada dibujo (el de GitHub la toma de la carpeta local del proyecto)', await waitFor(async () => (await $count('#local-graph .g-push')) === 1 && (await $count('#remote-graph .g-push')) === 1), 'local ' + await $count('#local-graph .g-push') + ' / GitHub ' + await $count('#remote-graph .g-push'));
    const tipL = await hoverPush('local-graph');
    check('al poner el puntero sobre la marca se explica el push: rama, fecha y commits subidos', tipL.shown && /Push a origin\/prueba/.test(tipL.text) && /\d{2}-\d{2}-\d{4} \d{2}:\d{2}/.test(tipL.text) && /Commit desde la consola/.test(tipL.text) && /1 commit/.test(tipL.text) && /Rama nueva en GitHub: 1 commit propio/.test(tipL.text), JSON.stringify(tipL));
    await shot('05-push-tooltip');
    await exec(`document.querySelector('#local-graph .g-push').dispatchEvent(new MouseEvent('mouseout', {bubbles:true}))`);
    check('al quitar el puntero, la ventana desaparece', (await exec('document.getElementById("tip").hidden')) === true, '');
    const tipR = await hoverPush('remote-graph');
    check('lo mismo en el dibujo de GitHub', tipR.shown && /Commit desde la consola/.test(tipR.text), JSON.stringify(tipR));
    await exec(`document.querySelector('#remote-graph .g-push').dispatchEvent(new MouseEvent('mouseout', {bubbles:true}))`);
    const prRail = (await railList('local-graph')).find((r) => r.name === 'prueba');
    const hereL = await waitFor(async () => (await hereInfo('local-graph')) && (await railList('local-graph')).some((r) => r.name === 'prueba')) && await hereInfo('local-graph');
    check('ahora estás en «prueba»: UNA flecha de abajo hacia arriba en el color de esa rama, con «Posición actual» debajo', hereL && prRail && hereL.count === 1 && hereL.pointsUp && hereL.labelBelow && hereL.label === 'Posición actual' && hereL.color === prRail.stroke, JSON.stringify({ hereL, prRail }));
    const hereR = await waitFor(async () => { const h = await hereInfo('remote-graph'); return h && h.color === prRail.stroke; }) && await hereInfo('remote-graph');
    check('el dibujo de GitHub también señala dónde estás, con el color de tu rama', hereR && hereR.count === 1 && hereR.pointsUp && hereR.label === 'Posición actual' && hereR.color === prRail.stroke, JSON.stringify(hereR));
    check('la línea de la rama en la que estás se dibuja más gruesa', (await $count('#local-graph .g-rail.here')) === 1 && (await exec(`document.querySelector('#local-graph .g-rail.here').getAttribute('data-branch')`)) === 'prueba', '');
    const namesAfter = (await railList('remote-graph')).map((r) => r.name).sort();
    check('la rama nueva «prueba» (sin fusionar) abre su línea larga y dev, fusionada, sigue sin ella', JSON.stringify(namesAfter) === JSON.stringify(['develop', 'main', 'prueba']), JSON.stringify(namesAfter));
    const rp = await railInfo('remote-graph');
    check('con una rama más avanzada que main, la línea de main sigue en paralelo y lo explica', rp && rp.x2 > rp.maxNode && rp.title.includes('otras ramas han seguido avanzando'), JSON.stringify(rp));
    await shot('06-subido');

    // ---------- 8. Consola con teclado real, errores y ayudantes ----------
    await exec('(() => { const i = document.getElementById("console-in"); i.focus(); i.value = "git stat"; i.dispatchEvent(new KeyboardEvent("keydown", {key:"Tab", bubbles:true, cancelable:true})); })()');
    check('Tab completa el subcomando de git', (await $val('console-in')) === 'git status ', JSON.stringify(await $val('console-in')));
    await exec('(() => { const i = document.getElementById("console-in"); i.value = "git status -s"; i.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", bubbles:true, cancelable:true})); })()');
    check('Enter ejecuta lo escrito y vacía la línea', await waitFor(async () => (await consoleText()).includes('git status -s')) && (await $val('console-in')) === '', await $val('console-in'));
    await run('cualquiercosa');
    check('un comando desconocido se explica', (await consoleText()).includes('No conozco el comando'), '');
    await run('git rebase -i HEAD~2');
    check('un comando interactivo se explica en vez de colgarse', (await consoleText()).includes('Terminal externa'), '');
    await run('rm -r .');
    check('no se puede borrar la carpeta entera', fs.existsSync(path.join(p1.work, '.git')), '');
    await run('git switch main && git log --oneline -n 2');
    check('&& encadena: cambia de rama y luego muestra el historial', await waitFor(async () => (await $text('#prompt')).includes('(main)')), await $text('#prompt'));
    check('al cambiar de rama, la flecha se mueve a main', await waitFor(async () => { const h = await hereInfo('local-graph'); return h && h.color === mainRail.stroke; }), JSON.stringify(await hereInfo('local-graph')));
    await run('git switch prueba');
    await waitFor(async () => (await $text('#prompt')).includes('(prueba)'));

    // ---------- 9. Lista desplegable de órdenes ----------
    check('la lista trae todas las órdenes agrupadas en secciones', (await $count('#cmds-list details.sec')) >= 15 && /\d{3} órdenes/.test(await $text('#cmds-count')), await $text('#cmds-count'));
    await $type('cmd-search', 'stash pop');
    check('el buscador deja solo la orden pedida', (await $count('#cmds-list .crow')) >= 1 && (await $text('#cmds-list')).includes('git stash pop'), await $text('#cmds-list'));
    await $click('#cmds-list .crow');
    check('pulsar una orden la copia en la consola', (await $val('console-in')) === 'git stash pop', await $val('console-in'));
    await $type('cmd-search', 'git merge <rama>');
    await $click('#cmds-list .crow');
    const sel = await exec('(() => { const i = document.getElementById("console-in"); return i.value.slice(i.selectionStart, i.selectionEnd); })()');
    check('si la orden tiene un <hueco>, queda seleccionado para escribir encima', sel === '<rama>', JSON.stringify(sel));
    await $type('cmd-search', 'gh pr create');
    check('también están las órdenes de GitHub CLI con su explicación', (await $text('#cmds-list')).includes('Pull Request'), await $text('#cmds-list'));
    await $type('cmd-search', '');
    await exec('document.getElementById("console-in").value = ""');
    await exec('document.querySelector("#local-graph .chip[data-name=dev]").dispatchEvent(new MouseEvent("click", {bubbles:true}))');
    check('pulsar la etiqueta de una rama pega «git switch rama»', (await $val('console-in')) === 'git switch dev', await $val('console-in'));
    await exec('document.querySelector("#remote-graph .g-node").dispatchEvent(new MouseEvent("click", {bubbles:true}))');
    check('pulsar un commit pega «git show»', /^git show [0-9a-f]{7}$/.test(await $val('console-in')), await $val('console-in'));
    await exec('document.getElementById("console-in").value = ""');

    // ---------- 10. Segundo proyecto: la carpeta propone el nombre y el GitHub ----------
    const p2 = makeRepo('proyecto2', 3);
    await newForm();
    await $type('pf-local', p2.work);
    await $change('pf-local');
    check('al elegir la carpeta, el formulario propone el nombre (el de la carpeta) y el GitHub (su origin)', await waitFor(async () => (await $val('pf-name')) === 'trabajo' && (await $val('pf-url')) === p2.bare), (await $val('pf-name')) + ' | ' + (await $val('pf-url')));
    check('y dice de dónde sacó la dirección', (await $text('#pf-note')).includes('origin'), await $text('#pf-note'));
    await shot('07-formulario-propuesto');
    await $type('pf-name', 'Proyecto uno'.toUpperCase());
    await $click('#pf-save');
    check('un nombre repetido (aunque cambien las mayúsculas) se rechaza', /Ya hay un proyecto con ese nombre/.test(await formError()) && projects().length === 1, await formError());
    await $type('pf-name', 'Proyecto dos');
    await $click('#pf-save');
    check('se guarda el segundo proyecto y se abre', await waitFor(async () => projects().length === 2 && (await label()) === 'Proyecto dos'), await dbg());
    check('se dibujan sus ramas (7 commits en GitHub y 7 en local)', await settled(7, 7), 'nodos ' + await nodes('remote-graph') + '/' + await nodes('local-graph'));
    check('ahora hay 2 proyectos y el contador lo dice', (await $text('#project-count')).includes('2 proyectos'), await $text('#project-count'));
    const rws = await rows();
    check('el desplegable lista los dos con su GitHub y su carpeta, y marca el activo', rws.length === 2 && rws[0].name === 'Proyecto uno' && rws[1].name === 'Proyecto dos' && rws[1].sel && !rws[0].sel && /☁/.test(rws[0].sub) && /📁/.test(rws[0].sub), JSON.stringify(rws));
    await openMenu();
    await shot('08-desplegable-dos');

    // ---------- 11. Cambiar de proyecto: se abren juntos su GitHub y su carpeta local ----------
    await pick('Proyecto uno');
    check('elegir «Proyecto uno» abre su GitHub y su carpeta local a la vez', await settled(5, 5) && (await label()) === 'Proyecto uno' && !(await menuOpen()), await dbg());
    await run('pwd');
    check('y la consola pasa a trabajar en la carpeta de ese proyecto', (await consoleText()).toLowerCase().split(p1.work.toLowerCase()).length >= 3, '');
    await $click('#btn-project-next');
    check('la flecha › pasa al siguiente proyecto', await waitFor(async () => (await label()) === 'Proyecto dos') && await settled(7, 7), await dbg());
    await $click('#btn-project-prev');
    check('la flecha ‹ vuelve al anterior', await waitFor(async () => (await label()) === 'Proyecto uno') && await settled(5, 5), await dbg());
    check('al volver, la flecha de «Posición actual» sigue en la rama prueba', await waitFor(async () => { const h = await hereInfo('local-graph'); return h && h.color === prRail.stroke; }), JSON.stringify(await hereInfo('local-graph')));
    await shot('09-cambiar-proyecto');

    // ---------- 12. Editar un proyecto ----------
    await openMenu();
    await rowAct('Proyecto uno', '.pm-edit');
    check('✎ abre el formulario con los datos del proyecto', (await formOpen()) && (await $text('#pf-title')) === 'Editar proyecto' && (await $val('pf-name')) === 'Proyecto uno' && (await $val('pf-url')) === p1.bare && (await $val('pf-local')).toLowerCase().includes('proyecto1'), (await $val('pf-name')) + ' | ' + (await $val('pf-url')));
    await $type('pf-name', 'Proyecto 1');
    await $click('#pf-save');
    check('al guardar los cambios, el nombre se actualiza en todas partes', await waitFor(async () => (await label()) === 'Proyecto 1' && projects().some((p) => p.name === 'Proyecto 1') && !projects().some((p) => p.name === 'Proyecto uno')), await dbg());
    check('y no se crea un proyecto nuevo ni se pierden sus ramas', projects().length === 2 && await settled(5, 5), 'proyectos ' + projects().length);
    await openMenu();
    await rowAct('Proyecto dos', '.pm-edit');
    await $type('pf-url', '');
    const cachesAntes = fs.readdirSync(cacheRoot()).length;
    await $click('#pf-save');
    check('quitar el GitHub de un proyecto deja su panel explicando qué hacer', await waitFor(async () => (await $text('#remote-graph')).includes('todavía no tiene dirección de GitHub')), await dbg());
    check('y su copia descargada de GitHub se borra (el «GitHub» de verdad no se toca)', await waitFor(async () => fs.readdirSync(cacheRoot()).length === cachesAntes - 1) && fs.existsSync(p2.bare), fs.readdirSync(cacheRoot()).join(','));
    check('la carpeta local de ese proyecto sigue dibujada y se avisa de lo que falta', await waitFor(async () => (await nodes('local-graph')) === 7 && (await $text('#pi-url')).includes('sin dirección de GitHub')), await dbg());
    await openMenu();
    await rowAct('Proyecto dos', '.pm-edit');
    await $type('pf-url', p2.bare);
    await $click('#pf-save');
    check('al volver a ponerle el GitHub, se dibuja otra vez', await settled(7, 7), await dbg());

    // ---------- 13. Proyectos incompletos y errores ----------
    await createProject({ name: 'Roto', url: fwd(path.join(base, 'no-existe.git')) });
    check('un GitHub que no se puede leer explica el motivo', await waitFor(async () => (await $text('#remote-graph')).includes('No he podido leer ese repositorio')), await dbg());
    check('y un proyecto sin carpeta local lo dice en su panel local', (await $text('#local-graph')).includes('todavía no tiene carpeta local') && (await $text('#pi-path')).includes('sin carpeta local'), await $text('#local-graph'));
    await run('git status');
    check('la consola avisa de que ese proyecto no tiene carpeta local', (await consoleText()).includes('no tiene carpeta local'), '');
    check('abrir carpeta está desactivado: no hay carpeta', await $disabled('btn-folder'), '');
    await shot('10-github-roto');
    await openMenu();
    await rowAct('Roto', '.pm-del');
    check('🗑 pide confirmación y dice que no se borra nada de GitHub ni del ordenador', (await exec('!document.getElementById("modal").hidden')) && (await $text('#modal-body')).includes('No se borra nada en GitHub ni en tu ordenador'), await $text('#modal-body'));
    await $click('#modal-ok');
    check('confirmar quita «Roto»', await waitFor(async () => projects().length === 2 && !projects().some((p) => p.name === 'Roto')), JSON.stringify(projects().map((p) => p.name)));

    await createProject({ name: 'Solo carpeta', local: p2.work });
    check('un proyecto solo con carpeta dibuja la local y explica que falta el GitHub', await waitFor(async () => (await nodes('local-graph')) === 7 && (await $text('#remote-graph')).includes('todavía no tiene dirección de GitHub')), await dbg());
    await openMenu();
    await rowAct('Solo carpeta', '.pm-del');
    await $click('#modal-ok');
    check('y se borra sin tocar la carpeta del disco', await waitFor(async () => projects().length === 2) && fs.existsSync(path.join(p2.work, '.git')), '');

    // una carpeta que desaparece del disco
    const efimera = path.join(base, 'efimera');
    fs.mkdirSync(efimera, { recursive: true });
    await createProject({ name: 'Efimera', local: efimera });
    check('un proyecto cuya carpeta aún no es un repositorio lo explica', await waitFor(async () => (await $text('#local-graph')).includes('todavía no es un repositorio de Git')), await dbg());
    await pick('Proyecto 1');
    await settled(5, 5);
    fs.rmSync(efimera, { recursive: true, force: true });
    await pick('Efimera');
    check('si su carpeta ya no existe, se dice y no se rompe nada', await waitFor(async () => (await $text('#local-graph')).includes('La carpeta de este proyecto ya no existe') && (await $text('#pi-path')).includes('la carpeta ya no existe')), await dbg());
    await shot('11-carpeta-desaparecida');
    await openMenu();
    await rowAct('Efimera', '.pm-del');
    await $click('#modal-ok');
    check('y se puede borrar igualmente', await waitFor(async () => projects().length === 2), JSON.stringify(projects().map((p) => p.name)));
    await pick('Proyecto 1');
    await settled(5, 5);

    // ---------- 14. Borrar un proyecto (con confirmación) ----------
    const dir1 = fs.readdirSync(cacheRoot()).length;
    await openMenu();
    await rowAct('Proyecto dos', '.pm-del');
    check('🗑 pide confirmación', (await exec('!document.getElementById("modal").hidden')) && (await $text('#modal-body')).includes('Proyecto dos'), await $text('#modal-body'));
    await shot('12-confirmar-borrado');
    await $click('#modal-cancel');
    check('cancelar no borra nada', projects().length === 2, JSON.stringify(projects().map((p) => p.name)));
    await openMenu();
    await rowAct('Proyecto dos', '.pm-del');
    await $click('#modal-ok');
    check('confirmar quita el proyecto de la lista y del archivo', await waitFor(async () => projects().length === 1 && projects()[0].name === 'Proyecto 1'), JSON.stringify(projects().map((p) => p.name)));
    check('y borra su copia descargada de GitHub (el «GitHub» de verdad y las carpetas no se tocan)', await waitFor(async () => fs.readdirSync(cacheRoot()).length === dir1 - 1) && fs.existsSync(p2.bare) && fs.existsSync(path.join(p2.work, '.git')) && fs.existsSync(p1.bare), fs.readdirSync(cacheRoot()).join(','));
    check('el proyecto activo (Proyecto 1) sigue abierto con sus dos dibujos', (await label()) === 'Proyecto 1' && await settled(5, 5), await dbg());
    check('con un solo proyecto las flechas ‹ › se desactivan', (await $disabled('btn-project-prev')) && (await $disabled('btn-project-next')), '');

    // ---------- 14b. Fusionar una rama con su rama madre: desaparece su línea al infinito ----------
    const names = async (graphId) => (await railList(graphId)).map((r) => r.name).sort();
    await run('git switch main && git merge prueba');
    check('al fusionar «prueba» en main (fast-forward: Git no deja commit de fusión), el dibujo local le quita la línea al infinito', await waitFor(async () => JSON.stringify(await names('local-graph')) === JSON.stringify(['develop', 'main'])), JSON.stringify(await names('local-graph')));
    check('su etiqueta sigue sobre el commit donde quedó y el dibujo no pierde commits', (await chips('local-graph')).includes('prueba') && (await nodes('local-graph')) === 5, JSON.stringify(await chips('local-graph')));
    check('develop (recién creada, sin trabajo propio) sigue abierta', (await names('local-graph')).includes('develop'), '');
    check('en GitHub todavía no: la fusión aún no está subida y esa línea sigue abierta', (await names('remote-graph')).includes('prueba'), JSON.stringify(await names('remote-graph')));
    await run('git push');
    check('al subir la fusión, GitHub también le quita la línea al infinito a «prueba»', await waitFor(async () => JSON.stringify(await names('remote-graph')) === JSON.stringify(['develop', 'main']), 20000), JSON.stringify(await names('remote-graph')));
    check('y la flecha de «Posición actual» sigue en su sitio, ahora en el color de main', await waitFor(async () => { const h = await hereInfo('local-graph'); return h && h.count === 1 && h.color === mainRail.stroke; }), JSON.stringify(await hereInfo('local-graph')));
    await shot('12b-rama-fusionada');

    // ---------- 14c. GitHub por sí solo: una rama fusionada en GitHub pierde su línea sin necesitar ninguna carpeta local ----------
    const sg = makeRepo('solo-github');
    git(sg.work, 'switch', '-qc', 'feat');
    fs.writeFileSync(path.join(sg.work, 'f.txt'), 'f\n');
    git(sg.work, 'add', '.');
    git(sg.work, 'commit', '-qm', 'Trabajo en feat');
    git(sg.work, 'push', '-q', 'origin', 'feat');
    git(sg.work, 'switch', '-q', 'main');
    await createProject({ name: 'Solo GitHub', url: sg.bare });
    check('un proyecto solo con GitHub dibuja su repositorio, sin carpeta local', await waitFor(async () => (await nodes('remote-graph')) === 5 && getCwd() === null), await dbg());
    check('«feat» (con trabajo, sin fusionar) y «develop» (recién creada) están abiertas; dev, fusionada con commit, no', await waitFor(async () => JSON.stringify(await names('remote-graph')) === JSON.stringify(['develop', 'feat', 'main'])), JSON.stringify(await names('remote-graph')));
    // en GitHub se fusiona «feat» en main (fast-forward) y se actualiza
    git(sg.work, 'merge', '-q', 'feat');
    git(sg.work, 'push', '-q', 'origin', 'main');
    await $click('#btn-remote-refresh');
    check('al fusionar «feat» en GitHub, su línea al infinito desaparece aunque no haya ninguna carpeta local', await waitFor(async () => JSON.stringify(await names('remote-graph')) === JSON.stringify(['develop', 'main']), 20000), JSON.stringify(await names('remote-graph')) + ' | ' + await dbg());
    check('su etiqueta sigue sobre el commit donde quedó y «develop», sin trabajo propio, sigue abierta', (await chips('remote-graph')).includes('feat') && (await names('remote-graph')).includes('develop') && (await nodes('remote-graph')) === 5, JSON.stringify(await chips('remote-graph')));
    await shot('12c-github-fusionada');
    await openMenu();
    await rowAct('Solo GitHub', '.pm-del');
    await $click('#modal-ok');
    check('y el proyecto de prueba se quita sin tocar nada', await waitFor(async () => projects().length === 1 && !projects().some((p) => p.name === 'Solo GitHub')) && fs.existsSync(sg.bare), JSON.stringify(projects().map((p) => p.name)));
    await settled(5, 5);

    // ---------- 15. Tamaño de los paneles ----------
    const before = await rect('remote-panel');
    const beforeLocal = await rect('local-panel');
    await exec(`(() => { const h = document.getElementById('split-1'); const r = h.getBoundingClientRect();
      h.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX: r.x+2, clientY: r.y+20}));
      document.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, clientX: r.x+2+120, clientY: r.y+20}));
      document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); })()`);
    await sleep(200);
    const after = await rect('remote-panel');
    const afterLocal = await rect('local-panel');
    check('arrastrar el separador de en medio cambia el ancho de cada visualizador', after.w > before.w + 80 && afterLocal.w < beforeLocal.w - 80, JSON.stringify({ before: before.w, after: after.w, local: afterLocal.w }));
    let rw = null;
    let rwl = null;
    const fits = await waitFor(async () => {
      rw = await railInfo('remote-graph');
      rwl = await railInfo('local-graph');
      return rw && rwl && rw.svg >= rw.panel - 16 && rwl.svg >= rwl.panel - 16;
    }, 5000);
    check('al cambiar el ancho de los paneles, la línea de main se reajusta hasta el borde de cada uno', fits, JSON.stringify({ remoto: rw && [rw.svg, rw.panel], local: rwl && [rwl.svg, rwl.panel] }));
    await exec(`(() => { const h = document.getElementById('split-2'); const r = h.getBoundingClientRect();
      h.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX: r.x+20, clientY: r.y+2}));
      document.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, clientX: r.x+20, clientY: r.y+2-50}));
      document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); })()`);
    await sleep(200);
    check('arrastrar el separador de abajo cambia el alto de los visualizadores', (await rect('graphs')).h < before.h - 30, JSON.stringify({ antes: before.h, ahora: (await rect('graphs')).h }));

    // ---------- 15b. Zoom de cada dibujo: − y + en cada uno ----------
    const zinfo = (graphId, side) => exec(`(() => { const svg = document.querySelector('#${graphId} svg'); const vb = svg.viewBox.baseVal;
      return { label: document.getElementById('zoom-${side}-val').textContent, w: parseFloat(svg.getAttribute('width')), h: parseFloat(svg.getAttribute('height')), vw: vb.width, vh: vb.height,
        out: document.getElementById('zoom-${side}-out').disabled, inn: document.getElementById('zoom-${side}-in').disabled, panel: document.getElementById('${graphId.replace('graph', 'scroll')}').clientWidth }; })()`);
    const zoomOf = async () => ({ r: await zinfo('remote-graph', 'remote'), l: await zinfo('local-graph', 'local') });
    const ratio = (z) => z.h / z.vh;
    let zz = await zoomOf();
    check('cada dibujo tiene sus botones − y + y arranca al 100 %', zz.r.label === '100 %' && zz.l.label === '100 %' && Math.abs(ratio(zz.r) - 1) < 0.01 && Math.abs(ratio(zz.l) - 1) < 0.01, JSON.stringify(zz));
    await $click('#zoom-remote-in');
    zz = await zoomOf();
    check('+ en el dibujo de GitHub lo agranda (125 %) sin tocar el de tu ordenador', zz.r.label === '125 %' && Math.abs(ratio(zz.r) - 1.25) < 0.01 && zz.l.label === '100 %' && Math.abs(ratio(zz.l) - 1) < 0.01, JSON.stringify(zz));
    await $click('#zoom-local-out');
    await $click('#zoom-local-out');
    zz = await zoomOf();
    check('− en el dibujo de tu ordenador lo reduce (65 %) sin tocar el de GitHub', zz.l.label === '65 %' && Math.abs(ratio(zz.l) - 0.65) < 0.01 && zz.r.label === '125 %' && Math.abs(ratio(zz.r) - 1.25) < 0.01, JSON.stringify(zz));
    check('con zoom, la línea de main sigue llegando hasta el borde derecho de cada panel', zz.r.w >= zz.r.panel - 16 && zz.l.w >= zz.l.panel - 16, JSON.stringify({ r: [zz.r.w, zz.r.panel], l: [zz.l.w, zz.l.panel] }));
    await exec(`document.getElementById('remote-scroll').dispatchEvent(new WheelEvent('wheel', {deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true}))`);
    zz = await zoomOf();
    check('Ctrl + rueda del ratón sobre un dibujo también hace zoom en ese dibujo (150 %)', zz.r.label === '150 %' && zz.l.label === '65 %', JSON.stringify(zz));
    await sleep(120);
    await exec(`document.getElementById('remote-scroll').dispatchEvent(new WheelEvent('wheel', {deltaY: 100, bubbles: true, cancelable: true}))`);
    check('la rueda sin Ctrl no cambia el zoom (sirve para desplazarse)', (await zoomOf()).r.label === '150 %', JSON.stringify(await zoomOf()));
    for (let i = 0; i < 8; i++) await $click('#zoom-local-out');
    zz = await zoomOf();
    check('al llegar al mínimo (40 %) el botón − se desactiva', zz.l.label === '40 %' && zz.l.out === true && zz.l.inn === false, JSON.stringify(zz.l));
    await $click('#zoom-local-val');
    zz = await zoomOf();
    check('pulsar el porcentaje vuelve al 100 %', zz.l.label === '100 %' && Math.abs(ratio(zz.l) - 1) < 0.01, JSON.stringify(zz.l));
    await $click('#zoom-local-out');
    await $click('#zoom-local-out');
    await shot('15b-zoom');

    // lo que debe encontrar el escenario «reabrir»: queda un proyecto (Proyecto 1) y se agrega otro para la prueba sin conexión
    await createProject({ name: 'Proyecto dos', url: p2.bare, local: p2.work });
    await settled(7, 7);
    fs.writeFileSync(stateFile, JSON.stringify({ p1, p2 }));
    await shot('13-final');
  }

  async function scenarioReabrir() {
    const { p1, p2 } = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    await sleep(600);
    const d = getData();
    check('al reabrir, los proyectos guardados siguen ahí', d.projects.length === 2 && d.projects.map((p) => p.name).sort().join() === 'Proyecto 1,Proyecto dos', JSON.stringify(d));
    check('y el proyecto que estaba abierto vuelve a abrirse con su GitHub y su carpeta local', await waitFor(async () => (await $text('#project-btn-label')) === 'Proyecto dos' && (await $text('#pi-url')).includes(p2.bare)), await dbg());
    check('se vuelven a dibujar los dos visualizadores', await settled(7, 7), 'nodos ' + await nodes('remote-graph') + '/' + await nodes('local-graph'));
    check('la consola trabaja en la carpeta de ese proyecto', await (async () => { await run('pwd'); return (await consoleText()).toLowerCase().includes(p2.work.toLowerCase()); })(), '');
    check('el desplegable lista los proyectos guardados', (await rows()).length === 2, JSON.stringify(await rows()));
    check('el programa recuerda el tamaño de los paneles', (await rect('remote-panel')).h > 150, '');
    check('y el zoom de cada dibujo (GitHub al 150 %, tu ordenador al 65 %)', (await $text('#zoom-remote-val')) === '150 %' && (await $text('#zoom-local-val')) === '65 %' && await exec(`(() => { const a = document.querySelector('#remote-graph svg'); const b = document.querySelector('#local-graph svg'); return Math.abs(parseFloat(a.getAttribute('height')) / a.viewBox.baseVal.height - 1.5) < 0.01 && Math.abs(parseFloat(b.getAttribute('height')) / b.viewBox.baseVal.height - 0.65) < 0.01; })()`), (await $text('#zoom-remote-val')) + ' | ' + (await $text('#zoom-local-val')));
    await shot('14-reabierto');
    await pick('Proyecto 1');
    check('cambiar al otro proyecto sigue funcionando tras reabrir', await settled(5, 5), await dbg());
    await pick('Proyecto dos');
    await settled(7, 7);

    // Se pierde la conexión con «GitHub»: se enseñan los datos guardados avisando
    const gone = p2.bare + '.movido';
    fs.renameSync(p2.bare, gone);
    await $click('#btn-remote-refresh');
    check('sin conexión con GitHub se enseña lo último que se leyó y se avisa', await waitFor(async () => (await strip('remote-strip')).includes('sin conexión')) && (await nodes('remote-graph')) === 7, await strip('remote-strip'));
    await shot('15-sin-conexion');
    fs.renameSync(gone, p2.bare);
    await $click('#btn-remote-refresh');
    check('al volver la conexión se actualiza', await waitFor(async () => !(await strip('remote-strip')).includes('sin conexión')), await strip('remote-strip'));

    // Borrar todos los proyectos deja todo vacío
    for (const name of ['Proyecto dos', 'Proyecto 1']) {
      await openMenu();
      await rowAct(name, '.pm-del');
      await $click('#modal-ok');
      await sleep(700);
    }
    check('al borrar el último proyecto, todo queda vacío', await waitFor(async () => projects().length === 0 && (await label()) === '— elige un proyecto —' && (await $text('#pi-url')) === '—'), await dbg());
    check('y los paneles vuelven a explicar qué hacer', await waitFor(async () => (await $text('#remote-graph')).includes('Aquí se dibujan') && (await $text('#local-graph')).includes('Aquí se dibujan')), '');
    check('la consola ya no tiene carpeta donde trabajar', await (async () => { await run('git status'); return (await consoleText()).includes('no tiene carpeta local'); })(), '');
    check('no quedan copias de GitHub en los datos del programa', await waitFor(async () => fs.readdirSync(cacheRoot()).length === 0), fs.readdirSync(cacheRoot()).join(','));
    check('las carpetas y repositorios de la prueba siguen intactos', fs.existsSync(path.join(p1.work, '.git')) && fs.existsSync(path.join(p2.work, '.git')) && fs.existsSync(p1.bare) && fs.existsSync(p2.bare), '');
    await shot('16-vacio-otra-vez');
  }

  /** Arranque con datos de la versión 1 (listas sueltas de repositorios y carpetas): se convierten solos en proyectos. */
  async function scenarioMigracion() {
    await sleep(800);
    const d = getData();
    check('los datos de la versión 1 se convierten en un proyecto (la carpeta se une a su GitHub por el origin)', d.version === 2 && d.projects.length === 1 && d.projects[0].url && d.projects[0].local, JSON.stringify(d));
    check('el archivo de datos queda guardado ya como versión 2, sin las listas antiguas', readData().version === 2 && Array.isArray(readData().projects) && !readData().repos && !readData().locals, JSON.stringify(readData()));
    check('antes de migrar se guarda una copia de los datos antiguos', await (async () => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(dataFile()), 'datos-version1-copia.json'), 'utf8')).version === 1; } catch { return false; } })(), '');
    check('el proyecto lleva el nombre del repositorio y se abre solo', await waitFor(async () => (await label()) === d.projects[0].name), await dbg());
    check('se dibujan sus dos visualizadores', await settled(1, 1), 'nodos ' + await nodes('remote-graph') + '/' + await nodes('local-graph'));
    check('la consola trabaja en su carpeta', await (async () => { await run('pwd'); return (await consoleText()).toLowerCase().includes(d.projects[0].local.toLowerCase()); })(), (await consoleText()).slice(-400) + ' || esperaba ' + d.projects[0].local);
    await shot('17-migrado');
  }

  // ===================================================================================
  try {
    win.setSize(1440, 900);
    win.showInactive();
    for (let i = 0; i < 100; i++) {
      let ready = false;
      try { ready = await exec('!!(window.__gh && window.__gh.ready)'); } catch { ready = false; }
      if (ready) break;
      await sleep(100);
    }
    check('la interfaz arranca (' + scenario + ')', await exec('!!(window.__gh && window.__gh.ready)'), 'window.__gh no existe');
    const scenarios = { completo: scenarioCompleto, reabrir: scenarioReabrir, migracion: scenarioMigracion };
    await scenarios[scenario]();
  } catch (e) {
    check('el recorrido termina sin excepciones', false, e && e.stack ? e.stack : e);
  }

  check('sin errores en la consola del navegador', consoleErrors.length === 0, consoleErrors.join(' | '));
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(outDir, 'resultado.json'), JSON.stringify({ escenario: scenario, total: results.length, fallos: failed.length, results }, null, 2));
  process.stdout.write('\nE2E ' + scenario + ': ' + (results.length - failed.length) + '/' + results.length + ' correctas\n');
  setTimeout(() => app.exit(failed.length ? 1 : 0), 300);
};
