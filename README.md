# GitHelper

Programa de escritorio para Windows que **dibuja las ramas de un repositorio de GitHub y, justo al lado, las de su copia en tu ordenador**, con una consola de `git`/`gh` para trabajar desde el mismo sitio y una lista de **324 órdenes explicadas** que se copian en la consola con un clic.

```
+-----------------------------------------+-----------------------------------------+
| ☁ Repositorio de GitHub                 | 📁 Repositorio local                    |
|  [URL] Ver · Guardar · Borrar           |  [carpeta] Examinar · Guardar · Borrar  |
|  ‹ [guardados ▾] › · Abrir web          |  ‹ [guardadas ▾] › · Abrir carpeta      |
+-----------------------------------------+-----------------------------------------+
| ☁ Ramas en GitHub                       | 📁 Ramas en tu ordenador                |
|   (dibujo de ramas)                     |   (dibujo de ramas)                     |
+-----------------------------------------+-----------------------------------------+
| ⌨ Consola (git, gh, ls, cat, echo…)     | 📚 Órdenes de Git y GitHub (324)        |
|   carpeta (main) › git status           |   ▸ secciones desplegables              |
|                                         |   clic en una orden = copiarla          |
+-----------------------------------------+-----------------------------------------+
```

## Qué hace

- **Repositorio de GitHub** (arriba a la izquierda): escribe la dirección (`https://github.com/usuario/repositorio`) y pulsa **Ver** para dibujarlo, **Guardar** para dejarlo en la lista o **Borrar** para quitarlo (pide confirmación; no borra nada en GitHub). Con la lista desplegable y las flechas **‹ ›** te mueves entre los repositorios guardados.
- **Repositorio local** (arriba a la derecha): igual, con una carpeta de tu ordenador (**Examinar…**, **Guardar**, **Borrar**, lista y flechas). Borrar solo la quita de la lista: nunca toca la carpeta ni su contenido.
- **Los dos dibujos, uno al lado del otro y con el mismo ancho** (el separador de en medio permite cambiarlo; los tamaños se recuerdan): ramas, commits, fusiones (rombos), etiquetas, `HEAD`, cambios sin guardar y las ramas de GitHub tal como las recuerda tu Git (`origin/main`…). **`main` es una línea larga** que recorre todo el dibujo hasta el borde derecho (sólida hasta su último commit y más tenue después, con una flecha y su nombre). **Cada rama que sale de ella es otra línea igual**, en su propio carril, **con su propio color** (siempre distinto, aunque haya muchas) y **su nombre al final de la línea**, y la etiqueta de la rama lleva ese mismo color. Una rama sin commits propios (como una `develop` recién creada desde `main`) también se ve como línea. **Cuando una rama se fusiona en su rama madre, sigue representada (sale, avanza con sus commits y se cierra con la fusión) pero pierde la línea que va al infinito**: la línea larga queda solo para las ramas abiertas. **Los push se marcan** con una chapa verde ⬆ junto al commit donde acabó la subida; al pasar el puntero por encima se ve a qué rama se subió, cuándo y quién, y los mensajes de los commits que iban dentro (Git no guarda una «descripción» del push: esa es la lista de commits subidos). Salen los push hechos **desde este ordenador** (los apunta Git en el registro de la rama remota, `reflog`, y los olvida a los ~90 días); en el dibujo de GitHub salen los de la carpeta local enlazada con ese repositorio. Un clic en una rama o en un commit pega el comando correspondiente en la consola.
- **Enlace automático**: al elegir un repositorio de GitHub se abre solo la carpeta guardada cuyo `origin` apunta a él, y al revés. Las etiquetas de la franja local avisan de lo que falta: `↑ 2 por subir`, `↓ 1 por bajar`, `rama sin subir`, `sin GitHub enlazado`…
- **Consola**: ejecuta `git` y `gh` de verdad en la carpeta local (sin shell: no hay `|` ni `;`; se puede encadenar con `&&`), más los ayudantes `ls`, `cat`, `echo "texto" > archivo`, `touch`, `mkdir`, `rm`, `pwd`. Historial con ↑ ↓, Tab completa subcomandos y ramas, Ctrl+C cancela. Al terminar cada comando se actualiza el dibujo local; tras un `git push` o un comando `gh` se vuelve a leer también GitHub.
- **Órdenes de Git y GitHub** (a la derecha de la consola): 324 órdenes agrupadas en secciones desplegables, cada una con su explicación y avisos en las peligrosas, y un buscador. Pulsar una la copia en la consola con el primer `<hueco>` seleccionado para escribir encima; tú decides cuándo darle a Enter.

## Cómo lee GitHub

