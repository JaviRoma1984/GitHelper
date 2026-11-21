/* GitHelper · Lista desplegable de órdenes de Git y GitHub: al pulsar una, se copia en la consola. */
(function () {
  'use strict';
  const GH = (window.GH = window.GH || {});
  const esc = (s) => GH.Ansi.escapeHtml(String(s)).replace(/"/g, '&quot;');

  /** Escapa el comando y resalta los <huecos> que hay que rellenar. */
  function highlight(cmd) {
    return esc(cmd).replace(/&lt;([^&]+?)&gt;/g, '<span class="ph">&lt;$1&gt;</span>');
  }

  const CommandsView = {
    listEl: null,
    searchEl: null,
    countEl: null,
    onPick: null,
    openIds: new Set(['daily', 'remote']),

    init(o) {
      this.listEl = o.list;
      this.searchEl = o.search;
      this.countEl = o.count;
      this.onPick = o.onPick;
      this.searchEl.addEventListener('input', () => this.render());
      this.listEl.addEventListener('toggle', (e) => {
        const d = e.target;
        if (!d.matches || !d.matches('details.sec') || this.searching) return;
        if (d.open) this.openIds.add(d.dataset.id); else this.openIds.delete(d.dataset.id);
      }, true);
      this.listEl.addEventListener('click', (e) => {
        const row = e.target.closest('.crow');
        if (row && this.onPick) this.onPick(row.getAttribute('data-cmd'));
      });
      this.render();
    },

    render() {
      const q = this.searchEl.value;
      this.searching = !!q.trim();
      const sections = GH.Commands.filter(q);
      const shown = sections.reduce((n, s) => n + s.items.length, 0);
      this.countEl.textContent = this.searching ? shown + ' de ' + GH.Commands.total() : GH.Commands.total() + ' órdenes';
      if (!sections.length) {
        this.listEl.innerHTML = '<div class="no-results">Ninguna orden coincide con «' + esc(q) + '».</div>';
        return;
      }
      this.listEl.innerHTML = sections.map((s) => {
        const open = this.searching || this.openIds.has(s.id);
        return '<details class="sec" data-id="' + esc(s.id) + '"' + (open ? ' open' : '') + '><summary>' +
          '<span>' + s.icon + '</span><span>' + esc(s.title) + '</span><span class="count">' + s.items.length + '</span></summary>' +
          s.items.map((it) =>
            '<div class="crow" data-cmd="' + esc(it.c) + '" title="Clic: copiar en la consola">' +
              '<code class="cc">' + highlight(it.c) + '</code>' +
              '<div class="cd">' + esc(it.d) + '</div>' +
              (it.w ? '<div class="cw">⚠ ' + esc(it.w) + '</div>' : '') +
            '</div>').join('') +
          '</details>';
      }).join('');
    },
  };

  GH.CommandsView = CommandsView;
})();
