/* GitHelper · Consola: salida con colores, historial, autocompletado con Tab. */
(function () {
  'use strict';
  const GH = (window.GH = window.GH || {});
  const esc = (s) => GH.Ansi.escapeHtml(String(s));
  const PLACEHOLDER = /<[^<>\s][^<>]*>/;
  const MAX_LINES = 900;
  const MAX_SAVED_CHARS = 300000; // tope de lo que se guarda de la consola con el proyecto

  class Terminal {
    constructor(opts) {
      this.out = opts.out;
      this.input = opts.input;
      this.promptEl = opts.prompt;
      this.onSubmit = opts.onSubmit;
      this.onCancel = opts.onCancel;
      this.complete = opts.complete;
      this.streams = new Map();
      this.busy = false;
      // El historial de comandos vive solo en memoria: se guarda en el ordenador únicamente con «Guardar proyecto».
      this.history = [];
      this.histIdx = 0;
      this.draft = '';
      this.input.addEventListener('keydown', (e) => this.onKey(e));
      this.out.addEventListener('mouseup', () => {
        // Si el usuario no está seleccionando texto, un clic en la consola devuelve el foco a la línea de comandos.
        if (!String(window.getSelection()).length) this.input.focus();
      });
    }

    setPrompt(text) { this.promptEl.textContent = text; }
    setBusy(b) { this.busy = b; this.input.classList.toggle('busy', b); }
    focus() { this.input.focus(); }

    nearBottom() { return this.out.scrollHeight - this.out.scrollTop - this.out.clientHeight < 90; }
    scrollEnd() { this.out.scrollTop = this.out.scrollHeight; }

    trim() {
      while (this.out.childElementCount > MAX_LINES) this.out.removeChild(this.out.firstElementChild);
    }

    addLine(html, cls) {
      const d = document.createElement('div');
      d.className = 'line ' + (cls || '');
      d.innerHTML = html;
      this.out.appendChild(d);
      this.trim();
      this.scrollEnd();
      return d;
    }

    text(t, cls) { return this.addLine(esc(t), cls); }
    echo(prompt, cmd) { return this.addLine('<span class="p">' + esc(prompt) + '</span> <span class="cmdtext">' + esc(cmd) + '</span>', 'cmd'); }
    hint(t) { return this.addLine('💡 ' + esc(t), 'hint'); }
    fix(t) { return this.addLine('🛟 ' + esc(t), 'fix'); }
    error(t) { return this.addLine(esc(t), 'err'); }
    ok(t) { return this.addLine(esc(t), 'ok'); }
    note(t) { return this.addLine(esc(t), 'note'); }
    html(h, cls) { return this.addLine(h, cls); }
    options(list) { return this.addLine(list.map((o) => '<span class="opt">' + esc(o) + '</span>').join(''), 'note'); }
    clear() { this.out.innerHTML = ''; this.streams.clear(); }

    beginStream(id) {
      const pre = document.createElement('pre');
      pre.className = 'outp';
      this.out.appendChild(pre);
      this.streams.set(id, { ansi: new GH.Ansi.AnsiStream(), pre, raw: '' });
    }

    write(id, text) {
      const s = this.streams.get(id);
      if (!s) return;
      const stick = this.nearBottom();
      s.raw += text;
      s.pre.insertAdjacentHTML('beforeend', s.ansi.push(text));
      if (stick) this.scrollEnd();
    }

    /** Cierra la salida y devuelve el texto plano (sin colores) para analizarlo. */
    endStream(id) {
      const s = this.streams.get(id);
      this.streams.delete(id);
      if (!s) return '';
      if (!s.pre.textContent.trim()) s.pre.remove();
      return GH.Ansi.strip(s.raw);
    }

    /** Pone un comando en la línea de entrada y selecciona el primer <hueco> para que se pueda escribir encima. */
    insert(text) {
      this.input.value = text;
      this.input.focus();
      this.selectPlaceholder(0);
      this.draft = '';
    }

    selectPlaceholder(from) {
      const v = this.input.value;
      const m = v.slice(from).match(PLACEHOLDER);
      if (!m) { this.input.setSelectionRange(v.length, v.length); return false; }
      const start = from + m.index;
      this.input.setSelectionRange(start, start + m[0].length);
      return true;
    }

    pushHistory(line) {
      if (this.history[this.history.length - 1] !== line) this.history.push(line);
      this.history = this.history.slice(-100);
      this.histIdx = this.history.length;
    }

    setHistory(list) {
      this.history = (Array.isArray(list) ? list : []).filter((x) => typeof x === 'string').slice(-100);
      this.histIdx = this.history.length;
    }

    /** Contenido de la consola para guardarlo con el proyecto (lo más reciente, con un tope de tamaño). */
    exportHtml() {
      const parts = [];
      let total = 0;
      for (let i = this.out.children.length - 1; i >= 0; i--) {
        const h = this.out.children[i].outerHTML;
        if (total + h.length > MAX_SAVED_CHARS) break;
        total += h.length;
        parts.push(h);
      }
      return parts.reverse().join('');
    }

    importHtml(html) {
      this.out.innerHTML = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, '');
      this.scrollEnd();
    }

    onKey(e) {
      const inp = this.input;
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = inp.value;
        if (!v.trim()) return;
        if (this.busy) { this.note('Espera a que termine el comando anterior (o cancélalo con Ctrl+C).'); return; }
        inp.value = '';
        this.pushHistory(v.trim());
        this.onSubmit(v);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.histIdx === this.history.length) this.draft = inp.value;
        if (this.histIdx > 0) { this.histIdx--; inp.value = this.history[this.histIdx]; }
        setTimeout(() => inp.setSelectionRange(inp.value.length, inp.value.length));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.histIdx < this.history.length) {
          this.histIdx++;
          inp.value = this.histIdx === this.history.length ? this.draft : this.history[this.histIdx];
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const selEnd = inp.selectionEnd || 0;
        // Si hay un <hueco> más adelante, Tab salta al siguiente hueco.
        if (PLACEHOLDER.test(inp.value.slice(selEnd))) {
          this.selectPlaceholder(selEnd);
          return;
        }
        const res = this.complete ? this.complete(inp.value) : null;
        if (!res) return;
        if (res.value !== undefined) { inp.value = res.value; inp.setSelectionRange(res.value.length, res.value.length); }
        if (res.options && res.options.length) this.options(res.options);
      } else if (e.key === 'Escape') {
        inp.value = '';
        this.histIdx = this.history.length;
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        this.clear();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        if (this.busy) { e.preventDefault(); this.onCancel && this.onCancel(); }
        else if (inp.selectionStart === inp.selectionEnd) {
          e.preventDefault();
          if (inp.value) { this.addLine('<span class="p">' + esc(this.promptEl.textContent) + '</span> ' + esc(inp.value) + '^C', 'note'); inp.value = ''; }
        }
      }
    }
  }

  GH.Terminal = Terminal;
})();