La primera vez que ves un repositorio, GitHelper hace en segundo plano un clon *desnudo y sin archivos* (`git clone --bare --filter=blob:none`) dentro de sus datos (`%APPDATA%\GitHelper\repos-github`): solo el historial, pocos MB. Después, **↻ Actualizar** (o un `git push`/`gh` desde la consola) hace un `git fetch`. Esa copia no es tu carpeta de trabajo y se borra al quitar el repositorio de la lista.

Para repositorios **privados** usa las credenciales que tu Git ya tenga (Git Credential Manager, `gh auth login`…). La lectura automática nunca abre ventanas de inicio de sesión ni pide claves: si no puede entrar, lo explica en el propio panel. `gh auth login` y otros comandos interactivos se hacen en la **⌨ Terminal externa**.

## Privacidad y seguridad

- Arranca **vacío**: sin carpeta, sin URL, sin usuario. Solo se guarda lo que pulsas **Guardar** (`%APPDATA%\GitHelper\datos.json`). Nada de datos personales en el código, en el `.exe` ni en el instalador.
- Las direcciones se validan antes de pasarlas a git: se rechazan las que empiezan por `-` (opciones), llevan espacios o llevan usuario/clave dentro de la URL.
- GitHelper no pide, guarda ni usa contraseñas ni tokens. Los `push`/`pull` los hace tu Git con tu sesión.

## Requisitos

- Windows 10/11 y [Git for Windows](https://git-scm.com/download/win).
- Opcional: [GitHub CLI](https://cli.github.com) para los comandos `gh`.

## Instalar y usar

```powershell
npm install
node node_modules/electron/install.js   # Electron 45 no descarga su binario en npm install
npm run empaquetar                       # crea dist\GitHelper-win32-x64\GitHelper.exe
npm run instalar                         # lo instala para tu usuario + accesos directos
```

Desinstalar: `scripts\desinstalar.ps1` (con `-BorrarAjustes` también borra `%APPDATA%\GitHelper`). No toca tus carpetas ni tus repositorios.

## Desarrollo

| Comando | Qué hace |
|---|---|
| `npm start` | Abre GitHelper desde el código |
| `npm test` | 25 pruebas (URLs, consola, dibujo de ramas, marcas de push, lista de órdenes, git de verdad en carpetas temporales) |
| `npm run e2e` | Prueba de extremo a extremo: abre la aplicación, la maneja como una persona y saca capturas (117 comprobaciones; `--exe <ruta>` la prueba sobre el programa instalado, `--out` elige la carpeta de capturas) |
| `npm run icono` | Regenera `build\icon.ico` y `icon.png` |

Las pruebas usan carpetas temporales y un «GitHub» que es un repositorio desnudo local: no tocan internet, ni tus carpetas, ni tus datos.

Estructura: `main.js` (ventana, datos guardados, IPC) · `src/engine` (git, lectura de GitHub, consola, almacén) · `src/shared` (URLs, intérprete de la consola, dibujo de ramas, lista de órdenes) · `src/renderer` (interfaz).

## Fases

Norma de trabajo: ✅ solo cuando lo ha comprobado la persona que usa el programa; 🟡 = hecho y probado por mí (pruebas automáticas y capturas), pendiente de tu confirmación.

| Fase | Contenido | Estado |
|---|---|---|
| F1 | Base: ventana Electron, motor de `git`/`gh` (sin shell), pruebas | 🟡 |
| F2 | Repositorios de GitHub: escribir URL, Ver, Guardar, Borrar, lista y flechas | 🟡 |
| F3 | Visualizador de ramas de GitHub (clon desnudo sin archivos + fetch) | 🟡 |
| F4 | Repositorio local: Examinar, Guardar, Borrar, lista y flechas | 🟡 |
| F5 | Los dos visualizadores en paralelo, uno al lado del otro con el mismo ancho | 🟡 |
| F6 | Consola de `git`/`gh`/ayudantes que actualiza los dibujos | 🟡 |
| F7 | Lista desplegable de 324 órdenes explicadas que se copian en la consola | 🟡 |
| F8 | Enlace automático carpeta ↔ repositorio por su `origin` y etiquetas de estado | 🟡 |
| F9 | Empaquetado, instalación y prueba sobre el `.exe` instalado | 🟡 |
| F10 | Uso real con tu cuenta: `push`/`pull`, repositorios privados, `gh auth login` | ⬜ sin probar (no se han usado tus credenciales) |
| F11 | Subir el código a GitHub | 🟡 subido |
| F12 | Línea larga de `main` que recorre el dibujo en paralelo a las ramas que siguen avanzando | 🟡 |
| F13 | Cada rama (también la que no tiene commits propios, como `develop`) es otra línea larga con su color y su nombre | 🟡 |
| F14 | Una rama fusionada en su madre se queda dibujada (sale, avanza y se cierra) sin la línea al infinito | 🟡 |
| F15 | Marca de push (⬆) en el commit donde se subió algo a GitHub; al pasar el puntero: rama, fecha y commits subidos | 🟡 |

## Licencia

MIT
