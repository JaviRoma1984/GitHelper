/* GitHelper · Visualizador de ramas: pinta en SVG el modelo calculado por graph.js.
 * Hay dos instancias: la de GitHub (mode «remote») y la del ordenador (mode «local»). */
(function () {
  'use strict';
  const GH = (window.GH = window.GH || {});
  const G = GH.Graph;
  const esc = (s) => GH.Ansi.escapeHtml(String(s)).replace(/"/g, '&quot;');
  const truncate = (s, max) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

  function chipWidth(chip) {
    if (chip.kind === 'head') return 46;
    return Math.max(36, Math.round(chip.label.length * 7.3 + 20));
  }

  function chipTitle(chip, mode) {
    switch (chip.kind) {
      case 'branch':
        if (mode === 'remote') return 'Rama «' + chip.name + '» en GitHub' + (chip.head ? ' (la principal del repositorio)' : '') + '\nClic: pegar «git switch ' + chip.name + '» en la consola';
        return 'Rama «' + chip.name + '»' + (chip.head ? ' (aquí estás tú)' : '\nClic: pegar «git switch ' + chip.name + '» en la consola');
      case 'remote':
        return 'Rama «' + chip.name + '» en GitHub, tal como la recuerda tu Git (se actualiza con git fetch)\nClic: pegar «git switch ' + chip.name.replace(/^[^/]+\//, '') + '»';
      case 'tag':
        return 'Etiqueta «' + chip.name + '»\nClic: pegar «git show ' + chip.name + '»';
      case 'head':
        return mode === 'remote'
          ? 'La rama principal del repositorio en GitHub'
          : (chip.detached ? 'HEAD separado: estás mirando un commit suelto, no una rama' : 'HEAD: el punto donde estás ahora mismo');
      default:
        return (chip.hidden || []).join(', ');
    }
  }

  function nodeTitle(n) {
    const when = n.ts ? new Date(n.ts * 1000).toLocaleString('es-ES') : '';
    return n.short + ' · ' + n.subject + '\n' + n.author + (when ? ' · ' + when : '') +
      (n.isMerge ? '\nCommit de fusión (tiene ' + n.parents.length + ' padres)' : '') +
      '\nClic: pegar «git show ' + n.short + '» en la consola';
  }

  const HERE_PAD = G.HERE_PAD; // cuánto baja el texto del commit donde se está, para dejar sitio a la flecha y a su «Posición actual»

  /** viewW: ancho del dibujo (nunca menos que el del panel, para que la línea de main llegue hasta el borde derecho). */
  function buildSvg(model, mode, viewW) {
    const W = Math.max(model.width, viewW || 0);
    const nodes = new Map(model.nodes.map((n) => [n.sha, n]));
    const color = (i) => G.colorFor(i); // un color distinto por rama (más allá de la paleta fija se generan otros)
    // Las etiquetas de rama llevan el color de SU rama, aunque estén sobre un punto que pertenece a otra (p. ej. «develop» sobre un commit de main).
    const bc = model.branchColors || {};
    const chipColor = (chip, n) => {
      if (chip.kind !== 'branch' && chip.kind !== 'remote') return color(n.colorIdx);
      const local = chip.kind === 'remote' ? chip.name.replace(/^[^/]+\//, '') : chip.name;
      const idx = bc[local] !== undefined ? bc[local] : bc[chip.name];
      return color(idx !== undefined ? idx : n.colorIdx);
    };
    // La rama en la que se está: su línea se dibuja más gruesa.
    const isHereBranch = (name) => !!(model.here && model.here.branch && model.here.branch === name);
    let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + model.height + '" viewBox="0 0 ' + W + ' ' + model.height + '">';

    for (let l = 0; l < model.lanes; l++) {
      const y = model.top + l * G.LANE_H;
      s += '<line class="g-lane" x1="10" y1="' + y + '" x2="' + W + '" y2="' + y + '"/>';
    }

    // La rama principal: una línea larga que recorre todo el dibujo, en paralelo al avance de las demás ramas.
    if (model.rail) {
      const r = model.rail;
      const x2 = W - 22;
      const c = color(r.colorIdx);
      const behind = r.lastX > r.tipX;
      s += '<g class="g-rail' + (isHereBranch(r.name) ? ' here' : '') + '" data-branch="' + esc(r.name) + '"><title>' + esc('«' + r.name + '», la rama principal' + (behind ? ': no tiene commits nuevos desde su último punto, pero otras ramas han seguido avanzando' : '')) + '</title>' +
        '<path class="g-rail-line" d="M' + r.x1 + ' ' + r.y + ' L' + r.tipX + ' ' + r.y + '" stroke="' + c + '"/>' +
        '<path class="g-rail-ext" d="M' + r.tipX + ' ' + r.y + ' L' + (x2 - 6) + ' ' + r.y + '" stroke="' + c + '"/>' +
        '<polygon class="g-rail-arrow" points="' + (x2 - 12) + ',' + (r.y - 7) + ' ' + x2 + ',' + r.y + ' ' + (x2 - 12) + ',' + (r.y + 7) + '" fill="' + c + '"/>' +
        '<text class="g-rail-label" style="fill:' + c + '" x="' + (x2 - 18) + '" y="' + (r.y - 12) + '" text-anchor="end">' + esc(r.name) + '</text></g>';
    }

    // El resto de ramas: cada una, una línea larga en su carril, igual que main (más tenue después de su último commit).
    (model.rails || []).forEach((r) => {
      const x2 = W - 22;
      const c = color(r.colorIdx);
      const tip = r.virtual
        ? 'Rama «' + r.name + '»: todavía no tiene commits propios (apunta al mismo commit que otra rama), pero sigue ahí, en paralelo'
        : 'Rama «' + r.name + '»: sigue en paralelo al resto';
      s += '<g class="g-rail g-rail-branch' + (r.virtual ? ' virtual' : '') + (isHereBranch(r.name) ? ' here' : '') + '" data-branch="' + esc(r.name) + '"><title>' + esc(tip) + '</title>';
      if (r.virtual) s += '<path class="g-edge" d="' + G.edgePath({ kind: 'fork' }, r.anchor, { x: r.tipX, y: r.y }) + '" stroke="' + c + '"/>';
      s += '<path class="g-rail-ext" d="M' + r.tipX + ' ' + r.y + ' L' + (x2 - 6) + ' ' + r.y + '" stroke="' + c + '"/>' +
        '<polygon class="g-rail-arrow" points="' + (x2 - 12) + ',' + (r.y - 7) + ' ' + x2 + ',' + r.y + ' ' + (x2 - 12) + ',' + (r.y + 7) + '" fill="' + c + '"/>' +
        '<text class="g-rail-label" style="fill:' + c + '" x="' + (x2 - 18) + '" y="' + (r.y - 12) + '" text-anchor="end">' + esc(r.name) + '</text></g>';
    });

    model.edges.forEach((e) => {
      const from = nodes.get(e.from);
      const to = nodes.get(e.to);
      if (!from || !to) return;
      s += '<path class="g-edge" d="' + G.edgePath(e, from, to) + '" stroke="' + color(e.colorIdx) + '"/>';
    });

    if (model.pending) {
      const p = model.pending;
      const bad = p.conflicts > 0 ? ' bad' : '';
      const label = p.conflicts > 0 ? p.conflicts + ' en conflicto' : p.count + (p.count === 1 ? ' cambio sin guardar' : ' cambios sin guardar');
      const tip = p.count + ' archivo(s) con cambios que todavía no están en el historial' + (p.staged ? ' (' + p.staged + ' ya preparados con git add)' : '');
      if (p.ring) {
        s += '<g><title>' + esc(tip) + '</title><circle class="g-pend' + bad + '" cx="' + p.x + '" cy="' + p.y + '" r="17"/>' +
          '<text class="g-pend-text' + bad + '" x="' + p.x + '" y="' + (p.y + 50) + '" text-anchor="middle">' + esc(label) + '</text></g>';
      } else {
        const from = nodes.get(p.fromSha);
        s += '<g><title>' + esc(tip) + '</title><path class="g-pend-edge' + bad + '" d="M' + from.x + ' ' + from.y + ' L' + p.x + ' ' + p.y + '"/>' +
          '<circle class="g-pend' + bad + '" cx="' + p.x + '" cy="' + p.y + '" r="9"/>' +
          '<text class="g-pend-text' + bad + '" x="' + p.x + '" y="' + (p.y + 28) + '" text-anchor="middle">' + esc(label) + '</text></g>';
      }
    }

    model.nodes.forEach((n) => {
      const c = color(n.colorIdx);
      s += '<g class="g-node" data-sha="' + esc(n.sha) + '"><title>' + esc(nodeTitle(n)) + '</title>';
      if (n.isMerge) {
        const r = 12;
        s += '<polygon class="g-shape" fill="' + c + '" points="' + n.x + ',' + (n.y - r) + ' ' + (n.x + r) + ',' + n.y + ' ' + n.x + ',' + (n.y + r) + ' ' + (n.x - r) + ',' + n.y + '"/>';
      } else {
        s += '<circle class="g-shape" fill="' + c + '" cx="' + n.x + '" cy="' + n.y + '" r="' + G.NODE_R + '"/>';
      }
      if (n.isHead) s += '<circle class="g-head-ring" cx="' + n.x + '" cy="' + n.y + '" r="' + (n.isMerge ? 17 : 15) + '"/>';
      // En el commit donde se está, el texto baja para dejar sitio a la flecha de «estás aquí».
      const dy = model.here && model.here.sha === n.sha ? HERE_PAD : 0;
      s += '<text class="g-sha" x="' + n.x + '" y="' + (n.y + 30 + dy) + '" text-anchor="middle">' + esc(n.short) + '</text>';
      s += '<text class="g-msg" x="' + n.x + '" y="' + (n.y + 45 + dy) + '" text-anchor="middle">' + esc(truncate(n.subject, 14)) + '</text>';
      s += '</g>';
    });

    model.nodes.forEach((n) => {
      n.chips.forEach((chip, i) => {
        const w = chipWidth(chip);
        const cy = n.y - (n.isMerge ? 14 : G.NODE_R) - 9 - G.CHIP_H / 2 - i * G.CHIP_STEP - (n.isHead ? 4 : 0);
        const cls = 'chip chip-' + chip.kind + (chip.head ? ' is-head' : '') + (chip.detached ? ' detached' : '');
        s += '<g class="' + cls + '"' + (chip.kind === 'tag' ? '' : ' style="--c:' + chipColor(chip, n) + '"') + ' data-chip="' + chip.kind + '" data-name="' + esc(chip.name) + '" transform="translate(' + n.x + ' ' + cy + ')">' +
          '<title>' + esc(chipTitle(chip, mode)) + '</title>' +
          '<rect x="' + (-w / 2) + '" y="' + (-G.CHIP_H / 2) + '" width="' + w + '" height="' + G.CHIP_H + '" rx="10"/>' +
          '<text y="1" text-anchor="middle" dominant-baseline="central">' + esc(chip.label) + '</text></g>';
      });
    });
    // «Estás aquí»: una flecha de abajo hacia arriba, desde debajo del commit donde se está trabajando, con el color de SU rama.
    if (model.here) {
      const h = model.here;
      const hn = nodes.get(h.sha);
      const idx = h.branch && bc[h.branch] !== undefined ? bc[h.branch] : (hn ? hn.colorIdx : 0);
      const c = color(idx);
      const tipY = h.y + 19;
      // El texto va debajo de la flecha, centrado. Si el commit exacto no está en el dibujo (aún sin subir a GitHub), se dice hasta dónde llega la rama.
      const label = h.exact ? 'Posición actual' : 'Tu rama llega hasta aquí';
      const tip = h.exact
        ? 'Estás aquí' + (h.branch ? ', trabajando en la rama «' + h.branch + '»' : '') + (mode === 'remote' ? ' (según tu carpeta local)' : '')
        : 'Tu rama «' + h.branch + '» llega hasta este punto en GitHub; tu carpeta local tiene commits más nuevos que aún no has subido';
      s += '<g class="g-here" style="--c:' + c + '"><title>' + esc(tip) + '</title>' +
        '<rect class="g-here-stem" x="' + (h.x - 2.5) + '" y="' + (tipY + 11) + '" width="5" height="26" rx="2"/>' +
        '<polygon class="g-here-head" points="' + (h.x - 9) + ',' + (tipY + 13) + ' ' + h.x + ',' + tipY + ' ' + (h.x + 9) + ',' + (tipY + 13) + '"/>' +
        '<text class="g-here-label" x="' + h.x + '" y="' + (tipY + 55) + '" text-anchor="middle">' + esc(label) + '</text></g>';
    }
    // Marcas de push: una chapa verde con una flecha hacia arriba junto al commit que quedó como punta de la rama al subirla a GitHub.
    (model.pushMarks || []).forEach((m, i) => {
      const cx = m.x + 28; // a la derecha del punto, sobre su línea (así no tapa las etiquetas de rama que van encima)
      const cy = m.y;
      s += '<g class="g-push" data-push="' + i + '"><circle cx="' + cx + '" cy="' + cy + '" r="9"/>' +
        '<path d="M' + cx + ' ' + (cy + 4.2) + ' V' + (cy - 4.2) + ' M' + (cx - 3.8) + ' ' + (cy - 0.4) + ' L' + cx + ' ' + (cy - 4.4) + ' L' + (cx + 3.8) + ' ' + (cy - 0.4) + '"/></g>';
    });
    return s + '</svg>';
  }

  // ---- ventana emergente (la de los push) ----
  const two = (n) => String(n).padStart(2, '0');
  const fmtDate = (ts) => {
    const d = new Date(ts * 1000);
    return two(d.getDate()) + '-' + two(d.getMonth() + 1) + '-' + d.getFullYear() + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  };

  /** Texto de la ventana: qué se subió en cada push que acabó en este commit. */
  function pushHtml(mark) {
    return mark.items.map((it) => {
      const what = it.isNew
        ? 'Rama nueva en GitHub' + (it.count ? ': ' + it.count + (it.count === 1 ? ' commit propio' : ' commits propios') : '')
        : (it.partial ? 'Se subieron commits (el punto de partida queda fuera del dibujo; se enseñan los últimos)' : 'Se ' + (it.count === 1 ? 'subió 1 commit' : 'subieron ' + it.count + ' commits'));
      const list = it.commits.map((c) => '<li><code>' + esc(c.short) + '</code> ' + esc(c.subject || '(sin mensaje)') + '</li>').join('') +
        (it.more ? '<li class="more">… y ' + it.more + ' más</li>' : '');
      return '<div class="tip-item"><div class="tip-head">⬆ Push a <b>' + esc(it.ref) + '</b></div>' +
        '<div class="tip-meta">' + esc(fmtDate(it.ts)) + (it.who ? ' · ' + esc(it.who) : '') + '</div>' +
        '<div class="tip-what">' + esc(what) + '</div>' + (list ? '<ul>' + list + '</ul>' : '') + '</div>';
    }).join('');
  }

  function tipEl() { return document.getElementById('tip'); }
  function moveTip(ev) {
    const t = tipEl();
    if (!t || t.hidden) return;
    const pad = 14;
    let x = ev.clientX + pad;
    let y = ev.clientY + pad + 4;
    const r = t.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = Math.max(8, ev.clientX - r.width - pad);
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, ev.clientY - r.height - pad);
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }
  function showTip(html, ev) {
    const t = tipEl();
    if (!t) return;
    t.innerHTML = html;
    t.hidden = false;
    moveTip(ev);
  }
  function hideTip() {
    const t = tipEl();
    if (t) t.hidden = true;
  }

  class GraphView {
    /** @param {{el:HTMLElement, scroller:HTMLElement, mode:'remote'|'local', handlers?:object}} o */
    constructor(o) {
      this.el = o.el;
      this.scroller = o.scroller;
      this.mode = o.mode;
      this.handlers = o.handlers || {};
      this.model = null;
      this.last = null;
      this.viewW = 0;
      this.lastKey = null;
      // Si cambia el ancho del panel (ventana o separador), se vuelve a dibujar para que la línea de main siga llegando hasta el borde.
      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => this.fit()).observe(this.scroller);
      }
      this.el.addEventListener('click', (e) => {
        const cmd = e.target.closest('[data-cmd]');
        if (cmd) { this.handlers.onCmd && this.handlers.onCmd(cmd.getAttribute('data-cmd')); return; }
        const chip = e.target.closest('[data-chip]');
        if (chip) { this.handlers.onChip && this.handlers.onChip(chip.getAttribute('data-chip'), chip.getAttribute('data-name'), this.mode); return; }
        const node = e.target.closest('[data-sha]');
        if (node) this.handlers.onNode && this.handlers.onNode(this.model && this.model.nodes.find((n) => n.sha === node.getAttribute('data-sha')), this.mode);
      });
      // Al poner el puntero sobre la marca de un push, se enseña qué se subió.
      this.el.addEventListener('mouseover', (e) => {
        const g = e.target.closest && e.target.closest('.g-push');
        const mark = g && this.model && this.model.pushMarks ? this.model.pushMarks[parseInt(g.getAttribute('data-push'), 10)] : null;
        if (mark) showTip(pushHtml(mark), e);
      });
      this.el.addEventListener('mousemove', moveTip);
      this.el.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('.g-push')) hideTip(); });
    }

    /** Ajusta el ancho del dibujo al del panel (para que la línea de main llegue siempre hasta el borde derecho). */
    fit() {
      if (!this.last || !this.model) return;
      const w = Math.max(this.model.width, this.scroller.clientWidth - 14);
      if (Math.abs(w - this.viewW) > 2) this.render(this.last.commits, this.last.opts);
    }

    /** Mensajes (vacío, cargando, error…) en lugar del dibujo. */
    showHtml(html) {
      hideTip();
      this.model = null;
      this.last = null;
      this.lastKey = null;
      this.el.innerHTML = html;
    }

    /** @param {object[]} commits  @param {{currentBranch?:string, headSha?:string, pending?:object}} opts */
    render(commits, opts) {
      this.last = { commits, opts };
      const model = G.buildGraph(commits, opts || {});
      this.model = model;
      const prevLeft = this.scroller.scrollLeft;
      const prevTop = this.scroller.scrollTop;
      this.viewW = Math.max(model.width, this.scroller.clientWidth - 14);
      this.el.innerHTML = buildSvg(model, this.mode, this.viewW);
      this.scroller.scrollLeft = prevLeft;
      this.scroller.scrollTop = prevTop;
      // Si HEAD ha cambiado (nuevo commit, cambio de rama, otro repositorio), nos aseguramos de que se vea.
      const head = model.nodes.find((n) => n.sha === model.headSha) || model.nodes[0];
      const key = head ? head.sha : null;
      if (head && (key !== this.lastKey || !this.isVisible(head))) this.reveal(head, model.pending);
      this.lastKey = key;
    }

    isVisible(node) {
      const s = this.scroller;
      return node.x > s.scrollLeft + 50 && node.x < s.scrollLeft + s.clientWidth - 140 &&
        node.y > s.scrollTop + 20 && node.y < s.scrollTop + s.clientHeight - 50;
    }

    reveal(node, pending) {
      const s = this.scroller;
      const targetX = (pending && !pending.ring ? pending.x : node.x);
      s.scrollLeft = Math.max(0, targetX - s.clientWidth * 0.65);
      // Se mira desde arriba (así main y las primeras ramas siguen a la vista) y solo se baja lo justo para ver el punto y su texto.
      const extra = this.model && this.model.here && this.model.here.sha === node.sha ? G.HERE_PAD : 0; // la flecha y su texto van debajo del commit
      s.scrollTop = Math.max(0, node.y + 70 + extra - s.clientHeight);
    }
  }

  GH.GraphView = GraphView;
})();
