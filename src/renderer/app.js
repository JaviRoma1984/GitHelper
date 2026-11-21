/* GitHelper · Interfaz: une los dos apartados (GitHub y local), los dos visualizadores, la consola y la lista de órdenes. */
(function () {
  'use strict';
  const GH = window.GH;
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => GH.Ansi.escapeHtml(String(s)).replace(/"/g, '&quot;');

  const S = {
    data: { repos: [], locals: [], selected: { repo: null, local: null } },
    cwd: null,
    local: null, // estado del repositorio local (git)
    remote: null, // último resultado de leer el repositorio de GitHub
    remoteUrl: '', // dirección que se está viendo arriba
    e2e: false,
    version: '',
  };
  let remoteSeq = 0;
  let localSeq = 0;
  let term = null;
  let remoteView = null;
  let localView = null;

  const parse = (u) => GH.Urls.parseRepoUrl(u, { allowLocal: S.e2e });
  const sameRepo = (a, b) => GH.Urls.sameRepo(a, b, { allowLocal: S.e2e });
  const normDir = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase();
  const sameDir = (a, b) => !!a && !!b && normDir(a) === normDir(b);
  const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '');

  // ---------------------------------------------------------------- avisos y confirmaciones
  let toastTimer = null;
  function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), bad ? 4500 : 2600);
  }

  function confirmBox(o) {
    return new Promise((resolve) => {
      const modal = $('modal');
      const okb = $('modal-ok');
      const cb = $('modal-cancel');
      $('modal-title').textContent = o.title;
      $('modal-body').innerHTML = o.html;
      okb.textContent = o.ok || 'Aceptar';
      okb.className = 'btn ' + (o.danger ? 'danger' : 'primary');
      modal.hidden = false;
      okb.focus();
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
      const done = (v) => {
        modal.hidden = true;
        okb.onclick = null;
        cb.onclick = null;
        document.removeEventListener('keydown', onKey, true);
        resolve(v);
      };
      document.addEventListener('keydown', onKey, true);
      okb.onclick = () => done(true);
      cb.onclick = () => done(false);
    });
  }

  function setHint(el, text, cls) {
    el.textContent = text || '';
    el.className = 'field-hint' + (cls ? ' ' + cls : '');
    el.title = text || '';
  }

  const pill = (text, cls, cmd, title) =>
    '<span class="pill ' + (cls || '') + '"' + (cmd ? ' data-cmd="' + esc(cmd) + '"' : '') + (title ? ' title="' + esc(title) + '"' : '') + '>' + text + '</span>';

  // ---------------------------------------------------------------- listas desplegables y botones de navegación
  function option(value, text, disabled) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    if (disabled) o.disabled = true;
    return o;
  }

  function currentSavedRepo() {
    return S.remoteUrl ? S.data.repos.find((r) => sameRepo(r.url, S.remoteUrl)) || null : null;
  }

  function currentSavedLocal() {
    return S.cwd ? S.data.locals.find((l) => sameDir(l.path, S.cwd)) || null : null;
  }

  function fillRemoteList() {
    const sel = $('remote-list');
    const repos = S.data.repos;
    const cur = currentSavedRepo();
    sel.innerHTML = '';
    if (!repos.length) {
      sel.appendChild(option('', '— ningún repositorio guardado —'));
      sel.disabled = true;
    } else {
      sel.disabled = false;
      if (!cur) sel.appendChild(option('', '— elige uno de los ' + repos.length + ' guardados —'));
      repos.forEach((r) => {
        const info = parse(r.url);
        sel.appendChild(option(r.url, info ? info.label + (info.kind === 'github' ? '' : '  (' + info.host + ')') : r.url));
      });
      sel.value = cur ? cur.url : '';
    }
    $('remote-count').textContent = repos.length ? repos.length + (repos.length === 1 ? ' guardado' : ' guardados') : '';
    const many = repos.length > 1 || (repos.length === 1 && !cur);
    $('btn-remote-prev').disabled = !many;
    $('btn-remote-next').disabled = !many;
  }

  function fillLocalList() {
    const sel = $('local-list');
    const locals = S.data.locals;
    const cur = currentSavedLocal();
    sel.innerHTML = '';
    if (!locals.length) {
      sel.appendChild(option('', '— ninguna carpeta guardada —'));
      sel.disabled = true;
    } else {
      sel.disabled = false;
      if (!cur) sel.appendChild(option('', '— elige una de las ' + locals.length + ' guardadas —'));
      locals.forEach((l) => sel.appendChild(option(l.path, baseName(l.path) + '   —   ' + l.path)));
      sel.value = cur ? cur.path : '';
    }
    $('local-count').textContent = locals.length ? locals.length + (locals.length === 1 ? ' guardada' : ' guardadas') : '';
    const many = locals.length > 1 || (locals.length === 1 && !cur);
    $('btn-local-prev').disabled = !many;
    $('btn-local-next').disabled = !many;
  }

  function updateRemoteHint() {
    const el = $('remote-hint');
    const v = $('remote-url').value.trim();
    if (!v) { setHint(el, S.data.repos.length ? '' : 'Escribe la dirección de un repositorio de GitHub y pulsa «Guardar».'); return; }
    const info = parse(v);
    if (!info) { setHint(el, 'No parece una dirección válida. Ejemplo: https://github.com/usuario/repositorio', 'warn'); return; }
    if (S.data.repos.some((r) => sameRepo(r.url, info.url))) setHint(el, '✔ Guardado en la lista (' + info.label + ')', 'ok');
    else setHint(el, 'Sin guardar: pulsa «Guardar» para añadirlo a la lista.', '');
  }

  function updateLocalHint() {
    const el = $('local-hint');
    const v = $('local-path').value.trim();
    if (!v) { setHint(el, S.data.locals.length ? '' : 'Elige la carpeta con «Examinar…» o escribe su ruta y pulsa «Guardar».'); return; }
    if (S.local && S.local.cwd && sameDir(S.local.cwd, v.replace(/^"|"$/g, ''))) {
      if (!S.local.exists) { setHint(el, 'Esa carpeta no existe.', 'err'); return; }
      const saved = !!currentSavedLocal();
      const kind = S.local.isRepo ? 'repositorio de Git' : 'todavía no es un repositorio';
      setHint(el, (saved ? '✔ Guardada en la lista · ' : 'Sin guardar (pulsa «Guardar») · ') + kind, saved ? 'ok' : '');
      return;
    }
    setHint(el, 'Pulsa Enter para abrir esta carpeta.', '');
  }

  // ---------------------------------------------------------------- visualizador de GitHub
  const cmdBtn = (cmd) => '<span class="cmd" data-cmd="' + esc(cmd) + '">' + esc(cmd) + '</span>';

  /** Los push que se marcan en el dibujo de GitHub: los hechos desde la carpeta local enlazada con ESE repositorio (git los apunta en su registro). */
  function pushesForRemote() {
    const st = S.local;
    if (!st || !st.isRepo || !st.origin || !S.remoteUrl || !sameRepo(st.origin, S.remoteUrl)) return [];
    return (st.pushes || []).filter((p) => p.ref.startsWith('origin/'));
  }
  const pushSig = () => pushesForRemote().map((p) => p.ref + ':' + p.new + ':' + p.ts).join('|');

  function remoteEmptyHtml() {
    return '<div class="empty-card"><h3>☁ Aquí se dibujan las ramas de tu repositorio de GitHub</h3>' +
      '<ol><li>Escribe arriba su dirección (por ejemplo <code>https://github.com/usuario/repositorio</code>) y pulsa <b>Ver</b>.</li>' +
      '<li>Pulsa <b>Guardar</b> para dejarla en la lista y poder moverte entre tus repositorios con la lista desplegable o las flechas ‹ ›.</li></ol>' +
      '<p>No hace falta que el repositorio esté en tu ordenador: GitHelper lee solo su historial. Si es privado, necesita que Git ya tenga tu sesión de GitHub iniciada.</p></div>';
  }

  function remoteBusyHtml(info) {
    return '<div class="empty-card busy"><h3><span class="spin">⏳</span> Leyendo las ramas de ' + esc(info.label) + '…</h3>' +
      '<p>La primera vez descarga el historial (sin los archivos) y puede tardar unos segundos. Las siguientes veces solo baja lo nuevo.</p></div>';
  }

  function remoteErrorHtml(r) {
    let extra = '';
    if (r.errorKind === 'auth') extra = '<p>Para iniciar sesión pulsa <b>⌨ Terminal externa</b> (arriba a la derecha) y escribe <code>gh auth login</code>.</p>';
    return '<div class="empty-card err"><h3>No he podido leer ese repositorio</h3><p>' + esc(r.error) + '</p>' + extra +
      '<p>Cuando lo hayas arreglado, pulsa <b>↻ Actualizar</b>.</p></div>';
  }

  function remoteStrip(r) {
    if (!r || !r.info) return '';
    const p = [pill('☁ ' + esc(r.info.label), 'info', null, r.info.web || '')];
    if (r.ok) {
      if (r.empty) p.push(pill('repositorio vacío', 'warn'));
      else {
        p.push(pill(r.branches.length + (r.branches.length === 1 ? ' rama' : ' ramas'), ''));
        p.push(pill(r.commits.length + (r.commits.length === 1 ? ' commit' : ' commits') + (r.commits.length >= r.limit ? ' (los últimos)' : ''), ''));
        if (r.defaultBranch) p.push(pill('principal: ' + esc(r.defaultBranch), ''));
        if (r.tags.length) p.push(pill(r.tags.length + (r.tags.length === 1 ? ' etiqueta' : ' etiquetas'), ''));
      }
    }
    if (r.stale) p.push(pill('⚠ sin conexión: datos de la última vez', 'warn', null, r.error || ''));
    else if (r.ok && r.fetchedAt) p.push(pill('✔ actualizado ' + new Date(r.fetchedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }), 'ok'));
    return p.join('');
  }

  function renderRemote() {
    const r = S.remote;
    $('remote-strip').innerHTML = remoteStrip(r);
    if (!r) { remoteView.showHtml(remoteEmptyHtml()); return; }
    if (!r.ok) { remoteView.showHtml(remoteErrorHtml(r)); return; }
    if (r.empty) {
      remoteView.showHtml('<div class="empty-card"><h3>🌱 Este repositorio de GitHub está vacío</h3><p>Todavía no tiene ningún commit. Cuando subas el primero, aparecerá aquí.</p>' +
        '<ol><li>En tu carpeta local: ' + cmdBtn('git add .') + ' y ' + cmdBtn('git commit -m "Primer commit"') + '</li><li>Enlázala y súbela: ' + cmdBtn('git remote add origin ' + r.url) + ' y ' + cmdBtn('git push -u origin main') + '</li></ol></div>');
      return;
    }
    S.remotePushSig = pushSig();
    remoteView.render(r.commits, { currentBranch: r.defaultBranch, pushes: pushesForRemote() });
  }

  async function showRemote(url, o) {
    const opts = o || {};
    const info = parse(url);
    if (!info) return;
    S.remoteUrl = info.url;
    $('remote-url').value = info.url;
    const seq = ++remoteSeq;
    const sameShown = !!(S.remote && S.remote.info && S.remote.info.key === info.key && S.remote.ok);
    $('btn-remote-refresh').disabled = true;
    if (!sameShown) {
      S.remote = null;
      $('remote-strip').innerHTML = pill('☁ ' + esc(info.label), 'info') + pill('<span class="spin">⏳</span> leyendo…', 'warn');
      remoteView.showHtml(remoteBusyHtml(info));
    } else {
      $('remote-strip').innerHTML = remoteStrip(S.remote) + pill('<span class="spin">↻</span> actualizando…', 'warn');
    }
    fillRemoteList();
    updateRemoteHint();
    renderLocalStrip();
    const res = await api.loadRemote(info.url, opts.fetch !== false);
    if (seq !== remoteSeq) return; // mientras tanto se pidió otro repositorio: esta respuesta ya no vale
    $('btn-remote-refresh').disabled = false;
    if (res.error && !res.info) { S.remote = { info: { label: info.label, key: info.key, web: info.web }, ok: false, error: res.error }; } else S.remote = res;
    renderRemote();
    fillRemoteList();
    updateRemoteHint();
    renderLocalStrip();
  }

  function clearRemote() {
    remoteSeq++;
    S.remote = null;
    S.remoteUrl = '';
    $('remote-url').value = '';
    $('btn-remote-refresh').disabled = false;
    renderRemote();
    fillRemoteList();
    updateRemoteHint();
    renderLocalStrip();
  }

  // ---------------------------------------------------------------- visualizador local
  function localEmptyHtml(st) {
    if (!st.gitAvailable) {
      return '<div class="empty-card err"><h3>⚠ No encuentro Git en este ordenador</h3><p>Instala «Git for Windows» desde <b>git-scm.com/download/win</b> y vuelve a abrir GitHelper.</p></div>';
    }
    if (st.noFolder) {
      return '<div class="empty-card"><h3>📁 Aquí se dibujan las ramas de tu repositorio local</h3>' +
        '<ol><li>Pulsa <b>Examinar…</b> (arriba a la derecha) y elige la carpeta de tu proyecto, o escribe su ruta y pulsa Enter.</li>' +
        '<li>Pulsa <b>Guardar</b> para dejarla en la lista.</li>' +
        '<li>Con las dos cosas elegidas verás las ramas de GitHub arriba y las de tu ordenador aquí, para compararlas.</li></ol></div>';
    }
    if (!st.exists) return '<div class="empty-card err"><h3>La carpeta no existe</h3><p>Elige otra con «Examinar…» o escribe otra ruta.</p></div>';
    if (st.error === 'dubious ownership') {
      return '<div class="empty-card err"><h3>Git desconfía de esta carpeta</h3><p>Windows indica que la carpeta pertenece a otro usuario. Si es tuya y es segura, pulsa: ' + cmdBtn('git config --global --add safe.directory "' + st.cwd + '"') + ' y luego Enter.</p></div>';
    }
    if (st.parentRepo) {
      return '<div class="empty-card err"><h3>Esta carpeta está dentro de otro repositorio</h3><p>Los comandos de git actuarían sobre <b>' + esc(st.parentRepo) + '</b>, no sobre esta carpeta.</p><p>Elige la carpeta raíz de ese repositorio, o crea uno propio aquí con ' + cmdBtn('git init') + '.</p></div>';
    }
    if (!st.isRepo) {
      return '<div class="empty-card"><h3>🌱 Esta carpeta todavía no es un repositorio de Git</h3>' +
        '<ol><li>Para convertirla en uno, pulsa ' + cmdBtn('git init') + ' y Enter en la consola.</li>' +
        '<li>¿Ya existe en GitHub? Clónalo aquí (con la carpeta vacía): ' + cmdBtn('git clone <url> .') + '</li></ol></div>';
    }
    return '<div class="empty-card"><h3>🌿 Repositorio creado en la rama «' + esc(st.branch || 'main') + '», pero aún sin commits</h3>' +
      '<ol><li>Prepara los archivos: ' + cmdBtn('git add .') + '</li><li>Guárdalos: ' + cmdBtn('git commit -m "Primer commit"') + '</li></ol></div>';
  }

  function localStrip(st) {
    if (!st || st.noFolder || !st.exists || !st.isRepo) return '';
    const p = [pill('📁 ' + esc(st.name), 'info', null, st.cwd)];
    if (st.detached) p.push(pill('HEAD separado', 'warn', 'git switch -', 'Estás mirando un commit suelto, no una rama'));
    else if (st.branch) p.push(pill('rama ' + esc(st.branch), 'info'));
    if (st.unborn) p.push(pill('sin commits todavía', 'warn'));
    if (st.origin) {
      const o = parse(st.origin);
      p.push(pill('origin: ' + esc(o ? o.label : st.origin), '', null, st.origin));
      if (st.upstream) {
        if (st.ahead) p.push(pill('↑ ' + st.ahead + ' por subir', 'warn', 'git push', 'Tienes commits que GitHub aún no tiene. Clic: pegar git push'));
        if (st.behind) p.push(pill('↓ ' + st.behind + ' por bajar', 'info', 'git pull', 'GitHub tiene commits que tú aún no tienes. Clic: pegar git pull'));
        if (!st.ahead && !st.behind) p.push(pill('✔ al día con GitHub', 'ok', null, 'Esta rama coincide con ' + st.upstream));
      } else if (st.branch && !st.unborn) {
        p.push(pill('rama sin subir', 'warn', 'git push -u origin ' + st.branch, 'Esta rama no está enlazada con GitHub. Clic: pegar el comando para subirla'));
      }
      if (S.remoteUrl && o && !sameRepo(st.origin, S.remoteUrl)) p.push(pill('⚠ origin no es el repositorio de arriba', 'warn', null, 'El origin de esta carpeta es ' + st.origin));
    } else {
      p.push(pill('sin GitHub enlazado', 'warn', 'git remote add origin <url>', 'Esta carpeta no está enlazada con ningún repositorio de GitHub. Clic: pegar el comando para enlazarla'));
    }
    if (st.merging) p.push(pill('fusión en curso', 'bad', 'git status'));
    if (st.rebasing) p.push(pill('rebase en curso', 'bad', 'git status'));
    if (st.files.length) {
      p.push(pill(st.files.length + (st.files.length === 1 ? ' cambio sin guardar' : ' cambios sin guardar'), st.counts.conflicts ? 'bad' : 'warn', 'git status', 'Clic: pegar git status'));
    }
    if (st.branches.length) p.push(pill(st.branches.length + (st.branches.length === 1 ? ' rama local' : ' ramas locales'), ''));
    if (st.commits.length >= st.limit) p.push(pill('últimos ' + st.limit + ' commits', ''));
    return p.join('');
  }

  function renderLocalStrip() {
    $('local-strip').innerHTML = localStrip(S.local);
  }

  function updatePrompt() {
    const st = S.local;
    let t = 'sin carpeta';
    if (st && st.cwd && st.exists) t = st.name + (st.branch ? ' (' + st.branch + ')' : st.detached ? ' (HEAD separado)' : '');
    term.setPrompt(t + ' ›');
  }

  function renderLocal() {
    const st = S.local;
    renderLocalStrip();
    updatePrompt();
    if (!st) { localView.showHtml(''); return; }
    const showable = !st.noFolder && st.gitAvailable && st.exists && st.isRepo && !st.unborn && st.commits.length > 0;
    if (!showable) { localView.showHtml(localEmptyHtml(st)); return; }
    localView.render(st.commits, {
      currentBranch: st.branch,
      headSha: st.headSha,
      pushes: st.pushes,
      pending: { count: st.files.length, staged: st.counts.staged, conflicts: st.counts.conflicts },
    });
  }

  async function refreshLocal() {
    const seq = ++localSeq;
    const st = await api.getState();
    if (seq !== localSeq) return S.local;
    S.local = st;
    renderLocal();
    // Si cambian los push de esta carpeta (acabas de subir algo), se actualizan también las marcas del dibujo de GitHub.
    if (S.remote && S.remote.ok && !S.remote.empty && pushSig() !== S.remotePushSig) renderRemote();
    updateLocalHint();
    return st;
  }

  // ---------------------------------------------------------------- elegir repositorios (y enlazar uno con el otro)
  async function selectRemote(url, o) {
    const opts = o || {};
    const r = await api.selectRepo(url);
    if (r && r.data) S.data = r.data;
    await showRemote(url, { fetch: true });
    if (opts.pair !== false) await pairLocalForRemote(url);
  }

  async function selectLocal(dir, o) {
    const opts = o || {};
    const r = await api.selectLocal(dir);
    if (r.error) { setHint($('local-hint'), r.error, 'err'); toast(r.error, true); return false; }
    S.data = r.data;
    S.cwd = r.cwd;
    $('local-path').value = r.cwd || '';
    fillLocalList();
    await refreshLocal();
    if (opts.pair !== false) await pairRemoteForLocal();
    return true;
  }

  /** Al elegir un repositorio de GitHub, busca entre las carpetas guardadas la que esté enlazada con él. */
  async function pairLocalForRemote(url) {
    const r = await api.localOrigins();
    if (!r || r.error) return;
    const hit = r.list.find((x) => x.origin && sameRepo(x.origin, url));
    if (!hit || sameDir(S.cwd, hit.path)) return;
    const ok = await selectLocal(hit.path, { pair: false });
    if (ok) toast('Carpeta local enlazada con este repositorio: ' + baseName(hit.path));
  }

  /** Al elegir una carpeta local, enseña arriba el repositorio de GitHub al que apunta su «origin». */
  async function pairRemoteForLocal() {
    const st = S.local;
    if (!st || !st.origin) return;
    const info = parse(st.origin);
    if (!info) return;
    const saved = S.data.repos.find((r) => sameRepo(r.url, info.url));
    if (saved) {
      if (!S.remoteUrl || !sameRepo(S.remoteUrl, saved.url)) await selectRemote(saved.url, { pair: false });
    } else if (!S.remoteUrl) {
      await showRemote(info.url, { fetch: true });
    }
  }

  // ---------------------------------------------------------------- acciones de los botones (GitHub)
  async function viewRemote() {
    const v = $('remote-url').value.trim();
    const info = parse(v);
    if (!info) { updateRemoteHint(); toast('Esa dirección no es válida. Ejemplo: https://github.com/usuario/repositorio', true); return; }
    const saved = S.data.repos.find((r) => sameRepo(r.url, info.url));
    if (saved) await selectRemote(saved.url);
    else {
      const r = await api.selectRepo(null);
      if (r && r.data) S.data = r.data;
      await showRemote(info.url, { fetch: true });
      await pairLocalForRemote(info.url);
    }
  }

  async function saveRemote() {
    const info = parse($('remote-url').value);
    if (!info) { updateRemoteHint(); toast('Esa dirección no es válida. Ejemplo: https://github.com/usuario/repositorio', true); return; }
    const r = await api.saveRepo(info.url);
    if (r.error) { toast(r.error, true); return; }
    S.data = r.data;
    toast(r.already ? 'Ese repositorio ya estaba guardado: ' + info.label : '✔ Guardado: ' + info.label);
    fillRemoteList();
    await showRemote(info.url, { fetch: true });
    await pairLocalForRemote(info.url);
  }

  async function deleteRemote() {
    const info = parse($('remote-url').value);
    const saved = info && S.data.repos.find((r) => sameRepo(r.url, info.url));
    if (!saved) { toast('Ese repositorio no está en la lista guardada, no hay nada que borrar.', true); return; }
    const ok = await confirmBox({
      title: 'Quitar de la lista',
      html: '<p>¿Quitar <code>' + esc(info.label) + '</code> de la lista de repositorios guardados?</p><p class="safe">No se borra nada en GitHub ni en tu disco.</p>',
      ok: 'Quitar', danger: true,
    });
    if (!ok) return;
    const idx = S.data.repos.indexOf(saved);
    const r = await api.removeRepo(saved.url);
    if (r.error) { toast(r.error, true); return; }
    S.data = r.data;
    toast('Quitado de la lista: ' + info.label);
    const next = S.data.repos[Math.min(idx, S.data.repos.length - 1)];
    if (next) await selectRemote(next.url); else clearRemote();
  }

  async function stepRemote(delta) {
    const repos = S.data.repos;
    if (!repos.length) return;
    const cur = currentSavedRepo();
    const i = cur ? repos.indexOf(cur) : (delta > 0 ? -1 : 0);
    const next = repos[(i + delta + repos.length) % repos.length];
    await selectRemote(next.url);
  }

  // ---------------------------------------------------------------- acciones de los botones (local)
  async function openTypedLocal() {
    const v = $('local-path').value.trim();
    if (!v) { toast('Escribe la ruta de una carpeta o pulsa Examinar…', true); return; }
    await selectLocal(v);
  }

  async function browseLocal() {
    const r = await api.chooseLocal();
    if (r.canceled) return;
    if (r.error) { toast(r.error, true); return; }
    S.data = r.data;
    S.cwd = r.cwd;
    $('local-path').value = r.cwd || '';
    fillLocalList();
    await refreshLocal();
    await pairRemoteForLocal();
  }

  async function saveLocal() {
    const v = $('local-path').value.trim();
    if (!v) { toast('Primero elige una carpeta (Examinar… o escribe su ruta).', true); return; }
    const r = await api.saveLocal(v);
    if (r.error) { setHint($('local-hint'), r.error, 'err'); toast(r.error, true); return; }
    S.data = r.data;
    S.cwd = r.cwd;
    $('local-path').value = r.cwd;
    toast(r.already ? 'Esa carpeta ya estaba guardada.' : '✔ Carpeta guardada: ' + baseName(r.dir));
    fillLocalList();
    await refreshLocal();
    await pairRemoteForLocal();
  }

  async function deleteLocal() {
    const v = $('local-path').value.trim().replace(/^"|"$/g, '');
    const saved = v && S.data.locals.find((l) => sameDir(l.path, v));
    if (!saved) { toast('Esa carpeta no está en la lista guardada, no hay nada que borrar.', true); return; }
    const ok = await confirmBox({
      title: 'Quitar de la lista',
      html: '<p>¿Quitar la carpeta <code>' + esc(saved.path) + '</code> de la lista guardada?</p><p class="safe">Solo se quita de la lista: la carpeta y sus archivos no se tocan.</p>',
      ok: 'Quitar', danger: true,
    });
    if (!ok) return;
    const idx = S.data.locals.indexOf(saved);
    const r = await api.removeLocal(saved.path);
    if (r.error) { toast(r.error, true); return; }
    S.data = r.data;
    toast('Quitada de la lista: ' + baseName(saved.path));
    const next = S.data.locals[Math.min(idx, S.data.locals.length - 1)];
    if (next) await selectLocal(next.path);
    else {
      await selectLocal(null, { pair: false });
      $('local-path').value = '';
    }
  }

  async function stepLocal(delta) {
    const locals = S.data.locals;
    if (!locals.length) return;
    const cur = currentSavedLocal();
    const i = cur ? locals.indexOf(cur) : (delta > 0 ? -1 : 0);
    await selectLocal(locals[(i + delta + locals.length) % locals.length].path);
  }

  // ---------------------------------------------------------------- consola
  let nextId = 1;
  let currentRun = null;

  const WELCOME = '👋 <b>Bienvenido a GitHelper.</b> Esta consola trabaja en la carpeta de tu <b>repositorio local</b> (arriba a la derecha).<br>' +
    '• Escribe aquí comandos <b>git</b> y <b>gh</b> y pulsa Enter. Al terminar, los dibujos de arriba se actualizan solos.<br>' +
    '• ¿No te acuerdas de un comando? Pulsa cualquiera de la <b>lista de la derecha</b>: se copia aquí y solo tienes que rellenar lo que va entre &lt; &gt;.<br>' +
    '• Para iniciar sesión en GitHub (<code>gh auth login</code>) usa el botón <b>⌨ Terminal externa</b>.';

  function showHelp() {
    term.html('<b>Ayuda rápida</b><br>' +
      '• <code>git …</code> y <code>gh …</code>: los comandos de siempre, sin shell (nada de | ni ;). Se pueden encadenar con <code>&amp;&amp;</code>.<br>' +
      '• <code>ls</code> <code>cat</code> <code>echo "texto" &gt; archivo</code> <code>touch</code> <code>mkdir</code> <code>rm</code> <code>pwd</code>: ayudantes para trabajar con archivos.<br>' +
      '• <code>clear</code> limpia la consola · ↑ ↓ recorren el historial · Tab completa · Ctrl+C cancela el comando en marcha.<br>' +
      '• La lista de la derecha trae ' + GH.Commands.total() + ' órdenes explicadas: pulsa una para copiarla aquí.', 'welcome');
  }

  const affectsRemote = (argv) => argv[0].toLowerCase() === 'gh' || (argv[0].toLowerCase() === 'git' && argv.slice(1).find((x) => !x.startsWith('-')) === 'push');

  async function runLine(line) {
    const parsed = GH.Shell.parse(line);
    term.echo(promptText(), line);
    if (parsed.error) { term.error(parsed.error); return; }
    let touchedRemote = false;
    for (const cmd of parsed.commands) {
      const name = cmd.argv[0].toLowerCase();
      if (name === 'clear' || name === 'cls') { term.clear(); continue; }
      if (name === 'help') { showHelp(); continue; }
      const id = nextId++;
      term.beginStream(id);
      term.setBusy(true);
      currentRun = id;
      let r;
      try { r = await api.run(id, cmd.argv, cmd.redirect); } catch (e) { r = { code: 1, error: String(e) }; }
      term.endStream(id);
      term.setBusy(false);
      currentRun = null;
      if (r && r.error) term.error(String(r.error));
      if (r && r.cancelled) term.note('Cancelado.');
      else if (r && r.timedOut) term.error('El comando tardó demasiado y se ha cortado (más de 5 minutos).');
      if (affectsRemote(cmd.argv)) touchedRemote = true;
      if (!r || r.code !== 0) break; // con && se para en el primer fallo
    }
    await refreshLocal();
    if (touchedRemote && S.remoteUrl) showRemote(S.remoteUrl, { fetch: true });
  }

  const promptText = () => $('prompt').textContent;

  const GIT_SUBS = ['add', 'bisect', 'blame', 'branch', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'config', 'diff', 'fetch', 'grep', 'help', 'init', 'log', 'ls-files', 'ls-remote', 'merge', 'mv', 'pull', 'push', 'rebase', 'reflog', 'remote', 'reset', 'restore', 'revert', 'rm', 'shortlog', 'show', 'stash', 'status', 'submodule', 'switch', 'tag', 'worktree'];
  const GH_SUBS = ['alias', 'api', 'auth', 'browse', 'cache', 'codespace', 'config', 'extension', 'gist', 'gpg-key', 'issue', 'label', 'org', 'pr', 'project', 'release', 'repo', 'ruleset', 'run', 'search', 'secret', 'ssh-key', 'status', 'variable', 'workflow'];
  const FIRST = ['git', 'gh', 'ls', 'cat', 'echo', 'touch', 'mkdir', 'rm', 'pwd', 'clear', 'help'];
  const BRANCHY = ['switch', 'checkout', 'merge', 'rebase', 'branch', 'cherry-pick', 'push', 'pull', 'fetch', 'reset', 'log', 'diff', 'show', 'revert', 'tag'];

  function complete(line) {
    const tokens = line.split(/\s+/);
    const idx = tokens.length - 1;
    const cur = tokens[idx];
    let cands = [];
    if (idx === 0) cands = FIRST;
    else if (idx === 1 && tokens[0] === 'git') cands = GIT_SUBS;
    else if (idx === 1 && tokens[0] === 'gh') cands = GH_SUBS;
    else if (tokens[0] === 'git' && S.local && BRANCHY.includes(tokens[1])) {
      cands = S.local.branches.concat(S.local.remoteBranches, S.local.tags);
    }
    const hits = cands.filter((c) => c.startsWith(cur));
    if (!hits.length) return null;
    const head = line.slice(0, line.length - cur.length);
    if (hits.length === 1) return { value: head + hits[0] + ' ' };
    let common = hits[0];
    hits.forEach((h) => { while (!h.startsWith(common)) common = common.slice(0, -1); });
    return { value: head + common, options: hits };
  }

  // ---------------------------------------------------------------- separadores (tamaño de los paneles)
  // Por defecto los dos visualizadores reparten el ancho a partes iguales. Lo que se arrastre se recuerda en este ordenador.
  const LAYOUT_KEY = 'githelper.layout2';
  const ROWS = ['graphs', 'lower']; // alto: visualizadores / consola+órdenes
  const COLS = ['remote-panel', 'local-panel']; // ancho: GitHub / local

  function saveLayout() {
    try {
      const grow = (ids) => ids.map((id) => parseFloat($(id).style.flexGrow) || 0);
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ r: grow(ROWS), c: grow(COLS), cw: parseInt(document.documentElement.style.getPropertyValue('--cmds-w'), 10) || 0 }));
    } catch { /* sin almacenamiento: no pasa nada */ }
  }

  function restoreLayout() {
    try {
      const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
      if (!v) return;
      const apply = (ids, vals) => { if (Array.isArray(vals) && vals.length === ids.length && vals.every((n) => n > 50)) ids.forEach((id, i) => { $(id).style.flexGrow = String(vals[i]); }); };
      apply(ROWS, v.r);
      apply(COLS, v.c);
      if (v.cw >= 300 && v.cw < window.innerWidth - 350) document.documentElement.style.setProperty('--cmds-w', v.cw + 'px');
    } catch { /* ignorar */ }
  }

  function initSplitters() {
    const size = (id, axis) => $(id).getBoundingClientRect()[axis === 'x' ? 'width' : 'height'];
    // Para repartir con píxeles hay que fijar primero el tamaño actual de los dos paneles (flex-grow = su tamaño).
    const drag = (handle, aId, bId, axis, minA, minB) => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const a = $(aId);
        const b = $(bId);
        const sa = size(aId, axis);
        const sb = size(bId, axis);
        a.style.flexGrow = String(sa);
        b.style.flexGrow = String(sb);
        const p0 = axis === 'x' ? e.clientX : e.clientY;
        document.body.classList.add('dragging');
        if (axis === 'y') document.body.classList.add('dragging-h');
        const move = (ev) => {
          const d = Math.max(minA - sa, Math.min(sb - minB, (axis === 'x' ? ev.clientX : ev.clientY) - p0));
          a.style.flexGrow = String(sa + d);
          b.style.flexGrow = String(sb - d);
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          document.body.classList.remove('dragging', 'dragging-h');
          saveLayout();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    };
    drag($('split-1'), 'remote-panel', 'local-panel', 'x', 320, 320);
    drag($('split-2'), 'graphs', 'lower', 'y', 200, 150);
    $('split-3').addEventListener('mousedown', (e) => {
      e.preventDefault();
      document.body.classList.add('dragging');
      const move = (ev) => {
        const w = Math.max(300, Math.min(window.innerWidth - 380, window.innerWidth - ev.clientX));
        document.documentElement.style.setProperty('--cmds-w', w + 'px');
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('dragging');
        saveLayout();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    restoreLayout();
  }

  // ---------------------------------------------------------------- arranque
  function insertCmd(cmd) {
    term.insert(cmd);
  }

  /** Las cabeceras de los dos visualizadores miden lo mismo (aunque una tenga más etiquetas), así los dibujos quedan alineados. */
  let syncQueued = false;
  function syncHeads() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      const heads = [$('remote-panel'), $('local-panel')].map((p) => p.querySelector('.panel-head'));
      heads.forEach((h) => { h.style.minHeight = ''; });
      const max = Math.max.apply(null, heads.map((h) => h.getBoundingClientRect().height));
      heads.forEach((h) => { h.style.minHeight = max + 'px'; });
    });
  }

  function wire() {
    const obs = new MutationObserver(syncHeads);
    ['remote-strip', 'local-strip'].forEach((id) => obs.observe($(id), { childList: true, subtree: true, characterData: true }));
    window.addEventListener('resize', syncHeads);
    document.addEventListener('mouseup', syncHeads);
    syncHeads();
    // GitHub
    $('btn-remote-view').addEventListener('click', viewRemote);
    $('btn-remote-save').addEventListener('click', saveRemote);
    $('btn-remote-del').addEventListener('click', deleteRemote);
    $('btn-remote-prev').addEventListener('click', () => stepRemote(-1));
    $('btn-remote-next').addEventListener('click', () => stepRemote(1));
    $('btn-remote-web').addEventListener('click', async () => {
      const info = parse($('remote-url').value);
      if (!info || !info.web) { toast('Escribe primero la dirección de un repositorio.', true); return; }
      const r = await api.openExternal(info.web);
      if (r && r.error) toast(r.error, true);
    });
    $('btn-remote-refresh').addEventListener('click', () => {
      if (!S.remoteUrl) { toast('Primero elige un repositorio de GitHub.', true); return; }
      showRemote(S.remoteUrl, { fetch: true });
    });
    $('remote-url').addEventListener('input', updateRemoteHint);
    $('remote-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); viewRemote(); } });
    $('remote-list').addEventListener('change', (e) => { if (e.target.value) selectRemote(e.target.value); });

    // local
    $('btn-local-browse').addEventListener('click', browseLocal);
    $('btn-local-save').addEventListener('click', saveLocal);
    $('btn-local-del').addEventListener('click', deleteLocal);
    $('btn-local-prev').addEventListener('click', () => stepLocal(-1));
    $('btn-local-next').addEventListener('click', () => stepLocal(1));
    $('btn-folder').addEventListener('click', async () => {
      const r = await api.openFolder();
      if (r && r.error) toast(r.error, true);
    });
    $('local-path').addEventListener('input', updateLocalHint);
    $('local-path').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openTypedLocal(); } });
    $('local-list').addEventListener('change', (e) => { if (e.target.value) selectLocal(e.target.value); });

    // varios
    $('btn-terminal').addEventListener('click', async () => {
      const r = await api.openTerminal();
      if (r && r.error) toast(r.error, true);
    });
    $('btn-clear').addEventListener('click', () => { term.clear(); term.focus(); });
    ['remote-strip', 'local-strip'].forEach((id) => $(id).addEventListener('click', (e) => {
      const c = e.target.closest('[data-cmd]');
      if (c) insertCmd(c.getAttribute('data-cmd'));
    }));
    api.onTermData((d) => term.write(d.id, d.text));
    api.onRepoChanged(() => { refreshLocal(); });
  }

  async function init() {
    term = new GH.Terminal({
      out: $('console-out'),
      input: $('console-in'),
      prompt: $('prompt'),
      onSubmit: (line) => { runLine(line); },
      onCancel: () => { if (currentRun !== null) api.cancel(currentRun); },
      complete,
    });
    const handlers = {
      onCmd: insertCmd,
      onChip: (kind, name) => {
        if (kind === 'branch') insertCmd('git switch ' + name);
        else if (kind === 'remote') insertCmd('git switch ' + name.replace(/^[^/]+\//, ''));
        else if (kind === 'tag') insertCmd('git show ' + name);
      },
      onNode: (n) => { if (n) insertCmd('git show ' + n.short); },
    };
    remoteView = new GH.GraphView({ el: $('remote-graph'), scroller: $('remote-scroll'), mode: 'remote', handlers });
    localView = new GH.GraphView({ el: $('local-graph'), scroller: $('local-scroll'), mode: 'local', handlers });
    GH.CommandsView.init({ list: $('cmds-list'), search: $('cmd-search'), count: $('cmds-count'), onPick: insertCmd });
    initSplitters();
    wire();
    term.html(WELCOME, 'welcome');

    const r = await api.init();
    S.data = r.data;
    S.cwd = r.cwd;
    S.e2e = !!r.e2e;
    S.version = r.version;
    S.gitAvailable = r.gitAvailable;
    S.ghAvailable = r.ghAvailable;
    $('local-path').value = S.cwd || '';
    fillRemoteList();
    fillLocalList();
    updateRemoteHint();
    renderRemote();
    await refreshLocal();
    if (S.data.selected.repo) showRemote(S.data.selected.repo, { fetch: true });
    else await pairRemoteForLocal();
    if (!S.gitAvailable) term.error('No encuentro git.exe. Instala «Git for Windows» (git-scm.com/download/win) y vuelve a abrir GitHelper.');
    else if (!S.ghAvailable) term.note('Aviso: no encuentro «gh» (GitHub CLI). Los comandos «gh» no funcionarán hasta que lo instales (cli.github.com); con git ya puedes subir a GitHub.');
    term.focus();
    window.__gh = { S, runLine, refreshLocal, showRemote, selectRemote, selectLocal, term, ready: true };
  }

  init();
})();
