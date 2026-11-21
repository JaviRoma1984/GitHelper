/* GitHelper · Validación y comparación de direcciones de repositorios (sin DOM: se puede probar desde Node).
 *
 * Se aceptan las formas habituales de una dirección de GitHub (u otro servidor Git):
 *   https://github.com/usuario/repo(.git)     git@github.com:usuario/repo(.git)     ssh://git@github.com/usuario/repo(.git)
 * Se rechaza todo lo que pueda colarse como opción de git (empieza por «-»), contiene espacios o caracteres de control,
 * o lleva usuario/clave dentro de la propia dirección (nunca se guardan claves en la lista).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.GH = root.GH || {}).Urls = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOST = '[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?';
  const SEG = '[A-Za-z0-9_.-]+';
  const stripGit = (s) => s.replace(/\.git$/i, '');

  function build(host, owner, repo, url) {
    const o = owner;
    const r = stripGit(repo);
    if (!r || r === '.' || r === '..' || o === '.' || o === '..') return null;
    const h = host.toLowerCase();
    return {
      kind: h === 'github.com' ? 'github' : 'other',
      host: h,
      owner: o,
      repo: r,
      label: o + '/' + r,
      key: (h + '/' + o + '/' + r).toLowerCase(),
      url,
      web: 'https://' + h + '/' + o + '/' + r,
    };
  }

  /**
   * @param {string} input
   * @param {{allowLocal?: boolean}} [opts]  allowLocal: solo para las pruebas (carpetas o file:// en vez de internet)
   * @returns {null | {kind:'github'|'other'|'local', host:string, owner:string, repo:string, label:string, key:string, url:string, web:(string|null)}}
   */
  function parseRepoUrl(input, opts) {
    const u = String(input == null ? '' : input).trim();
    if (!u || u.length > 300) return null;
    if (/[\s\x00-\x1f"'`<>|^\\]/.test(u) && !(opts && opts.allowLocal)) return null;
    if (u.startsWith('-')) return null;
    let m;

    // https://github.com/usuario/repo  (en GitHub se admiten también /tree/rama, /issues… y se recorta a usuario/repo)
    m = u.match(new RegExp('^https?://(?:www\\.)?(github\\.com)/(' + SEG + ')/(' + SEG + ')(?:[/?#].*)?$', 'i'));
    if (m) {
      const info = build(m[1], m[2], m[3], null);
      if (!info) return null;
      info.url = 'https://github.com/' + info.owner + '/' + info.repo;
      return info;
    }
    // https://otro-servidor.com/usuario/repo(.git)
    m = u.match(new RegExp('^https?://(' + HOST + ')(?::\\d+)?/(' + SEG + ')/(' + SEG + ')/?$', 'i'));
    if (m) return build(m[1], m[2], m[3], u.replace(/\/+$/, ''));
    // git@github.com:usuario/repo(.git)
    m = u.match(new RegExp('^[A-Za-z0-9_-]+@(' + HOST + '):(' + SEG + ')/(' + SEG + ')/?$'));
    if (m) return build(m[1], m[2], m[3], u.replace(/\/+$/, ''));
    // ssh://git@github.com/usuario/repo(.git)
    m = u.match(new RegExp('^ssh://[A-Za-z0-9_-]+@(' + HOST + ')(?::\\d+)?/(' + SEG + ')/(' + SEG + ')/?$', 'i'));
    if (m) return build(m[1], m[2], m[3], u.replace(/\/+$/, ''));

    if (opts && opts.allowLocal) {
      let p = null;
      if (/^file:\/\//i.test(u)) p = decodeURIComponent(u.replace(/^file:\/\/\/?/i, ''));
      else if (/^[A-Za-z]:[\\/]/.test(u) || u.startsWith('/')) p = u;
      if (p) {
        const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
        const base = norm.split('/').pop() || 'local';
        return { kind: 'local', host: 'local', owner: 'local', repo: base, label: base, key: 'local/' + norm.toLowerCase(), url: u, web: null };
      }
    }
    return null;
  }

  /** ¿Son la misma dirección aunque una lleve «.git» y la otra no, o una sea https y la otra ssh? */
  function sameRepo(a, b, opts) {
    const x = parseRepoUrl(a, opts);
    const y = parseRepoUrl(b, opts);
    return !!(x && y && x.key === y.key);
  }

  return { parseRepoUrl, sameRepo };
});
