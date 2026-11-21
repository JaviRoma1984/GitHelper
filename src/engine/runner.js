'use strict';
/* Ejecuta un comando de la consola: git, gh o uno de los ayudantes (ls, cat, echo, touch, mkdir, rm, pwd).
 * Los comandos se ejecutan SIN shell, en la carpeta del repositorio local. */
const fs = require('fs');
const path = require('path');
const { runProcess, userGitArgs } = require('./git');
const { safeJoin, readFile, samePath } = require('./files');
const { interactiveBlock } = require('../shared/interactive');

const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';
const COMMAND_TIMEOUT = 5 * 60 * 1000;
const BUILTINS = ['ls', 'dir', 'cat', 'type', 'echo', 'touch', 'mkdir', 'rm', 'del', 'pwd'];

function listDir(cwd, argv, emit) {
  const flags = argv.filter((a) => a.startsWith('-')).join('');
  const target = argv.find((a, i) => i > 0 && !a.startsWith('-')) || '.';
  const dir = safeJoin(cwd, target);
  const st = fs.statSync(dir);
  if (!st.isDirectory()) { emit(path.basename(dir) + '\n', 'out'); return 0; }
  const all = /a/.test(flags);
  const long = /l/.test(flags);
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => (all ? true : e.name !== '.git'))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  if (!entries.length) { emit('(carpeta vacía)\n', 'out'); return 0; }
  entries.forEach((e) => {
    let line = e.isDirectory() ? BLUE + e.name + '/' + RESET : e.name;
    if (long) {
      let size = '';
      if (!e.isDirectory()) { try { size = String(fs.statSync(path.join(dir, e.name)).size).padStart(8) + ' bytes  '; } catch { size = ''; } }
      else size = '     <dir>        ';
      line = size + line;
    }
    emit(line + '\n', 'out');
  });
  return 0;
}

function bad(emit, msg) {
  emit(msg + '\n', 'err');
  return 1;
}

function builtin(cwd, argv, emit) {
  const name = argv[0].toLowerCase();
  const args = argv.slice(1);
  const names = args.filter((a) => !a.startsWith('-'));
  try {
    switch (name) {
      case 'pwd':
        emit(cwd + '\n', 'out');
        return 0;
      case 'ls':
      case 'dir':
        return listDir(cwd, argv, emit);
      case 'echo':
        emit(args.join(' ') + '\n', 'out');
        return 0;
      case 'cat':
      case 'type': {
        if (!names.length) return bad(emit, 'cat: indica qué archivo quieres ver. Ejemplo: cat notas.txt');
        let code = 0;
        names.forEach((n) => {
          try {
            const f = readFile(cwd, n);
            if (f.binary) { emit(n + ': es un archivo binario, no se puede mostrar como texto.\n', 'err'); code = 1; return; }
            if (f.tooBig) { emit(n + ': el archivo es demasiado grande para mostrarlo aquí.\n', 'err'); code = 1; return; }
            emit(f.content.endsWith('\n') || f.content === '' ? f.content : f.content + '\n', 'out');
          } catch (e) {
            emit(n + ': ' + (e.code === 'ENOENT' ? 'no existe ese archivo.' : e.message) + '\n', 'err');
            code = 1;
          }
        });
        return code;
      }
      case 'touch': {
        if (!names.length) return bad(emit, 'touch: indica el nombre del archivo. Ejemplo: touch notas.txt');
        names.forEach((n) => {
          const p = safeJoin(cwd, n);
          if (!fs.existsSync(p)) fs.writeFileSync(p, '');
        });
        return 0;
      }
      case 'mkdir': {
        if (!names.length) return bad(emit, 'mkdir: indica el nombre de la carpeta. Ejemplo: mkdir docs');
        names.forEach((n) => fs.mkdirSync(safeJoin(cwd, n), { recursive: true }));
        return 0;
      }
      case 'rm':
      case 'del': {
        if (!names.length) return bad(emit, 'rm: indica qué archivo quieres borrar. Ejemplo: rm notas.txt');
        const recursive = args.some((a) => /^-[a-zA-Z]*[rR]/.test(a));
        let code = 0;
        names.forEach((n) => {
          const p = safeJoin(cwd, n);
          if (samePath(p, cwd)) { emit('rm: no se puede borrar la carpeta del repositorio entera.\n', 'err'); code = 1; return; }
          if (!fs.existsSync(p)) { emit('rm: ' + n + ': no existe.\n', 'err'); code = 1; return; }
          if (fs.statSync(p).isDirectory() && !recursive) { emit('rm: ' + n + ' es una carpeta. Para borrarla con todo lo que tiene dentro usa: rm -r ' + n + '\n', 'err'); code = 1; return; }
          fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
        });
        return code;
      }
      default:
        return 127;
    }
  } catch (e) {
    return bad(emit, name + ': ' + (e.message || e));
  }
}

/**
 * @param {{cwd:string}} ctx
 * @param {{argv:string[], redirect:({op:string,target:string}|null)}} cmd
 * @param {{emit:(text:string, stream:'out'|'err')=>void, signal?:AbortSignal}} hooks
 */
async function runCommand(ctx, cmd, hooks) {
  const argv = cmd.argv;
  const name = argv[0].toLowerCase();
  let buffer = '';
  const wantsFile = !!cmd.redirect;
  const emit = wantsFile
    ? (text, stream) => { if (stream === 'out') buffer += text; else hooks.emit(text, stream); }
    : hooks.emit;

  const blocked = interactiveBlock(argv);
  if (blocked) { hooks.emit(blocked + '\n', 'err'); return { code: 2 }; }

  let result;
  if (name === 'git' || name === 'gh') {
    const args = name === 'git' ? userGitArgs(argv.slice(1), !wantsFile) : argv.slice(1);
    const env = name === 'gh' && !wantsFile ? { CLICOLOR_FORCE: '1' } : {};
    const r = await runProcess(name, args, { cwd: ctx.cwd, env, onData: emit, signal: hooks.signal, timeoutMs: COMMAND_TIMEOUT });
    if (r.notFound) {
      emit(name === 'git'
        ? 'No encuentro git.exe. Instala «Git for Windows» (https://git-scm.com/download/win) y vuelve a abrir GitHelper.\n'
        : 'No encuentro la herramienta «gh» (GitHub CLI). Instálala desde https://cli.github.com para usar los comandos «gh». Con git solo ya puedes subir a GitHub.\n', 'err');
    }
    result = { code: r.code, cancelled: r.cancelled, timedOut: r.timedOut };
  } else if (BUILTINS.includes(name)) {
    result = { code: builtin(ctx.cwd, argv, emit) };
  } else if (['help', 'clear', 'cls'].includes(name)) {
    result = { code: 0 };
  } else {
    hooks.emit('No conozco el comando «' + argv[0] + '». Aquí puedes usar git, gh, y: ls, cat, echo, touch, mkdir, rm, pwd, clear y help.\n', 'err');
    result = { code: 127 };
  }

  if (wantsFile && result.code === 0) {
    try {
      const p = safeJoin(ctx.cwd, cmd.redirect.target);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (cmd.redirect.op === '>>') fs.appendFileSync(p, buffer, 'utf8'); else fs.writeFileSync(p, buffer, 'utf8');
    } catch (e) {
      hooks.emit('No he podido escribir en «' + cmd.redirect.target + '»: ' + (e.message || e) + '\n', 'err');
      result.code = 1;
    }
  }
  return result;
}

module.exports = { runCommand, BUILTINS };
