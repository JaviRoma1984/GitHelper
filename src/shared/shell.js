/* GitHelper · Intérprete de la línea de la consola.
 * Convierte lo que escribes en una lista de comandos. Soporta:
 *   - comillas "..." y '...'
 *   - encadenar con &&  (el siguiente solo se ejecuta si el anterior fue bien)
 *   - redirección > y >> (guarda la salida en un archivo)
 * No soporta | ; < ni & suelto: la consola no es un shell completo, es para aprender Git.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.GH = root.GH || {}).Shell = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function tokenize(line) {
    const tokens = [];
    let cur = '';
    let has = false;
    let i = 0;
    const push = () => {
      if (has) tokens.push({ t: 'word', v: cur });
      cur = '';
      has = false;
    };
    while (i < line.length) {
      const c = line[i];
      if (c === '"') {
        has = true;
        i++;
        while (i < line.length && line[i] !== '"') {
          if (line[i] === '\\' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
          cur += line[i++];
        }
        if (i >= line.length) return { error: 'Falta cerrar unas comillas (").' };
        i++;
        continue;
      }
      if (c === "'") {
        has = true;
        i++;
        while (i < line.length && line[i] !== "'") cur += line[i++];
        if (i >= line.length) return { error: "Falta cerrar unas comillas (')." };
        i++;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { push(); i++; continue; }
      if (c === '&' && line[i + 1] === '&') { push(); tokens.push({ t: 'op', v: '&&' }); i += 2; continue; }
      if (c === '>') {
        push();
        if (line[i + 1] === '>') { tokens.push({ t: 'op', v: '>>' }); i += 2; } else { tokens.push({ t: 'op', v: '>' }); i++; }
        continue;
      }
      if (c === '|' || c === ';' || c === '<' || c === '&') {
        return { error: 'En esta consola no se puede usar «' + c + '». Escribe un comando por línea o encadénalos con &&.' };
      }
      cur += c;
      has = true;
      i++;
    }
    push();
    return { tokens };
  }

  /** @returns {{commands: Array<{argv: string[], redirect: ({op: string, target: string}|null)}>} | {error: string}} */
  function parse(line) {
    const r = tokenize(String(line || ''));
    if (r.error) return { error: r.error };
    const toks = r.tokens;
    const commands = [];
    let argv = [];
    let redirect = null;
    const finish = () => {
      if (argv.length === 0) return false;
      commands.push({ argv, redirect });
      argv = [];
      redirect = null;
      return true;
    };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'word') {
        argv.push(t.v);
      } else if (t.v === '&&') {
        if (!finish()) return { error: 'Falta un comando antes de &&.' };
      } else {
        const next = toks[i + 1];
        if (!next || next.t !== 'word') return { error: 'Después de ' + t.v + ' hace falta el nombre de un archivo.' };
        redirect = { op: t.v, target: next.v };
        i++;
      }
    }
    const last = toks[toks.length - 1];
    if (last && last.t === 'op' && last.v === '&&') return { error: 'Falta un comando después de &&.' };
    finish();
    return { commands };
  }

  return { tokenize, parse };
});
