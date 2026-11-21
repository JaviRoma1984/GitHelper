/* GitHelper · Convierte la salida con colores ANSI (la que genera git) en HTML.
 * Es un "flujo": se le van pasando trozos de texto y recuerda el color entre trozo y trozo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.GH = root.GH || {}).Ansi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE = {
    30: '#6e7681', 31: '#ff7b72', 32: '#3fb950', 33: '#e3b341', 34: '#58a6ff', 35: '#bc8cff', 36: '#56d4dd', 37: '#c9d1d9',
    90: '#8b949e', 91: '#ffa198', 92: '#56d364', 93: '#f2cc60', 94: '#79c0ff', 95: '#d2a8ff', 96: '#76e3ea', 97: '#f0f6fc',
  };

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function xterm256(n) {
    if (n < 8) return BASE[30 + n];
    if (n < 16) return BASE[90 + (n - 8)];
    if (n < 232) {
      const k = n - 16;
      const lv = [0, 95, 135, 175, 215, 255];
      return 'rgb(' + lv[Math.floor(k / 36)] + ',' + lv[Math.floor(k / 6) % 6] + ',' + lv[k % 6] + ')';
    }
    const g = 8 + (n - 232) * 10;
    return 'rgb(' + g + ',' + g + ',' + g + ')';
  }

  /** Quita todos los códigos de color/control y deja solo el texto. */
  function strip(text) {
    return String(text)
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '');
  }

  class AnsiStream {
    constructor() {
      this.pending = '';
      this.resetStyle();
    }

    resetStyle() {
      this.fg = null; this.bg = null; this.bold = false; this.dim = false; this.italic = false; this.underline = false;
    }

    css() {
      const p = [];
      if (this.fg) p.push('color:' + this.fg);
      if (this.bg) p.push('background:' + this.bg);
      if (this.bold) p.push('font-weight:700');
      if (this.dim) p.push('opacity:.72');
      if (this.italic) p.push('font-style:italic');
      if (this.underline) p.push('text-decoration:underline');
      return p.join(';');
    }

    applySgr(params) {
      const codes = params === '' ? [0] : params.split(';').map((x) => (x === '' ? 0 : parseInt(x, 10)));
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) this.resetStyle();
        else if (c === 1) this.bold = true;
        else if (c === 2) this.dim = true;
        else if (c === 3) this.italic = true;
        else if (c === 4) this.underline = true;
        else if (c === 22) { this.bold = false; this.dim = false; }
        else if (c === 23) this.italic = false;
        else if (c === 24) this.underline = false;
        else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) this.fg = BASE[c];
        else if (c === 39) this.fg = null;
        else if (c >= 40 && c <= 47) this.bg = BASE[c - 10] + '55';
        else if (c >= 100 && c <= 107) this.bg = BASE[c - 10] + '55';
        else if (c === 49) this.bg = null;
        else if (c === 38 || c === 48) {
          let color = null;
          if (codes[i + 1] === 5) { color = xterm256(codes[i + 2] || 0); i += 2; }
          else if (codes[i + 1] === 2) { color = 'rgb(' + (codes[i + 2] || 0) + ',' + (codes[i + 3] || 0) + ',' + (codes[i + 4] || 0) + ')'; i += 4; }
          if (color) { if (c === 38) this.fg = color; else this.bg = color; }
        }
      }
    }

    /** Recibe texto con códigos ANSI y devuelve HTML (ya escapado). */
    push(text) {
      let s = this.pending + String(text);
      this.pending = '';
      s = s.replace(/\r\n/g, '\n').replace(/\r(?!\n)/g, '');
      // Si el trozo termina a mitad de un código de escape, lo guardamos para el siguiente.
      const lastEsc = s.lastIndexOf('\x1b');
      if (lastEsc >= 0 && s.length - lastEsc < 24 && !/^\x1b(\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(\x07|\x1b\\))/.test(s.slice(lastEsc))) {
        this.pending = s.slice(lastEsc);
        s = s.slice(0, lastEsc);
      }
      s = s.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
      let html = '';
      const re = /\x1b\[([0-9;?]*)([A-Za-z])/g;
      let last = 0;
      let m;
      const emit = (chunk) => {
        if (!chunk) return;
        const css = this.css();
        const esc = escapeHtml(chunk);
        html += css ? '<span style="' + css + '">' + esc + '</span>' : esc;
      };
      while ((m = re.exec(s))) {
        emit(s.slice(last, m.index));
        last = re.lastIndex;
        if (m[2] === 'm') this.applySgr(m[1]);
      }
      emit(s.slice(last));
      return html;
    }
  }

  return { AnsiStream, strip, escapeHtml };
});
