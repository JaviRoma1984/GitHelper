'use strict';
/* Empaqueta GitHelper como programa de Windows (carpeta dist\GitHelper-win32-x64\GitHelper.exe). */
const path = require('path');
const fs = require('fs');
const mod = require('@electron/packager');
const packager = mod.packager || mod.default || mod;

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Solo entra en el programa lo necesario (las pruebas, los scripts de instalación y node_modules se quedan fuera).
const KEEP = [
  /^\/main\.js$/, /^\/preload\.js$/, /^\/package\.json$/,
  /^\/src(\/|$)/,
  /^\/build$/, /^\/build\/icon\.png$/,
  /^\/scripts$/, /^\/scripts\/e2e\.js$/,
];

async function main() {
  console.log('[1/3] Preparando…');
  const t0 = Date.now();
  const out = await packager({
    dir: root,
    out: path.join(root, 'dist'),
    name: 'GitHelper',
    executableName: 'GitHelper',
    platform: 'win32',
    arch: 'x64',
    overwrite: true,
    asar: true,
    prune: true,
    icon: path.join(root, 'build', 'icon.ico'),
    appVersion: pkg.version,
    win32metadata: {
      CompanyName: 'GitHelper',
      FileDescription: 'GitHelper - ramas de GitHub y de tu carpeta, con consola',
      ProductName: 'GitHelper',
      InternalName: 'GitHelper',
      OriginalFilename: 'GitHelper.exe',
    },
    ignore: (p) => (p === '' ? false : !KEEP.some((re) => re.test(p))),
    quiet: true,
  });
  console.log('[3/3] Listo en ' + Math.round((Date.now() - t0) / 1000) + ' s: ' + out.join(', '));
}

main().catch((e) => {
  console.error('ERROR al empaquetar:', e && e.stack ? e.stack : e);
  process.exit(1);
});
