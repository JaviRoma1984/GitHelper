/* GitHelper · Interfaz: proyectos activos (nombre + GitHub + carpeta local), los dos visualizadores, la consola y la lista de órdenes. */
(function () {
  'use strict';
  const GH = window.GH;
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => GH.Ansi.escapeHtml(String(s)).replace(/"/g, '&quot;');

  const S = {
    data: { projects: [], selected: { project: null } },
    cwd: null, // carpeta local del proyecto activo
    missingLocal: false, // el proyecto tiene carpeta local pero ya no existe en el disco
    local: null, // estado del repositorio local (git)
    remote: null, // último resultado de leer el repositorio de GitHub
    remoteUrl: '', // dirección de GitHub del proyecto activo
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
  const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '');
  const curProject = () => S.data.projects.find((p) => p.id === S.data.selected.project) || null;

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
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } };
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

  const pill = (text, cls, cmd, title) =>
    '<span class="pill ' + (cls || '') + '"' + (cmd ? ' data-cmd="' + esc(cmd) + '"' : '') + (title ? ' title="' + esc(title) + '"' : '') + '>' + text + '</span>';

  // ---------------------------------------------------------------- proyectos activos: barra, desplegable e información
  function projectSub(p) {
    const info = p.url ? parse(p.url) : null;
    return [p.url ? '☁ ' + (info ? info.label : p.url) : '☁ (sin GitHub)', p.local ? '📁 ' + p.local : '📁 (sin carpeta local)'].join('   ·   ');
  }

  function renderProjectMenu() {
    const sel = S.data.selected.project;
    const rows = S.data.projects.map((p) =>
      '<div class="pm-item' + (p.id === sel ? ' sel' : '') + '" data-id="' + esc(p.id) + '">' +
        '<button class="pm-pick" type="button" title="Abrir este proyecto"><span class="pm-name">' + esc(p.name) + '</span><span class="pm-sub">' + esc(projectSub(p)) + '</span></button>' +
        '<button class="pm-act pm-edit" type="button" title="Editar el nombre, el GitHub o la carpeta local de este proyecto">✎</button>' +
        '<button class="pm-act pm-del" type="button" title="Borrar este proyecto de la lista (no borra nada en GitHub ni en tu disco)">🗑</button>' +
      '</div>');
    $('project-items').innerHTML = rows.length ? rows.join('') : '<div class="pm-empty">Todavía no hay ningún proyecto. Pulsa «Agregar proyecto».</div>';
  }

  function renderProjectInfo() {
    const p = curProject();
    const urlEl = $('pi-url');
    const pathEl = $('pi-path');
    if (!p) {
      urlEl.textContent = '—';
      pathEl.textContent = '—';
      urlEl.className = 'pi-text';
      pathEl.className = 'pi-text';
      urlEl.title = '';
      pathEl.title = '';
      $('btn-remote-web').disabled = true;
      $('btn-folder').disabled = true;
      return;
    }
    const info = p.url ? parse(p.url) : null;
    urlEl.textContent = p.url ? (info ? info.label + '  ·  ' + p.url : p.url) : 'sin dirección de GitHub todavía (pulsa ✎ para añadirla)';
    urlEl.title = p.url || '';
    urlEl.className = 'pi-text' + (p.url ? '' : ' missing');
    pathEl.textContent = p.local ? p.local + (S.missingLocal ? '   (la carpeta ya no existe)' : '') : 'sin carpeta local todavía (pulsa ✎ para añadirla)';
    pathEl.title = p.local || '';
    pathEl.className = 'pi-text' + (!p.local || S.missingLocal ? ' missing' : '');
    $('btn-remote-web').disabled = !(info && info.web);
    $('btn-folder').disabled = !(p.local && !S.missingLocal);
  }

  function renderProjectBar() {
    const p = curProject();
    const n = S.data.projects.length;
    $('project-btn-label').textContent = p ? p.name : '— elige un proyecto —';
    $('project-count').textContent = n ? n + (n === 1 ? ' proyecto' : ' proyectos') : '';
    const many = n > 1 || (n === 1 && !p);
    $('btn-project-prev').disabled = !many;
    $('btn-project-next').disabled = !many;
    renderProjectMenu();
    renderProjectInfo();
  }

  function openMenu() {
    renderProjectMenu();
    $('project-menu').hidden = false;
    $('project-btn').setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    $('project-menu').hidden = true;
    $('project-btn').setAttribute('aria-expanded', 'false');
  }
  function toggleMenu() {
    if ($('project-menu').hidden) openMenu(); else closeMenu();
  }

  // ---------------------------------------------------------------- formulario de proyecto (agregar / editar)
  let formId = null;
  let submitting = false;

  function openForm(id) {
    closeMenu();
    formId = id || null;
    const p = id ? S.data.projects.find((x) => x.id === id) : null;
    $('pf-title').textContent = p ? 'Editar proyecto' : 'Nuevo proyecto';
    $('pf-save').textContent = p ? '💾 Guardar cambios' : '💾 Guardar proyecto';
    $('pf-name').value = p ? p.name : '';
    $('pf-url').value = p ? p.url : '';
    $('pf-local').value = p ? p.local : '';
    $('pf-note').textContent = '';
    $('pf-error').textContent = '';
    $('pform').hidden = false;
    $('pf-name').focus();
  }

  function closeForm() {
    $('pform').hidden = true;
    formId = null;
  }

  /** Al elegir la carpeta: propone el nombre (el de la carpeta) y la dirección de GitHub (el «origin» de esa carpeta) si están vacíos. */
  async function suggestFromFolder() {
    const dir = $('pf-local').value.trim();
    if (!dir) return;
    if (!$('pf-name').value.trim()) $('pf-name').value = baseName(dir);
    if (!$('pf-url').value.trim()) {
      const r = await api.folderOrigin(dir);
      const info = r && r.origin ? parse(r.origin) : null;
      if (info) {
        $('pf-url').value = info.url;
        $('pf-note').textContent = 'La dirección de GitHub se ha tomado del «origin» de esa carpeta.';
      }
    }
  }

  async function submitForm() {
    if (submitting) return;
    submitting = true; // solo mientras se guarda (evita el doble clic); no mientras se redibuja, para poder volver a editar enseguida
    $('pf-error').textContent = '';
    const wasNew = !formId;
    let r;
    try {
      r = await api.saveProject({ id: formId, name: $('pf-name').value, url: $('pf-url').value, local: $('pf-local').value });
    } finally {
      submitting = false;
    }
    if (r.error) { $('pf-error').textContent = r.error; return; }
    closeForm();
    S.data = r.data;
    S.cwd = r.cwd;
    S.missingLocal = !!r.missingLocal;
    toast(wasNew ? '✔ Proyecto guardado: ' + r.project.name : '✔ Cambios guardados: ' + r.project.name);
    await applyProject();
  }

  // ---------------------------------------------------------------- visualizador de GitHub
  const cmdBtn = (cmd) => '<span class="cmd" data-cmd="' + esc(cmd) + '">' + esc(cmd) + '</span>';

  /** Los push que se marcan en el dibujo de GitHub: los hechos desde la carpeta local del proyecto (git los apunta en su registro). */
  function pushesForRemote() {
    const st = S.local;
    if (!st || !st.isRepo || !st.origin || !S.remoteUrl || !sameRepo(st.origin, S.remoteUrl)) return [];
    return (st.pushes || []).filter((p) => p.ref.startsWith('origin/'));
  }
  /** Dónde estás trabajando (commit y rama de la carpeta local), para señalarlo también en el dibujo de GitHub. */
  function hereForRemote() {
    const st = S.local;
    if (!st || !st.isRepo || !st.origin || !S.remoteUrl || !sameRepo(st.origin, S.remoteUrl)) return { at: null, on: null };
    return { at: st.unborn ? null : st.headSha, on: st.branch || null };
  }
  // Firma de lo que depende de la carpeta local en el dibujo de GitHub: si cambia (un push nuevo, otra rama, otro commit), se vuelve a dibujar.
  const pushSig = () => {
    const h = hereForRemote();
    return pushesForRemote().map((p) => p.ref + ':' + p.new + ':' + p.ts).join('|') + '#' + h.at + '#' + h.on;
  };

  function remoteEmptyHtml() {
    const p = curProject();
    if (p && !p.url) {
      return '<div class="empty-card"><h3>☁ Este proyecto todavía no tiene dirección de GitHub</h3>' +
        '<p>Pulsa <b>Proyectos activos ▾</b>, luego <b>✎</b> junto a «' + esc(p.name) + '» y escribe la dirección de su repositorio (por ejemplo <code>https://github.com/usuario/repositorio</code>).</p></div>';
    }
    return '<div class="empty-card"><h3>☁ Aquí se dibujan las ramas de tu repositorio de GitHub</h3>' +
      '<ol><li>Pulsa <b>Proyectos activos ▾</b> (arriba) y después <b>＋ Agregar proyecto</b>.</li>' +
      '<li>Ponle un <b>nombre</b> y escribe la <b>dirección de GitHub</b> donde vive y la <b>carpeta local</b> donde lo tienes. Pulsa Guardar.</li>' +
      '<li>Al elegir el proyecto, GitHelper ya sabe cuál es su GitHub y su carpeta, y dibuja las dos cosas una al lado de la otra.</li></ol>' +
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
      '<p>Cuando lo hayas arreglado (o corregido la dirección con ✎ en «Proyectos activos»), pulsa <b>↻ Actualizar</b>.</p></div>';
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
    const here = hereForRemote();
    remoteView.render(r.commits, { currentBranch: r.defaultBranch, pushes: pushesForRemote(), youAreAt: here.at, youAreOn: here.on });
    // Si la rama en la que estás aún no existe en GitHub, no hay dónde poner la flecha: se avisa en la franja.
    if (here.on && !(remoteView.model && remoteView.model.here)) {
      $('remote-strip').innerHTML += pill('tu rama «' + esc(here.on) + '» aún no está en GitHub', 'warn', 'git push -u origin ' + here.on, 'Estás en esa rama en tu carpeta local, pero todavía no la has subido. Clic: pegar el comando para subirla');
    }
  }

  async function showRemote(url, o) {
    const opts = o || {};
    const info = parse(url);
    if (!info) return;
    S.remoteUrl = info.url;
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
    renderLocalStrip();
    const res = await api.loadRemote(info.url, opts.fetch !== false);
    if (seq !== remoteSeq) return; // mientras tanto se pidió otro proyecto: esta respuesta ya no vale
    $('btn-remote-refresh').disabled = false;
    if (res.error && !res.info) { S.remote = { info: { label: info.label, key: info.key, web: info.web }, ok: false, error: res.error }; } else S.remote = res;
    renderRemote();
    renderLocalStrip();
  }

  /** El proyecto activo no tiene GitHub (o no hay proyecto): se vacía el dibujo de GitHub. */
  function clearRemote() {
    remoteSeq++;
    S.remote = null;
    S.remoteUrl = '';
    $('btn-remote-refresh').disabled = false;
    renderRemote();
    renderLocalStrip();
  }

  // ---------------------------------------------------------------- visualizador local
  function localEmptyHtml(st) {
    if (!st.gitAvailable) {
      return '<div class="empty-card err"><h3>⚠ No encuentro Git en este ordenador</h3><p>Instala «Git for Windows» desde <b>git-scm.com/download/win</b> y vuelve a abrir GitHelper.</p></div>';
    }
    if (st.noFolder) {
      const p = curProject();
      if (p && S.missingLocal) {
        return '<div class="empty-card err"><h3>La carpeta de este proyecto ya no existe</h3><p><code>' + esc(p.local) + '</code></p>' +
          '<p>Pulsa <b>Proyectos activos ▾</b>, luego <b>✎</b> junto a «' + esc(p.name) + '» y elige su carpeta nueva con <b>Examinar…</b>.</p></div>';
      }
      if (p) {
        return '<div class="empty-card"><h3>📁 Este proyecto todavía no tiene carpeta local</h3>' +
          '<p>Pulsa <b>Proyectos activos ▾</b>, luego <b>✎</b> junto a «' + esc(p.name) + '» y elige la carpeta de tu ordenador con <b>Examinar…</b>.</p></div>';
      }
      return '<div class="empty-card"><h3>📁 Aquí se dibujan las ramas de tu repositorio local</h3>' +
        '<ol><li>Elige un proyecto en <b>Proyectos activos ▾</b>, o agrega uno con <b>＋ Agregar proyecto</b>.</li>' +
        '<li>Su carpeta local se abre sola y aquí verás sus ramas, junto a las de GitHub, para compararlas.</li></ol></div>';
    }
    if (!st.exists) return '<div class="empty-card err"><h3>La carpeta no existe</h3><p>Edita el proyecto (✎) y elige otra.</p></div>';
    if (st.error === 'dubious ownership') {
      return '<div class="empty-card err"><h3>Git desconfía de esta carpeta</h3><p>Windows indica que la carpeta pertenece a otro usuario. Si es tuya y es segura, pulsa: ' + cmdBtn('git config --global --add safe.directory "' + st.cwd + '"') + ' y luego Enter.</p></div>';
    }
    if (st.parentRepo) {
      return '<div class="empty-card err"><h3>Esta carpeta está dentro de otro repositorio</h3><p>Los comandos de git actuarían sobre <b>' + esc(st.parentRepo) + '</b>, no sobre esta carpeta.</p><p>Elige la carpeta raíz de ese repositorio (✎ Editar proyecto), o crea uno propio aquí con ' + cmdBtn('git init') + '.</p></div>';
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
      if (S.remoteUrl && o && !sameRepo(st.origin, S.remoteUrl)) p.push(pill('⚠ origin no es el GitHub de este proyecto', 'warn', null, 'El origin de esta carpeta es ' + st.origin));
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
      youAreAt: st.unborn ? null : st.headSha,
      youAreOn: st.branch || null,
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
    // Si cambian los push o el punto donde estás (un commit nuevo, otra rama), se actualiza también el dibujo de GitHub.
    if (S.remote && S.remote.ok && !S.remote.empty && pushSig() !== S.remotePushSig) renderRemote();
    return st;
  }

  // ---------------------------------------------------------------- elegir, cambiar y borrar proyectos
  /** Pone en pantalla el proyecto activo: su GitHub arriba a la izquierda y su carpeta local a la derecha. */
  async function applyProject() {
    const p = curProject();
    renderProjectBar();
    const jobs = [];
    if (p && p.url) jobs.push(showRemote(p.url, { fetch: true })); else clearRemote();
    jobs.push(refreshLocal());
    await Promise.all(jobs);
    renderProjectInfo();
  }

  async function selectProject(id) {
    closeMenu();
    const r = await api.selectProject(id || null);
    if (r.error) { toast(r.error, true); return; }
    S.data = r.data;
    S.cwd = r.cwd;
    S.missingLocal = !!r.missingLocal;
    await applyProject();
  }

  async function stepProject(delta) {
    const list = S.data.projects;
    if (!list.length) return;
    const cur = curProject();
    const i = cur ? list.indexOf(cur) : (delta > 0 ? -1 : 0);
    await selectProject(list[(i + delta + list.length) % list.length].id);
  }

  async function deleteProject(id) {
    const p = S.data.projects.find((x) => x.id === id);
    if (!p) return;
    closeMenu();
    const ok = await confirmBox({
      title: 'Quitar proyecto',
      html: '<p>¿Quitar el proyecto <code>' + esc(p.name) + '</code> de la lista?</p>' +
        '<p class="safe">No se borra nada en GitHub ni en tu ordenador: ni el repositorio ni la carpeta.</p>',
      ok: 'Quitar', danger: true,
    });
    if (!ok) return;
    const idx = S.data.projects.indexOf(p);
    const wasSelected = p.id === S.data.selected.project;
    const r = await api.removeProject(id);
    if (r.error) { toast(r.error, true); return; }
    S.data = r.data;
    S.cwd = r.cwd;
    toast('Proyecto quitado de la lista: ' + p.name);
    if (!wasSelected) { renderProjectBar(); return; }
    const next = S.data.projects[Math.min(idx, S.data.projects.length - 1)];
    if (next) await selectProject(next.id);
    else { S.missingLocal = false; await applyProject(); }
  }

  // ---------------------------------------------------------------- consola
  let nextId = 1;
  let currentRun = null;
  const endWaiters = new Map(); // id del comando -> función que avisa de que ya llegó toda su salida

  const WELCOME = '👋 <b>Bienvenido a GitHelper.</b> Esta consola trabaja en la <b>carpeta local del proyecto activo</b> (arriba, en «Proyectos activos»).<br>' +
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
      const ended = new Promise((resolve) => { endWaiters.set(id, resolve); });
      let r;
      try { r = await api.run(id, cmd.argv, cmd.redirect); } catch (e) { r = { code: 1, error: String(e) }; }
      // Se espera al aviso de «terminado» (llega por el mismo canal que el texto, en orden); el plazo es solo por si algo fallara.
      await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, 3000))]);
      endWaiters.delete(id);
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

  const fitGraphs = () => { if (remoteView) remoteView.fit(); if (localView) localView.fit(); };

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
          fitGraphs();
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
    window.addEventListener('resize', fitGraphs);
    document.addEventListener('mouseup', syncHeads);
    syncHeads();

    // proyectos activos
    $('project-btn').addEventListener('click', toggleMenu);
    $('btn-project-new').addEventListener('click', () => openForm(null));
    $('btn-project-prev').addEventListener('click', () => stepProject(-1));
    $('btn-project-next').addEventListener('click', () => stepProject(1));
    $('project-items').addEventListener('click', (e) => {
      const row = e.target.closest('.pm-item');
      if (!row) return;
      const id = row.getAttribute('data-id');
      if (e.target.closest('.pm-del')) deleteProject(id);
      else if (e.target.closest('.pm-edit')) openForm(id);
      else selectProject(id);
    });
    document.addEventListener('mousedown', (e) => {
      if (!$('project-menu').hidden && !e.target.closest('.pm-wrap')) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('pform').hidden) closeForm();
      else if (!$('project-menu').hidden) closeMenu();
    });
    $('pform-card').addEventListener('submit', (e) => { e.preventDefault(); submitForm(); });
    $('pf-cancel').addEventListener('click', closeForm);
    $('pf-browse').addEventListener('click', async () => {
      const r = await api.chooseFolder();
      if (r && r.path) { $('pf-local').value = r.path; await suggestFromFolder(); }
    });
    $('pf-local').addEventListener('change', suggestFromFolder);
    $('pform').addEventListener('mousedown', (e) => { if (e.target === $('pform')) closeForm(); });

    // información del proyecto activo
    $('btn-remote-web').addEventListener('click', async () => {
      const p = curProject();
      const info = p && p.url ? parse(p.url) : null;
      if (!info || !info.web) { toast('Este proyecto no tiene dirección de GitHub.', true); return; }
      const r = await api.openExternal(info.web);
      if (r && r.error) toast(r.error, true);
    });
    $('btn-folder').addEventListener('click', async () => {
      const r = await api.openFolder();
      if (r && r.error) toast(r.error, true);
    });
    $('btn-remote-refresh').addEventListener('click', () => {
      if (!S.remoteUrl) { toast('El proyecto activo no tiene dirección de GitHub.', true); return; }
      showRemote(S.remoteUrl, { fetch: true });
    });

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
    api.onTermEnd((d) => { const f = endWaiters.get(d.id); if (f) f(); });
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
    S.missingLocal = !!r.missingLocal;
    S.e2e = !!r.e2e;
    S.version = r.version;
    S.gitAvailable = r.gitAvailable;
    S.ghAvailable = r.ghAvailable;
    await applyProject();
    if (!S.gitAvailable) term.error('No encuentro git.exe. Instala «Git for Windows» (git-scm.com/download/win) y vuelve a abrir GitHelper.');
    else if (!S.ghAvailable) term.note('Aviso: no encuentro «gh» (GitHub CLI). Los comandos «gh» no funcionarán hasta que lo instales (cli.github.com); con git ya puedes subir a GitHub.');
    term.focus();
    window.__gh = { S, runLine, refreshLocal, showRemote, selectProject, term, ready: true };
  }

  init();
})();
