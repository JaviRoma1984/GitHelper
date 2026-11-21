/* GitHelper · Comandos que necesitan teclado interactivo o abren otra ventana: en esta consola no pueden funcionar. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.GH = root.GH || {}).Interactive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EXT = ' Ábrelo en la «Terminal externa» (botón de arriba a la derecha).';

  /** @returns {string|null} el motivo por el que no se puede ejecutar aquí, o null si se puede. */
  function interactiveBlock(argv) {
    if (!argv || !argv.length) return null;
    const cmd = argv[0].toLowerCase();
    const sub = argv.find((x, i) => i > 0 && !x.startsWith('-'));
    const rest = argv.slice(3); // lo que hay después de «gh <grupo> <acción>»
    const has = (...f) => argv.some((x) => f.includes(x));
    if (cmd === 'git') {
      if (sub === 'rebase' && has('-i', '--interactive')) return 'El rebase interactivo abre un editor de texto y aquí no puede funcionar.' + EXT;
      if (sub === 'add' && has('-p', '--patch', '-i', '--interactive', '-e', '--edit')) return 'Este modo de «git add» pregunta cosas por teclado y aquí no puede funcionar.' + EXT;
      if (sub === 'config' && has('-e', '--edit')) return 'Este comando abre un editor de texto externo.' + EXT;
      if (['mergetool', 'difftool', 'gui', 'instaweb', 'citool'].includes(sub)) return 'Este comando abre otra aplicación con ventana.' + EXT;
    }
    if (cmd === 'gitk') return 'gitk abre una ventana gráfica.' + EXT;
    if (cmd === 'gh') {
      const a = argv[1];
      const b = argv[2];
      if (a === 'auth' && (b === 'login' || b === 'refresh') && !has('--with-token')) return '«gh auth ' + b + '» es interactivo: te hace preguntas por teclado y te enseña un código para escribir en el navegador.' + EXT;
      if (a === 'repo' && b === 'create' && rest.filter((x) => !x.startsWith('-')).length === 0) return '«gh repo create» sin nombre es interactivo. Dale un nombre: gh repo create mi-repo --public --source=. --remote=origin';
      if (a === 'codespace' && ['ssh', 'code', 'jupyter'].includes(b)) return 'Este comando abre una sesión interactiva u otra aplicación.' + EXT;
    }
    return null;
  }

  return { interactiveBlock };
});
