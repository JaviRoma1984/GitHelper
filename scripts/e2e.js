'use strict';
/* Prueba de extremo a extremo: abre la aplicación de verdad, la maneja como una persona y saca capturas.
 * Uso:  electron . --e2e   con variables de entorno que apunten a carpetas TEMPORALES (nunca a tus carpetas):
 *   GITHELPER_USERDATA     datos del programa (listas guardadas, copias de GitHub)
 *   GITHELPER_E2E_BASE     carpeta de trabajo de la prueba (aquí se crean los repositorios de ejemplo)
 *   GITHELPER_E2E_OUT      capturas e informe
 *   GITHELPER_E2E_STATE    archivo donde un escenario deja lo que el siguiente debe encontrar
 *   GITHELPER_E2E_SCENARIO = completo | reabrir
 * El «GitHub» de la prueba es un repositorio desnudo en una carpeta temporal: no se toca internet ni ninguna cuenta.
 * Los escenarios completo → reabrir se lanzan uno tras otro con los mismos datos: equivale a cerrar y reabrir el programa.
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
  const $enter = (id) => exec('document.getElementById(' + JSON.stringify(id) + ').dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", bubbles:true, cancelable:true}))');
  const $choose = (id, value) => exec('(() => { const e = document.getElementById(' + JSON.stringify(id) + '); e.value = ' + JSON.stringify(value) + '; e.dispatchEvent(new Event("change", {bubbles:true})); })()');
  const $options = (id) => exec('Array.from(document.getElementById(' + JSON.stringify(id) + ').options).map((o) => o.value)');
  const rect = (id) => exec('(() => { const r = document.getElementById(' + JSON.stringify(id) + ').getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right}; })()');
  const run = (line) => exec('window.__gh.runLine(' + JSON.stringify(line) + ')');
  const consoleText = () => exec('document.getElementById("console-out").innerText');
  const chips = (graphId) => exec('Array.from(document.querySelectorAll("#' + graphId + ' .chip")).map((c) => c.getAttribute("data-name"))');
  const nodes = (graphId) => $count('#' + graphId + ' .g-node');
  const strip = (id) => exec('document.getElementById(' + JSON.stringify(id) + ').innerText');
  const toastText = () => exec('document.getElementById("toast").textContent');
  const dbg = async () => JSON.stringify(await exec('({url: document.getElementById("remote-url").value, strip: document.getElementById("remote-strip").innerText, g: document.getElementById("remote-graph").innerText.slice(0,140), nodes: document.querySelectorAll("#remote-graph .g-node").length, modal: !document.getElementById("modal").hidden, toast: document.getElementById("toast").textContent})'));
  const readData = () => {
    try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); } catch { return { repos: [], locals: [], selected: {} }; } // sin archivo = nada guardado
  };
  const fwd = (p) => p.replace(/\\/g, '/');
  const dumpUi = () => exec(`(() => { const parts = [document.body.innerText, document.title];
    document.querySelectorAll('input,textarea').forEach((e) => parts.push(e.value, e.placeholder || '', e.title || ''));
    document.querySelectorAll('[title]').forEach((e) => parts.push(e.getAttribute('title')));
    document.querySelectorAll('option').forEach((o) => parts.push(o.value, o.textContent));
    return parts.join('\\n'); })()`);

  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.com', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main'].concat(args), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  /** Un «proyecto»: carpeta local con main, dev y una fusión + su «GitHub» (repositorio desnudo) enlazado como origin. */
  function makeProject(name, extraCommits) {
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
    for (let i = 0; i < (extraCommits || 0); i++) put('x' + i + '.txt', 'x' + i, 'Extra ' + (i + 1));
    const bare = path.join(dir, 'github.git');
    git(dir, 'clone', '-q', '--bare', work, bare);
    git(work, 'remote', 'add', 'origin', fwd(bare));
    git(work, 'fetch', '-q', 'origin');
    git(work, 'branch', '-q', '-u', 'origin/main', 'main');
    return { dir, work, bare: fwd(bare) };
  }

  // ===================================================================================
  async function scenarioCompleto() {
    // ---------- 1. Arranque vacío (nada de datos personales, nada guardado) ----------
    await sleep(500);
    check('arranca sin carpeta local', getCwd() === null, getCwd());
    check('el campo de GitHub está vacío', (await $val('remote-url')) === '', await $val('remote-url'));
    check('el campo local está vacío', (await $val('local-path')) === '', await $val('local-path'));
    const d0 = getData();
    check('no hay nada guardado', d0.repos.length === 0 && d0.locals.length === 0, JSON.stringify(d0));
    check('las listas desplegables están vacías y desactivadas', (await exec('document.getElementById("remote-list").disabled && document.getElementById("local-list").disabled')) === true, '');
    check('la consola da la bienvenida', (await consoleText()).includes('Bienvenido a GitHelper'), '');
    check('el panel de GitHub explica qué hacer', (await $text('#remote-graph')).includes('Aquí se dibujan las ramas de tu repositorio de GitHub'), await $text('#remote-graph'));
    check('el panel local explica qué hacer', (await $text('#local-graph')).includes('Aquí se dibujan las ramas de tu repositorio local'), await $text('#local-graph'));
    const ui0 = await dumpUi();
    check('la interfaz de arranque no contiene datos personales de quien la ejecuta', !PERSONAL.test(ui0), (ui0.match(PERSONAL) || [''])[0]);
    check('no menciona ninguna cuenta de GitHub concreta (solo el ejemplo «usuario/repositorio»)', !/github\.com\/(?!usuario\/repositorio)[\w.-]+\/[\w.-]+/i.test(ui0), (ui0.match(/github\.com\/[\w.-]+\/[\w.-]+/i) || [''])[0]);
    await shot('01-vacio');

    // ---------- 2. La distribución pedida ----------
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

    // ---------- 3. Escribir una URL: validar, ver y guardar ----------
    const p1 = makeProject('proyecto1');
    await $type('remote-url', 'hola esto no es una url');
    check('una dirección rara avisa en el campo', (await $text('#remote-hint')).includes('No parece una dirección válida'), await $text('#remote-hint'));
    await $click('#btn-remote-save');
    await sleep(300);
    check('guardar una dirección inválida no guarda nada', readData().repos.length === 0 && (await toastText()).includes('no es válida'), JSON.stringify(readData().repos) + ' / ' + await toastText());
    await $type('remote-url', '--upload-pack=calc');
    await $click('#btn-remote-save');
    await sleep(250);
    check('una dirección que parece una opción de git se rechaza', readData().repos.length === 0, JSON.stringify(readData().repos));
    await $type('remote-url', p1.bare);
    check('antes de guardar, el campo dice «sin guardar»', (await $text('#remote-hint')).includes('Sin guardar'), await $text('#remote-hint'));
    await $click('#btn-remote-save');
    check('se dibujan las ramas de GitHub', await waitFor(async () => (await nodes('remote-graph')) === 4), 'nodos: ' + await nodes('remote-graph'));
    const rch = await chips('remote-graph');
    check('el visualizador de GitHub muestra las ramas main y dev y la etiqueta v1', rch.includes('main') && rch.includes('dev') && rch.includes('v1'), JSON.stringify(rch));
    check('una fusión aparece como rombo', (await $count('#remote-graph polygon.g-shape')) === 1, await $count('#remote-graph polygon.g-shape'));
    check('la dirección queda guardada en el archivo de datos', readData().repos.length === 1 && readData().repos[0].url === p1.bare, JSON.stringify(readData().repos));
    check('la lista desplegable ya tiene 1 repositorio y el campo dice «guardado»', (await $options('remote-list')).length === 1 && (await $text('#remote-hint')).includes('Guardado'), JSON.stringify(await $options('remote-list')) + await $text('#remote-hint'));
    check('la franja de GitHub resume ramas y commits', /2 ramas/.test(await strip('remote-strip')) && /4 commits/.test(await strip('remote-strip')), await strip('remote-strip'));
    const railInfo = (graphId) => exec(`(() => {
      const g = document.querySelector('#${graphId} .g-rail'); if (!g) return null;
      const ext = g.querySelector('.g-rail-ext').getAttribute('d'); const x2 = parseFloat(ext.split('L')[1]);
      const xs = Array.from(document.querySelectorAll('#${graphId} .g-shape')).map((e) => parseFloat(e.getAttribute('cx') || e.getAttribute('points').split(',')[0]));
      const svg = document.querySelector('#${graphId} svg').getBoundingClientRect().width;
      const panel = document.getElementById('${graphId.replace('graph', 'scroll')}').clientWidth;
      return { x2, maxNode: Math.max.apply(null, xs), svg, panel, label: g.querySelector('.g-rail-label').textContent, title: g.querySelector('title').textContent };
    })()`);
    const ri = await railInfo('remote-graph');
    check('main se dibuja como una línea larga que sigue más allá de su último commit', ri && ri.label === 'main' && ri.x2 > ri.maxNode + 40, JSON.stringify(ri));
    check('y esa línea llega hasta el borde derecho del panel', ri && ri.svg >= ri.panel - 16, JSON.stringify(ri));
    check('el repositorio no aparece como carpeta de trabajo (solo hay copia desnuda en los datos del programa)', fs.readdirSync(cacheRoot()).length === 1, fs.readdirSync(cacheRoot()).join(','));
    await shot('02-github');

    // ---------- 4. Repositorio local: se enlaza solo con el de GitHub ----------
    await $type('local-path', p1.work);
    await $enter('local-path');
    check('se dibujan las ramas locales', await waitFor(async () => (await nodes('local-graph')) === 4), 'nodos: ' + await nodes('local-graph'));
    const lch = await chips('local-graph');
    check('el visualizador local muestra main, dev, origin/main y la etiqueta', lch.includes('main') && lch.includes('dev') && lch.includes('origin/main') && lch.includes('v1'), JSON.stringify(lch));
    check('la franja local dice que está al día con GitHub', (await strip('local-strip')).includes('al día con GitHub'), await strip('local-strip'));
    check('la franja local muestra la rama actual y el origin', /rama main/.test(await strip('local-strip')) && /origin:/.test(await strip('local-strip')), await strip('local-strip'));
    check('el prompt de la consola muestra carpeta y rama', (await $text('#prompt')).includes('trabajo (main)'), await $text('#prompt'));
    check('la carpeta local queda sin guardar hasta pulsar Guardar', readData().locals.length === 0 && (await $text('#local-hint')).includes('Sin guardar'), JSON.stringify(readData().locals) + await $text('#local-hint'));
    await $click('#btn-local-save');
    await sleep(500);
    check('Guardar deja la carpeta en la lista y en el archivo de datos', readData().locals.length === 1 && (await $options('local-list')).length === 1 && (await $text('#local-hint')).includes('Guardada'), JSON.stringify(readData().locals));
    const hr = await rect('remote-scroll');
    const hl = await rect('local-scroll');
    check('los dos dibujos empiezan a la misma altura (cabeceras alineadas)', Math.abs(hr.y - hl.y) < 2, JSON.stringify({ remoto: hr.y, local: hl.y }));
    await shot('03-github-y-local');

    // ---------- 5. Consola: trabajar en el repositorio local y subir ----------
    await run('git switch -c prueba');
    await run('echo "hola desde GitHelper" > hola.txt');
    await run('git add .');
    await run('git commit -m "Commit desde la consola"');
    check('el commit hecho en la consola aparece en el dibujo local', await waitFor(async () => (await nodes('local-graph')) === 5), 'nodos: ' + await nodes('local-graph'));
    check('la rama nueva «prueba» aparece como etiqueta local', (await chips('local-graph')).includes('prueba'), JSON.stringify(await chips('local-graph')));
    check('GitHub todavía no tiene esa rama', (await nodes('remote-graph')) === 4 && !(await chips('remote-graph')).includes('prueba'), '');
    check('la franja local avisa de que la rama no está subida', (await strip('local-strip')).includes('rama sin subir'), await strip('local-strip'));
    await shot('04-commit-local');
    await run('git push -u origin prueba');
    check('tras subir, el dibujo de GitHub se actualiza solo con la rama nueva', await waitFor(async () => (await nodes('remote-graph')) === 5 && (await chips('remote-graph')).includes('prueba'), 20000), JSON.stringify(await chips('remote-graph')) + ' nodos: ' + await nodes('remote-graph'));
    check('y la copia local recuerda origin/prueba', await waitFor(async () => (await chips('local-graph')).includes('origin/prueba')), JSON.stringify(await chips('local-graph')));
    const rp = await railInfo('remote-graph');
    check('con una rama más avanzada que main, la línea de main sigue en paralelo y lo explica', rp && rp.x2 > rp.maxNode && rp.title.includes('otras ramas han seguido avanzando'), JSON.stringify(rp));
    const rl2 = await railInfo('local-graph');
    check('el visualizador local también dibuja la línea larga de main', rl2 && rl2.label === 'main' && rl2.x2 > rl2.maxNode, JSON.stringify(rl2));
    check('de verdad llegó al «GitHub» de la prueba', git(p1.work, '-C', p1.bare, 'log', '-1', '--format=%s', 'prueba').trim() === 'Commit desde la consola', '');
    check('la consola enseñó la salida del push', /prueba/.test(await consoleText()), '');
    await shot('05-subido');

    // ---------- 6. Consola con teclado real, errores y ayudantes ----------
    await exec('(() => { const i = document.getElementById("console-in"); i.focus(); i.value = "git stat"; i.dispatchEvent(new KeyboardEvent("keydown", {key:"Tab", bubbles:true, cancelable:true})); })()');
    check('Tab completa el subcomando de git', (await $val('console-in')) === 'git status ', JSON.stringify(await $val('console-in')));
    await exec('(() => { const i = document.getElementById("console-in"); i.value = "git status -s"; i.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", bubbles:true, cancelable:true})); })()');
    check('Enter ejecuta lo escrito y vacía la línea', await waitFor(async () => (await consoleText()).includes('git status -s')) && (await $val('console-in')) === '', await $val('console-in'));
    await run('cualquiercosa');
    check('un comando desconocido se explica', (await consoleText()).includes('No conozco el comando'), '');
    await run('powershell -c "dir"');
    check('no se cuela otro programa', (await consoleText().then((t) => t.split('No conozco el comando').length - 1)) >= 2, '');
    await run('git rebase -i HEAD~2');
    check('un comando interactivo se explica en vez de colgarse', (await consoleText()).includes('Terminal externa'), '');
    await run('git switch main && git log --oneline -n 2');
    check('&& encadena: cambia de rama y luego muestra el historial', /main \(/.test(await $text('#prompt')) || (await $text('#prompt')).includes('(main)'), await $text('#prompt'));
    await run('rm -r .');
    check('no se puede borrar la carpeta entera', fs.existsSync(path.join(p1.work, '.git')), '');
    await run('help');
    check('help escribe la ayuda', (await consoleText()).includes('Ayuda rápida'), '');

    // ---------- 7. Lista desplegable de órdenes ----------
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
    await shot('06-ordenes');
    await $type('cmd-search', '');
    await exec('document.getElementById("console-in").value = ""');

    // ---------- 8. Un clic en una rama o en un punto pega el comando ----------
    await exec('document.querySelector("#local-graph .chip[data-name=dev]").dispatchEvent(new MouseEvent("click", {bubbles:true}))');
    check('pulsar la etiqueta de una rama pega «git switch rama»', (await $val('console-in')) === 'git switch dev', await $val('console-in'));
    await exec('document.querySelector("#remote-graph .g-node").dispatchEvent(new MouseEvent("click", {bubbles:true}))');
    check('pulsar un commit pega «git show»', /^git show [0-9a-f]{7}$/.test(await $val('console-in')), await $val('console-in'));
    await exec('document.getElementById("console-in").value = ""');

    // ---------- 9. Segundo repositorio: navegar entre los guardados ----------
    const p2 = makeProject('proyecto2', 3);
    await $type('remote-url', p2.bare);
    await $click('#btn-remote-save');
    check('el segundo repositorio se dibuja (7 commits)', await waitFor(async () => (await nodes('remote-graph')) === 7), 'nodos: ' + await nodes('remote-graph'));
    check('ahora hay 2 guardados y el contador lo dice', readData().repos.length === 2 && (await $text('#remote-count')).includes('2 guardados'), await $text('#remote-count'));
    await $click('#btn-remote-prev');
    check('la flecha ‹ vuelve al primero (4 commits en main/dev + prueba = 5)', await waitFor(async () => (await $val('remote-url')) === p1.bare && (await nodes('remote-graph')) === 5), await $val('remote-url') + ' nodos ' + await nodes('remote-graph'));
    await $click('#btn-remote-next');
    check('la flecha › pasa al segundo', await waitFor(async () => (await $val('remote-url')) === p2.bare && (await nodes('remote-graph')) === 7), await $val('remote-url'));
    await $choose('remote-list', p1.bare);
    check('la lista desplegable también cambia de repositorio', await waitFor(async () => (await $val('remote-url')) === p1.bare && (await nodes('remote-graph')) === 5), await $val('remote-url'));
    await shot('07-navegar');

    // el segundo proyecto local, enlazado con el segundo GitHub
    await $type('local-path', p2.work);
    await $click('#btn-local-save');
    check('el segundo repositorio local se guarda y se enlaza con su GitHub', await waitFor(async () => (await $val('remote-url')) === p2.bare && (await nodes('local-graph')) === 7 && (await nodes('remote-graph')) === 7), await $val('remote-url') + ' ' + await nodes('local-graph'));
    check('hay 2 carpetas guardadas', readData().locals.length === 2, JSON.stringify(readData().locals));
    await $click('#btn-remote-prev');
    check('al elegir otro repositorio de GitHub, se abre solo su carpeta local guardada (enlazada por origin)', await waitFor(async () => (await $val('remote-url')) === p1.bare && (await $val('local-path')).replace(/\\/g, '/') === fwd(p1.work) && (await nodes('local-graph')) === 5), await $val('remote-url') + ' | ' + await $val('local-path'));
    await $click('#btn-local-next');
    check('y al elegir la otra carpeta local, vuelve a verse su repositorio de GitHub', await waitFor(async () => (await $val('local-path')).replace(/\\/g, '/') === fwd(p2.work) && (await $val('remote-url')) === p2.bare && (await nodes('remote-graph')) === 7), await $val('local-path') + ' | ' + await $val('remote-url'));
    await $click('#btn-local-prev');
    check('la flecha ‹ de la carpeta local abre la anterior y trae su GitHub', await waitFor(async () => (await $val('local-path')).replace(/\\/g, '/') === fwd(p1.work) && (await $val('remote-url')) === p1.bare), await $val('local-path') + ' | ' + await $val('remote-url'));

    // ---------- 10. Borrar (con confirmación) ----------
    await $click('#btn-remote-del');
    check('Borrar pide confirmación', (await exec('!document.getElementById("modal").hidden')) === true && (await $text('#modal-body')).includes('No se borra nada en GitHub'), await $text('#modal-body'));
    await shot('08-confirmar-borrado');
    await $click('#modal-cancel');
    check('cancelar no borra nada', readData().repos.length === 2, JSON.stringify(readData().repos));
    const dir1 = fs.readdirSync(cacheRoot()).length;
    await $click('#btn-remote-del');
    await $click('#modal-ok');
    check('confirmar quita el repositorio de la lista y del archivo', await waitFor(async () => readData().repos.length === 1), JSON.stringify(readData().repos));
    check('y borra su copia desnuda de los datos del programa (el «GitHub» de verdad no se toca)', await waitFor(async () => fs.readdirSync(cacheRoot()).length === dir1 - 1) && fs.existsSync(p1.bare), fs.readdirSync(cacheRoot()).join(','));
    check('pasa a ver el que queda', await waitFor(async () => (await $val('remote-url')) === p2.bare && (await nodes('remote-graph')) === 7), await $val('remote-url'));
    check('y su carpeta local guardada se abre sola', await waitFor(async () => (await $val('local-path')).replace(/\\/g, '/') === fwd(p2.work) && (await nodes('local-graph')) === 7), await $val('local-path'));
    await sleep(500);
    await $type('remote-url', p1.bare);
    await $click('#btn-remote-del');
    await sleep(250);
    check('borrar algo que no está guardado avisa y no pide confirmación', (await exec('document.getElementById("modal").hidden')) === true && (await toastText()).includes('no está en la lista'), await toastText());
    await $click('#btn-remote-view');
    check('«Ver» enseña un repositorio sin guardarlo', await waitFor(async () => (await nodes('remote-graph')) === 5) && readData().repos.length === 1, await dbg());

    check('«Ver» también abre la carpeta local enlazada con ese repositorio', await waitFor(async () => (await $val('local-path')).replace(/\\/g, '/') === fwd(p1.work)), await $val('local-path'));
    await $click('#btn-local-del');
    await $click('#modal-ok');
    check('Borrar una carpeta local la quita de la lista, no del disco', await waitFor(async () => readData().locals.length === 1) && fs.existsSync(path.join(p1.work, '.git')) && fs.existsSync(path.join(p2.work, '.git')), JSON.stringify(readData().locals));

    check('y pasa a la siguiente carpeta guardada, con su repositorio de GitHub', await waitFor(async () => (await $val('local-path')).replace(/\\/g, '/') === fwd(p2.work) && (await $val('remote-url')) === p2.bare && (await nodes('remote-graph')) === 7 && (await nodes('local-graph')) === 7), await dbg());
    await sleep(400);

    // ---------- 11. Errores de GitHub ----------
    await $type('remote-url', fwd(path.join(base, 'no-existe.git')));
    await $click('#btn-remote-view');
    check('un repositorio que no se puede leer explica el motivo', await waitFor(async () => (await $text('#remote-graph')).includes('No he podido leer ese repositorio')), await dbg());
    await shot('09-error');
    await $choose('remote-list', p2.bare);
    check('y se puede volver a uno bueno', await waitFor(async () => (await nodes('remote-graph')) === 7), '');

    // ---------- 12. Tamaño de los paneles ----------
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
    const rw = await railInfo('remote-graph');
    const rwl = await railInfo('local-graph');
    check('al cambiar el ancho de los paneles, la línea de main se reajusta hasta el borde de cada uno', rw && rwl && rw.svg >= rw.panel - 16 && rwl.svg >= rwl.panel - 16, JSON.stringify({ remoto: rw && [rw.svg, rw.panel], local: rwl && [rwl.svg, rwl.panel] }));
    await shot('10b-ancho-cambiado');
    await exec(`(() => { const h = document.getElementById('split-2'); const r = h.getBoundingClientRect();
      h.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX: r.x+20, clientY: r.y+2}));
      document.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, clientX: r.x+20, clientY: r.y+2-50}));
      document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); })()`);
    await sleep(200);
    check('arrastrar el separador de abajo cambia el alto de los visualizadores', (await rect('graphs')).h < before.h - 30, JSON.stringify({ antes: before.h, ahora: (await rect('graphs')).h }));

    // lo que debe encontrar el escenario «reabrir»
    fs.writeFileSync(stateFile, JSON.stringify({ p1, p2 }));
    await shot('10-final');
  }

  async function scenarioReabrir() {
    const { p1, p2 } = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    await sleep(600);
    const d = getData();
    check('al reabrir, las listas guardadas siguen ahí', d.repos.length === 1 && d.locals.length === 1, JSON.stringify(d));
    check('y la carpeta y el repositorio que estaban abiertos también', await waitFor(async () => (await $val('remote-url')) === p2.bare && (await $val('local-path')).replace(/\\/g, '/') === fwd(p2.work)), await $val('remote-url') + ' | ' + await $val('local-path'));
    check('se vuelven a dibujar los dos visualizadores', await waitFor(async () => (await nodes('remote-graph')) === 7 && (await nodes('local-graph')) === 7), 'nodos ' + await nodes('remote-graph') + '/' + await nodes('local-graph'));
    check('la lista desplegable de GitHub tiene la dirección guardada', (await $options('remote-list')).includes(p2.bare), JSON.stringify(await $options('remote-list')));
    check('el programa recuerda el tamaño de los paneles', (await rect('remote-panel')).h > 150, '');
    await shot('11-reabierto');

    // Se pierde la conexión con «GitHub»: se enseñan los datos guardados avisando
    const gone = p2.bare + '.movido';
    fs.renameSync(p2.bare, gone);
    await $click('#btn-remote-refresh');
    check('sin conexión con GitHub se enseña lo último que se leyó y se avisa', await waitFor(async () => (await strip('remote-strip')).includes('sin conexión')) && (await nodes('remote-graph')) === 7, await strip('remote-strip'));
    await shot('12-sin-conexion');
    fs.renameSync(gone, p2.bare);
    await $click('#btn-remote-refresh');
    check('al volver la conexión se actualiza', await waitFor(async () => !(await strip('remote-strip')).includes('sin conexión')), await strip('remote-strip'));
    // Borrar la última carpeta y repositorio deja todo vacío
    await $click('#btn-remote-del');
    await $click('#modal-ok');
    await sleep(600);
    await $click('#btn-local-del');
    await $click('#modal-ok');
    check('al borrar lo último, todo queda vacío', await waitFor(async () => readData().repos.length === 0 && readData().locals.length === 0 && (await $val('remote-url')) === '' && (await $val('local-path')) === ''), JSON.stringify(readData()));
    check('y los paneles vuelven a explicar qué hacer', (await $text('#remote-graph')).includes('Aquí se dibujan') && (await $text('#local-graph')).includes('Aquí se dibujan'), '');
    check('no quedan copias de GitHub en los datos del programa', fs.readdirSync(cacheRoot()).length === 0, fs.readdirSync(cacheRoot()).join(','));
    check('las carpetas y repositorios de la prueba siguen intactos', fs.existsSync(path.join(p1.work, '.git')) && fs.existsSync(path.join(p2.work, '.git')) && fs.existsSync(p2.bare), '');
    await shot('13-vacio-otra-vez');
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
    const scenarios = { completo: scenarioCompleto, reabrir: scenarioReabrir };
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
