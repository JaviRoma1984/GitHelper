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

  function buildSvg(model, mode) {
    const nodes = new Map(model.nodes.map((n) => [n.sha, n]));
    const color = (i) => G.PALETTE[i % G.PALETTE.length];
    let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + model.width + '" height="' + model.height + '" viewBox="0 0 ' + model.width + ' ' + model.height + '">';

    for (let l = 0; l < model.lanes; l++) {
      const y = model.top + l * G.LANE_H;
      s += '<line class="g-lane" x1="10" y1="' + y + '" x2="' + model.width + '" y2="' + y + '"/>';
    }

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
      s += '<text class="g-sha" x="' + n.x + '" y="' + (n.y + 30) + '" text-anchor="middle">' + esc(n.short) + '</text>';
      s += '<text class="g-msg" x="' + n.x + '" y="' + (n.y + 45) + '" text-anchor="middle">' + esc(truncate(n.subject, 14)) + '</text>';
      s += '</g>';
    });

    model.nodes.forEach((n) => {
      n.chips.forEach((chip, i) => {
        const w = chipWidth(chip);
        const cy = n.y - (n.isMerge ? 14 : G.NODE_R) - 9 - G.CHIP_H / 2 - i * G.CHIP_STEP - (n.isHead ? 4 : 0);
        const cls = 'chip chip-' + chip.kind + (chip.head ? ' is-head' : '') + (chip.detached ? ' detached' : '');
        s += '<g class="' + cls + '"' + (chip.kind === 'tag' ? '' : ' style="--c:' + color(n.colorIdx) + '"') + ' data-chip="' + chip.kind + '" data-name="' + esc(chip.name) + '" transform="translate(' + n.x + ' ' + cy + ')">' +
          '<title>' + esc(chipTitle(chip, mode)) + '</title>' +
          '<rect x="' + (-w / 2) + '" y="' + (-G.CHIP_H / 2) + '" width="' + w + '" height="' + G.CHIP_H + '" rx="10"/>' +
          '<text y="1" text-anchor="middle" dominant-baseline="central">' + esc(chip.label) + '</text></g>';
      });
    });
    return s + '</svg>';
  }

  class GraphView {
    /** @param {{el:HTMLElement, scroller:HTMLElement, mode:'remote'|'local', handlers?:object}} o */
    constructor(o) {
      this.el = o.el;
      this.scroller = o.scroller;
      this.mode = o.mode;
      this.handlers = o.handlers || {};
      this.model = null;
      this.lastKey = null;
      this.el.addEventListener('click', (e) => {
        const cmd = e.target.closest('[data-cmd]');
        if (cmd) { this.handlers.onCmd && this.handlers.onCmd(cmd.getAttribute('data-cmd')); return; }
        const chip = e.target.closest('[data-chip]');
        if (chip) { this.handlers.onChip && this.handlers.onChip(chip.getAttribute('data-chip'), chip.getAttribute('data-name'), this.mode); return; }
        const node = e.target.closest('[data-sha]');
        if (node) this.handlers.onNode && this.handlers.onNode(this.model && this.model.nodes.find((n) => n.sha === node.getAttribute('data-sha')), this.mode);
      });
    }

    /** Mensajes (vacío, cargando, error…) en lugar del dibujo. */
    showHtml(html) {
      this.model = null;
      this.lastKey = null;
      this.el.innerHTML = html;
    }

    /** @param {object[]} commits  @param {{currentBranch?:string, headSha?:string, pending?:object}} opts */
    render(commits, opts) {
      const model = G.buildGraph(commits, opts || {});
      this.model = model;
      const prevLeft = this.scroller.scrollLeft;
      const prevTop = this.scroller.scrollTop;
      this.el.innerHTML = buildSvg(model, this.mode);
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
      s.scrollTop = Math.max(0, node.y - s.clientHeight * 0.55);
    }
  }

  GH.GraphView = GraphView;
})();
