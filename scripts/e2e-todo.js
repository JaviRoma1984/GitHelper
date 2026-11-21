'use strict';
/* Lanza TODAS las pruebas de extremo a extremo, una tras otra, en carpetas temporales (no toca tus carpetas ni tus datos).
 *   node scripts/e2e-todo.js                                   prueba el código fuente (electron .)
 *   node scripts/e2e-todo.js --exe "C:\ruta\GitHelper.exe"     prueba el programa instalado
 *   node scripts/e2e-todo.js --out carpeta                     dónde dejar las capturas (por defecto, una carpeta temporal)
 * Los escenarios completo → reabrir comparten los datos del programa: equivale a cerrar y reabrir GitHelper.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const exe = opt('--exe') || require('electron');
const appArgs = opt('--exe') ? ['--e2e'] : ['.', '--e2e'];
const base = opt('--out') ? path.resolve(opt('--out')) : fs.mkdtempSync(path.join(os.tmpdir(), 'githelper-e2e-'));
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });

const userdata = path.join(base, 'datos-del-programa');
const work = path.join(base, 'trabajo');
fs.mkdirSync(userdata, { recursive: true });
fs.mkdirSync(work, { recursive: true });

let totalChecks = 0;
let totalFails = 0;
let crashed = 0;

function launch(scenario) {
  const out = path.join(base, 'capturas', scenario);
  const env = Object.assign({}, process.env, {
    GITHELPER_E2E_SCENARIO: scenario,
    GITHELPER_USERDATA: userdata,
    GITHELPER_E2E_BASE: work,
    GITHELPER_E2E_OUT: out,
    GITHELPER_E2E_STATE: path.join(base, 'estado.json'),
  });
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GITHELPER_LOCAL;
  process.stdout.write('\n=== Escenario: ' + scenario + ' ===\n');
  const r = spawnSync(exe, appArgs, { cwd: root, env, encoding: 'utf8', timeout: 300000, windowsHide: false });
  const lines = String(r.stdout || '').split('\n').filter((l) => /^(OK|FALLA)/.test(l));
  lines.forEach((l) => { if (l.startsWith('FALLA') || argv.includes('--verbose')) process.stdout.write(l + '\n'); });
  let res = null;
  try { res = JSON.parse(fs.readFileSync(path.join(out, 'resultado.json'), 'utf8')); } catch { res = null; }
  if (!res) {
    crashed++;
    process.stdout.write('FALLA  el escenario no terminó (sin informe). Salida:\n' + String(r.stdout || '').slice(-800) + String(r.stderr || '').slice(-800) + '\n');
    return;
  }
  totalChecks += res.total;
  totalFails += res.fallos;
  process.stdout.write(scenario + ': ' + (res.total - res.fallos) + '/' + res.total + ' correctas\n');
}

launch('completo');
launch('reabrir');

process.stdout.write('\n==== TOTAL: ' + (totalChecks - totalFails) + '/' + totalChecks + ' comprobaciones correctas' + (crashed ? ', ' + crashed + ' escenario(s) sin terminar' : '') + ' ====\n');
process.stdout.write('Capturas: ' + path.join(base, 'capturas') + '\n');
process.exit(totalFails || crashed ? 1 : 0);
