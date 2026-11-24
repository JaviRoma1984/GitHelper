/* GitHelper · Cálculo del dibujo de ramas (sin DOM, se puede probar desde Node).
 *
 * Entrada: commits ordenados del más nuevo al más viejo (orden topológico: los hijos antes que los padres).
 *   { sha, parents:[sha], subject, author, ts, refs:[{type:'branch'|'remote'|'tag', name, head}], headDetached }
 * Salida: nodos con posición (x,y), aristas y medidas del dibujo.
 *
 * Reglas del dibujo:
 *   - El tiempo avanza de izquierda a derecha (un commit por columna).
 *   - «main» (o master) siempre es el carril de arriba.
 *   - Cada rama va en su propio carril. Un carril se reutiliza solo cuando la rama anterior ya acabó.
 *   - Los commits que pertenecen a ramas ya borradas (solo se llega a ellos por una fusión) también tienen carril.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.GH = root.GH || {}).Graph = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COL_W = 92;
  const LANE_H = 100;
  const PAD_LEFT = 64;
  const PAD_RIGHT = 160;
  const NODE_R = 9;
  const CHIP_H = 19;
  const CHIP_STEP = 22;
  const HERE_PAD = 64; // sitio para la flecha de «Posición actual» (y su texto) bajo el commit donde se está
  const MAX_CHIPS = 6; // etiquetas apiladas sobre un mismo punto (rama, su copia en GitHub, develop, etiqueta de versión, HEAD…)
  const MAX_CHIP_CHARS = 13;
  const PALETTE = ['#58a6ff', '#f0883e', '#bc8cff', '#3fb950', '#ff7b72', '#e3b341', '#56d4dd', '#f778ba'];
  const TRUNK_NAMES = ['main', 'master', 'trunk', 'develop'];

  /** Color de la rama número i: los de la paleta y, si hay más ramas que colores, otros generados con el «ángulo áureo» (siempre distintos). */
  function colorFor(i) {
    if (i < PALETTE.length) return PALETTE[i];
    return 'hsl(' + Math.round(((i * 137.508) + 20) % 360) + ' 68% 64%)';
  }

  const short = (name) => (name.length > MAX_CHIP_CHARS ? name.slice(0, MAX_CHIP_CHARS - 1) + '…' : name);

  function chipsFor(commit) {
    const refs = commit.refs || [];
    const chips = [];
    // De abajo (junto al nodo) hacia arriba: etiquetas, ramas remotas, otras ramas, la rama actual y, encima, HEAD.
    refs.filter((r) => r.type === 'tag').forEach((r) => chips.push({ kind: 'tag', name: r.name, label: short(r.name) }));
    refs.filter((r) => r.type === 'remote').forEach((r) => chips.push({ kind: 'remote', name: r.name, label: short(r.name) }));
    refs.filter((r) => r.type === 'branch' && !r.head).forEach((r) => chips.push({ kind: 'branch', name: r.name, label: short(r.name), head: false }));
    refs.filter((r) => r.type === 'branch' && r.head).forEach((r) => chips.push({ kind: 'branch', name: r.name, label: short(r.name), head: true }));
    if (refs.some((r) => r.head) || commit.headDetached) {
      chips.push({ kind: 'head', name: 'HEAD', label: 'HEAD', detached: !!commit.headDetached });
    }
    if (chips.length > MAX_CHIPS) {
      const extra = chips.length - (MAX_CHIPS - 1);
      const kept = chips.slice(0, MAX_CHIPS - 1);
      kept.push({ kind: 'more', name: '+' + extra, label: '+' + extra, hidden: chips.slice(MAX_CHIPS - 1).map((c) => c.name) });
      return kept;
    }
    return chips;
  }

  function buildGraph(commits, opts) {
    opts = opts || {};
    const total = commits.length;
    if (!total) return { empty: true, nodes: [], edges: [], width: 0, height: 0, palette: PALETTE, lanes: 0 };

    const info = new Map();
    commits.forEach((c, i) => info.set(c.sha, { c, sha: c.sha, col: total - 1 - i, seg: null, lane: 0 }));

    const children = new Map();
    commits.forEach((c) => {
      c.parents.forEach((p) => {
        if (!info.has(p)) return;
        if (!children.has(p)) children.set(p, []);
        children.get(p).push(info.get(c.sha));
      });
    });

    // ---- puntas de rama ----
    const localTips = [];
    const remoteTips = [];
    commits.forEach((c) => {
      (c.refs || []).forEach((r) => {
        if (r.type === 'branch') localTips.push({ name: r.name, sha: c.sha, col: info.get(c.sha).col, head: !!r.head });
        else if (r.type === 'remote') remoteTips.push({ name: r.name, sha: c.sha, col: info.get(c.sha).col });
      });
    });
    const detached = commits.find((c) => c.headDetached);

    let trunk = null;
    for (const nm of TRUNK_NAMES) {
      trunk = localTips.find((t) => t.name === nm);
      if (trunk) break;
    }
    if (!trunk && opts.currentBranch) trunk = localTips.find((t) => t.name === opts.currentBranch) || null;
    if (!trunk && localTips.length) trunk = localTips.slice().sort((a, b) => a.name.localeCompare(b.name))[0];

    const byAge = (a, b) => a.col - b.col || a.name.localeCompare(b.name);
    const order = [];
    order.push(trunk ? { name: trunk.name, sha: trunk.sha } : { name: null, sha: commits[0].sha });
    localTips.filter((t) => t !== trunk).sort(byAge).forEach((t) => order.push({ name: t.name, sha: t.sha, local: true }));
    remoteTips.sort(byAge).forEach((t) => order.push({ name: t.name, sha: t.sha }));
    if (detached) order.push({ name: 'HEAD', sha: detached.sha });

    // ---- tramos: cada tramo sigue el «primer padre» desde la punta hasta chocar con otro ya reservado ----
    const segs = [];
    const walk = (startSha, name) => {
      const start = info.get(startSha);
      if (!start || start.seg) return null;
      const seg = { name, nodes: [], lane: 0, colorIdx: 0, start: 0, end: 0 };
      let cur = start;
      while (cur && !cur.seg) {
        cur.seg = seg;
        seg.nodes.push(cur);
        const p = cur.c.parents[0];
        cur = p ? info.get(p) : null;
      }
      segs.push(seg);
      return seg;
    };
    // Cada rama (distinta de main) es una línea larga como la de main. Si la rama tiene commits propios, es su tramo; si apunta a un commit
    // que ya pertenece a otra rama (p. ej. «develop» recién creada desde main, sin commits nuevos), tendría que quedarse sin línea: por eso
    // se le crea un tramo «virtual» anclado a ese commit, con su propio carril.
    // Ramas que git ya da por fusionadas en la principal aunque no dejaran un commit de fusión (fast-forward, rebase, cherry-pick):
    // vienen de fuera (opts.mergedBranches) y solo valen si la punta de la principal es la misma con la que se calcularon
    // (así el dibujo de GitHub no cierra una rama hasta que la fusión también está subida).
    const trustMerged = !opts.mergedTrunkSha || (!!order[0] && order[0].sha === opts.mergedTrunkSha);
    const mergedSet = new Set(trustMerged ? (opts.mergedBranches || []) : []);
    const closedNames = []; // ramas fusionadas sin tramo propio: solo se ve su etiqueta sobre el commit donde quedaron
    const virtualSegs = [];
    order.forEach((t, i) => {
      const seg = walk(t.sha, t.name);
      if (!t.local || i === 0) return;
      if (seg) seg.isBranch = true; // rama con commits propios (si sigue abierta, más abajo se le pone la línea larga)
      else if (info.has(t.sha)) {
        if (mergedSet.has(t.name)) closedNames.push(t.name); // fusionada por fast-forward: su trabajo ya está en la línea de la principal
        else virtualSegs.push({ name: t.name, anchorSha: t.sha, virtual: true, nodes: [], lane: 0, colorIdx: 0, start: 0, end: 0 });
      }
    });
    // Commits a los que solo se llega por una fusión (ramas ya borradas).
    commits.forEach((c) => {
      if (!info.get(c.sha).seg) walk(c.sha, null);
    });
    const trunkSeg = info.get(order[0].sha).seg;

    // Una rama que ya se ha fusionado en su rama madre (su punta es antecesora de la punta de la madre) NO lleva línea larga:
    // se ve cómo sale, avanza y se cierra con la fusión. Las que siguen abiertas llevan la línea larga hasta el borde.
    // (Una rama sin commits propios, como una «develop» recién creada, no tiene recorrido que cerrar: siempre se ve abierta.)
    const ancestorCache = new Map();
    const ancestorsOf = (sha) => {
      if (ancestorCache.has(sha)) return ancestorCache.get(sha);
      const seen = new Set();
      const stack = [sha];
      while (stack.length) {
        const cur = stack.pop();
        if (seen.has(cur)) continue;
        seen.add(cur);
        const nd = info.get(cur);
        if (nd) nd.c.parents.forEach((p) => stack.push(p));
      }
      ancestorCache.set(sha, seen);
      return seen;
    };
    segs.forEach((s) => {
      if (!s.isBranch) return;
      const oldest = s.nodes[s.nodes.length - 1];
      const parent = oldest.c.parents[0] ? info.get(oldest.c.parents[0]) : null;
      // la rama madre: la del commit del que salió (si ese commit queda fuera de lo dibujado, se toma la principal)
      const parentSeg = parent ? parent.seg : trunkSeg;
      const tip = s.nodes[0].sha;
      // fusionada si su punta ya está en la historia de su madre o de la principal (fusión con commit), o si git la da por fusionada (mergedSet)
      const byHistory = (parentSeg && parentSeg !== s && ancestorsOf(parentSeg.nodes[0].sha).has(tip)) || (s !== trunkSeg && ancestorsOf(trunkSeg.nodes[0].sha).has(tip));
      s.merged = !!(byHistory || mergedSet.has(s.name));
      s.longLine = !s.merged;
    });

    // ---- carriles ----
    segs.forEach((seg) => {
      const oldest = seg.nodes[seg.nodes.length - 1];
      const fp = oldest.c.parents[0] ? info.get(oldest.c.parents[0]) : null;
      seg.start = fp ? Math.min(oldest.col, fp.col) : oldest.col;
      seg.end = seg.nodes[0].col;
      seg.nodes.forEach((nd) => {
        (children.get(nd.sha) || []).forEach((ch) => {
          if (ch.seg !== seg && ch.c.parents.indexOf(nd.sha) > 0) seg.end = Math.max(seg.end, ch.col);
        });
      });
    });
    // Las ramas con línea larga llegan hasta el borde derecho: ningún otro tramo puede compartir su carril más adelante.
    segs.forEach((s) => { if (s.longLine) { s.tipCol = s.nodes[0].col; s.end = Infinity; } });
    virtualSegs.forEach((v) => { v.start = info.get(v.anchorSha).col; v.end = Infinity; });
    trunkSeg.lane = 0;
    trunkSeg.colorIdx = 0;
    const laneUse = [[[trunkSeg.start, trunkSeg.end]]];
    const endCmp = (a, b) => (a.end === b.end ? 0 : a.end - b.end);
    const others = segs.filter((s) => s !== trunkSeg).concat(virtualSegs)
      .sort((a, b) => (a.start - b.start) || endCmp(a, b) || String(a.name || '').localeCompare(String(b.name || '')));
    others.forEach((seg, i) => {
      seg.colorIdx = 1 + i; // un color distinto para cada rama (colorFor genera más allá de la paleta fija)
      for (let k = 1; ; k++) {
        const used = laneUse[k] || (laneUse[k] = []);
        if (used.every((iv) => seg.start > iv[1] + 1 || seg.end < iv[0] - 1)) {
          used.push([seg.start, seg.end]);
          seg.lane = k;
          break;
        }
      }
    });
    const laneCount = laneUse.length;
    // Color de cada rama por su nombre (las etiquetas de rama usan el color de SU rama, aunque estén sobre un punto de otra).
    const branchColors = {};
    segs.forEach((s) => { if (s.name && !(s.name in branchColors)) branchColors[s.name] = s.colorIdx; });
    virtualSegs.forEach((v) => { branchColors[v.name] = v.colorIdx; });

    // ---- nodos ----
    const nodeList = [];
    let maxTopChips = 1;
    commits.forEach((c) => {
      const nd = info.get(c.sha);
      nd.lane = nd.seg.lane;
      nd.chips = chipsFor(c);
      if (nd.lane === 0) maxTopChips = Math.max(maxTopChips, nd.chips.length);
    });
    const top = 34 + CHIP_STEP * maxTopChips;
    commits.forEach((c) => {
      const nd = info.get(c.sha);
      nodeList.push({
        sha: c.sha,
        short: c.sha.slice(0, 7),
        subject: c.subject || '',
        author: c.author || '',
        ts: c.ts || 0,
        parents: c.parents,
        isMerge: c.parents.length > 1,
        col: nd.col,
        lane: nd.lane,
        x: PAD_LEFT + nd.col * COL_W,
        y: top + nd.lane * LANE_H,
        colorIdx: nd.seg.colorIdx,
        chips: nd.chips,
        isHead: !!(c.refs || []).some((r) => r.head) || !!c.headDetached,
      });
    });
    const nodeBySha = new Map(nodeList.map((n) => [n.sha, n]));

    // ---- aristas ----
    const edges = [];
    nodeList.forEach((child) => {
      child.parents.forEach((psha, idx) => {
        const parent = nodeBySha.get(psha);
        if (!parent) return;
        let kind = 'same';
        let colorIdx = child.colorIdx;
        if (parent.lane !== child.lane) {
          if (idx === 0) kind = 'fork';
          else { kind = 'merge'; colorIdx = parent.colorIdx; }
        }
        edges.push({ from: psha, to: child.sha, kind, colorIdx });
      });
    });

    // ---- cambios sin guardar (carpeta de trabajo) ----
    let pending = null;
    const head = opts.headSha ? nodeBySha.get(opts.headSha) : nodeList.find((n) => n.isHead);
    if (opts.pending && opts.pending.count > 0 && head) {
      const occupied = nodeList.some((n) => n.lane === head.lane && n.col === head.col + 1);
      pending = {
        count: opts.pending.count,
        staged: opts.pending.staged || 0,
        conflicts: opts.pending.conflicts || 0,
        ring: occupied,
        x: occupied ? head.x : head.x + COL_W,
        y: head.y,
        fromSha: head.sha,
      };
    }

    // ---- líneas largas del resto de ramas (una por rama local, cada una en su carril) ----
    const rails = [];
    segs.forEach((s) => {
      if (!s.longLine) return;
      const tipNode = nodeBySha.get(s.nodes[0].sha);
      rails.push({ name: s.name, lane: s.lane, y: top + s.lane * LANE_H, colorIdx: s.colorIdx, virtual: false, tipX: tipNode.x, anchor: null });
    });
    virtualSegs.forEach((v) => {
      const a = nodeBySha.get(v.anchorSha);
      rails.push({ name: v.name, lane: v.lane, y: top + v.lane * LANE_H, colorIdx: v.colorIdx, virtual: true, tipX: a.x + 54, anchor: { x: a.x, y: a.y, sha: a.sha } });
    });
    rails.sort((a, b) => a.lane - b.lane);

    // ---- marcas de push: dónde se subió algo a GitHub desde este ordenador (según el registro de git) ----
    // Cada push deja la punta de su rama en el commit «new»; los commits que se subieron son los que llegan a «new» y no a «old».
    const pushMarks = [];
    const marksBySha = new Map();
    const MAX_LISTED = 12;
    const ZERO = /^0+$/;
    (opts.pushes || []).forEach((p) => {
      const nd = nodeBySha.get(p.new);
      if (!nd) return; // ese commit ya no está en lo dibujado
      const isNew = ZERO.test(p.old || '0');
      const branchName = String(p.ref || '').replace(/^[^/]+\//, '');
      let list = [];
      let partial = false;
      if (isNew || info.has(p.old)) {
        // rama nueva: lo que tiene de más que la principal; si no, lo que hay entre el push anterior y este
        const had = isNew
          ? (trunk && branchName !== trunk.name ? ancestorsOf(trunkSeg.nodes[0].sha) : new Set())
          : ancestorsOf(p.old);
        const upTo = ancestorsOf(p.new);
        commits.forEach((c) => { if (upTo.has(c.sha) && !had.has(c.sha)) list.push(c); });
      } else {
        // el punto de partida queda fuera de lo dibujado (o se reescribió el historial): solo se enseñan los últimos commits
        partial = true;
        let cur = info.get(p.new);
        while (cur && list.length < 10) { list.push(cur.c); cur = cur.c.parents[0] ? info.get(cur.c.parents[0]) : null; }
      }
      const item = {
        ref: p.ref, ts: p.ts, who: p.who || '', old: p.old, new: p.new, isNew, partial,
        count: list.length,
        commits: list.slice(0, MAX_LISTED).map((c) => ({ short: c.sha.slice(0, 7), subject: c.subject || '', author: c.author || '' })),
        more: Math.max(0, list.length - MAX_LISTED),
      };
      let mark = marksBySha.get(p.new);
      if (!mark) { mark = { sha: p.new, x: nd.x, y: nd.y, items: [] }; marksBySha.set(p.new, mark); pushMarks.push(mark); }
      mark.items.push(item);
    });
    pushMarks.forEach((m) => m.items.sort((a, b) => b.ts - a.ts));

    // ---- raíl de la rama principal ----
    // «main» se dibuja como una línea larga que sigue de largo (en el carril de arriba) mientras las demás ramas avanzan en paralelo,
    // aunque main no tenga commits nuevos: así se ve de un vistazo cuánto se han alejado las ramas del tronco.
    let rail = null;
    // Solo si de verdad es la rama principal (main/master/…) o la rama actual: no se le pone el raíl a una rama cualquiera por orden alfabético.
    if (trunk && (TRUNK_NAMES.indexOf(trunk.name) >= 0 || trunk.name === opts.currentBranch)) {
      const onTrunk = nodeList.filter((n) => n.lane === 0);
      rail = {
        name: trunk.name,
        y: top,
        x1: Math.min.apply(null, onTrunk.map((n) => n.x)),
        tipX: Math.max.apply(null, onTrunk.map((n) => n.x)), // donde está el último commit de main
        lastX: Math.max.apply(null, nodeList.map((n) => n.x)), // donde llega la rama más avanzada
        colorIdx: 0,
      };
    }

    // ---- «estás aquí»: el punto donde se está (una flecha que apunta hacia arriba, desde debajo del commit) ----
    // opts.youAreAt = commit exacto donde se está (HEAD); opts.youAreOn = nombre de la rama en la que se está.
    // Si el commit exacto no está en este dibujo (p. ej. aún no se ha subido a GitHub) se señala hasta dónde llega la rama (exact:false).
    let here = null;
    if (opts.youAreAt && nodeBySha.has(opts.youAreAt)) {
      const nd = nodeBySha.get(opts.youAreAt);
      here = { sha: nd.sha, x: nd.x, y: nd.y, lane: nd.lane, branch: opts.youAreOn || null, exact: true };
    } else if (opts.youAreOn) {
      const t = order.find((o) => o.name === opts.youAreOn);
      const nd = t ? nodeBySha.get(t.sha) : null;
      if (nd) here = { sha: nd.sha, x: nd.x, y: nd.y, lane: nd.lane, branch: opts.youAreOn, exact: false };
    }

    const cols = total + (pending && !pending.ring ? 1 : 0);
    return {
      empty: false,
      nodes: nodeList,
      edges,
      rail,
      rails,
      branchColors,
      pushMarks,
      here,
      pending,
      lanes: laneCount,
      top,
      width: PAD_LEFT + (cols - 1) * COL_W + PAD_RIGHT,
      height: top + (laneCount - 1) * LANE_H + 96 + (here ? HERE_PAD : 0), // la flecha de «Posición actual» empuja hacia abajo el texto de ese commit
      palette: PALETTE,
      headSha: head ? head.sha : null,
      trunkName: trunk ? trunk.name : null,
      segments: segs.map((s) => ({ name: s.name, lane: s.lane, size: s.nodes.length, merged: !!s.merged })),
      mergedBranches: segs.filter((s) => s.merged && s.name).map((s) => s.name).concat(closedNames), // ramas dadas por fusionadas (sin línea al infinito)
    };
  }

  /** Trazado SVG de una arista entre dos nodos ya colocados. */
  function edgePath(edge, from, to) {
    const x1 = from.x, y1 = from.y, x2 = to.x, y2 = to.y;
    if (edge.kind === 'same') return 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2;
    const cw = Math.min(54, Math.max(12, x2 - x1));
    if (edge.kind === 'fork') {
      return 'M' + x1 + ' ' + y1 + ' C' + (x1 + cw * 0.55) + ' ' + y1 + ' ' + (x1 + cw * 0.45) + ' ' + y2 + ' ' + (x1 + cw) + ' ' + y2 + ' L' + x2 + ' ' + y2;
    }
    return 'M' + x1 + ' ' + y1 + ' L' + (x2 - cw) + ' ' + y1 + ' C' + (x2 - cw * 0.45) + ' ' + y1 + ' ' + (x2 - cw * 0.55) + ' ' + y2 + ' ' + x2 + ' ' + y2;
  }

  return { buildGraph, edgePath, colorFor, HERE_PAD, COL_W, LANE_H, PAD_LEFT, NODE_R, CHIP_H, CHIP_STEP, PALETTE };
});
