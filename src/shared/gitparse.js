/* GitHelper · Lectura de la salida de git (historial y estado). Sin dependencias: se puede probar desde Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.GH = root.GH || {}).GitParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Formato que pedimos a "git log": campos separados por \x1f, commits separados por \x1e.
  const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e';

  function parseDecorations(deco) {
    const refs = [];
    let headDetached = false;
    String(deco || '').split(', ').forEach((raw) => {
      const t = raw.trim();
      if (!t) return;
      if (t === 'HEAD') { headDetached = true; return; }
      if (t.startsWith('HEAD -> ')) {
        const name = t.slice(8).replace(/^refs\/heads\//, '');
        refs.push({ type: 'branch', name, head: true });
        return;
      }
      if (t.startsWith('tag: ')) { refs.push({ type: 'tag', name: t.slice(5).replace(/^refs\/tags\//, '') }); return; }
      if (t.startsWith('refs/heads/')) { refs.push({ type: 'branch', name: t.slice(11), head: false }); return; }
      if (t.startsWith('refs/remotes/')) {
        const name = t.slice(13);
        if (/\/HEAD$/.test(name)) return;
        refs.push({ type: 'remote', name });
        return;
      }
      // refs/stash y similares: se ignoran
    });
    return { refs, headDetached };
  }

  function parseLog(text) {
    const commits = [];
    String(text || '').split('\x1e').forEach((rec) => {
      const r = rec.replace(/^\n+/, '');
      if (!r.trim()) return;
      const f = r.split('\x1f');
      if (f.length < 6 || !f[0]) return;
      const d = parseDecorations(f[4]);
      commits.push({
        sha: f[0],
        parents: f[1] ? f[1].split(' ').filter(Boolean) : [],
        author: f[2],
        ts: parseInt(f[3], 10) || 0,
        refs: d.refs,
        headDetached: d.headDetached,
        subject: f.slice(5).join('\x1f'),
      });
    });
    return commits;
  }

  /** Lee "git status --porcelain=v2 --branch -z". */
  function parseStatus(text) {
    const out = {
      branch: { head: null, oid: null, upstream: null, ahead: 0, behind: 0 },
      files: [],
      counts: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
    };
    const parts = String(text || '').split('\0');
    for (let i = 0; i < parts.length; i++) {
      const line = parts[i];
      if (!line) continue;
      if (line.startsWith('# branch.oid ')) out.branch.oid = line.slice(13);
      else if (line.startsWith('# branch.head ')) out.branch.head = line.slice(14);
      else if (line.startsWith('# branch.upstream ')) out.branch.upstream = line.slice(18);
      else if (line.startsWith('# branch.ab ')) {
        const m = line.match(/\+(\d+) -(\d+)/);
        if (m) { out.branch.ahead = +m[1]; out.branch.behind = +m[2]; }
      } else if (line[0] === '1') {
        const f = line.split(' ');
        out.files.push({ path: f.slice(8).join(' '), x: f[1][0], y: f[1][1] });
      } else if (line[0] === '2') {
        const f = line.split(' ');
        out.files.push({ path: f.slice(9).join(' '), orig: parts[i + 1] || '', x: f[1][0], y: f[1][1] });
        i++;
      } else if (line[0] === 'u') {
        const f = line.split(' ');
        out.files.push({ path: f.slice(10).join(' '), x: 'U', y: 'U', conflict: true });
      } else if (line[0] === '?') {
        out.files.push({ path: line.slice(2), x: '?', y: '?', untracked: true });
      }
    }
    out.files.forEach((f) => {
      if (f.conflict) out.counts.conflicts++;
      else if (f.untracked) out.counts.untracked++;
      else {
        if (f.x !== '.') out.counts.staged++;
        if (f.y !== '.') out.counts.modified++;
      }
    });
    return out;
  }

  /** Para la barra de GitHub: de una URL de git saca usuario/repo si es de github.com. */
  function parseGithubUrl(url) {
    const u = String(url || '').trim();
    let m = u.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i);
    if (!m) m = u.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
    if (!m) m = u.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
    return m ? { owner: m[1], repo: m[2], web: 'https://github.com/' + m[1] + '/' + m[2] } : null;
  }

  /**
   * Registro (reflog) de una rama remota, p. ej. .git/logs/refs/remotes/origin/main. Cada línea es
   *   <antes> <después> Nombre <correo> <segundos> <zona>\t<mensaje>
   * Cuando haces «git push», git apunta ahí «update by push»: de ahí sale cuándo se subió algo y qué commits iban.
   * Solo se devuelven las subidas (no los fetch) y no las borrados de rama.
   * @returns {{ref:string, old:string, new:string, who:string, ts:number}[]}
   */
  function parsePushLog(text, ref) {
    const out = [];
    String(text || '').split('\n').forEach((line) => {
      const m = line.match(/^([0-9a-f]{40}) ([0-9a-f]{40}) (.*?) <[^>]*> (\d+) [+-]\d{4}\t(.*)$/);
      if (!m || !/^update by push/.test(m[5])) return;
      if (/^0+$/.test(m[2])) return;
      out.push({ ref, old: m[1], new: m[2], who: m[3], ts: parseInt(m[4], 10) });
    });
    return out;
  }

  return { LOG_FORMAT, parseDecorations, parseLog, parseStatus, parseGithubUrl, parsePushLog };
});
