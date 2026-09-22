# Relevo Claude ⇄ Gemini — video 3 «Lo que se te va»

Este video lo trabajan **dos modelos por turnos**, con **Gonzalo** de mediador:

- **Claude** (Claude Code) escribe los encargos y revisa cada ronda.
- **Gemini 3.1 Pro** (en Antigravity) ejecuta los encargos sobre los archivos reales.
- **Gonzalo** pasa los encargos de uno a otro y decide las mejoras.

Los dos modelos no se ven entre sí. Todo lo que uno necesita saber del otro
está escrito en esta carpeta.

---

## Cómo va una ronda

1. Claude deja el encargo en `relevo/PROMPT-NN.md` (`01`, `02`, …).
2. Gonzalo se lo pasa a Gemini en Antigravity.
3. Gemini hace **solo** lo que pide el encargo y deja su informe en
   `relevo/RESPUESTA-NN.md`, con el mismo número.
4. Gonzalo avisa a Claude. Claude lee el informe y el `git diff`, verifica con
   `check` y render, y **registra la ronda con un commit**.

El punto de partida es el commit `a63c86f`: el video tal como lo dejó Gemini.
Cada ronda es un diff contra el anterior, así que todo se puede deshacer.

---

## Reglas para quien ejecuta la ronda

- **Un solo escritor por ronda.** Toca únicamente los archivos que nombra el
  encargo. Si crees que hay que tocar otro, no lo hagas: dilo en el informe.
- **No hagas commits ni cambies de rama.** Claude registra cada ronda después
  de revisarla. La rama la comparte el trabajo del POS.
- **No grabes tomas de pantalla.** Las graba Claude: conduce la app con Edge sin
  ventana, que es repetible y no se corta. Si una ronda necesita una toma nueva,
  pídela en el informe con pantalla, acción y duración.
- **Si tocas `index.html`, cierra con el check** y pega el resumen en el informe:
  `npx --yes hyperframes@0.8.5 check` → tiene que decir `Check passed` con
  **0 errores**. Los avisos se pueden aceptar si se explican.
- **Marca y contenido:** `../../frame.md` manda. Naranja `#F2853A` dominante;
  verde `#57AD30` solo para lo que suma; rojo `#E0392B` para alertas. Nada de
  datos reales de Rodizio, y solo módulos que ya funcionan.
- **Llaves:** nunca en archivos del repo. Viven en `video/.env`, que git ignora.

---

## Formato del informe (`RESPUESTA-NN.md`)

```markdown
# Respuesta NN

## Qué hice
(en dos o tres frases)

## Archivos tocados
- ruta — qué cambió

## Cómo lo verifiqué
(resumen del check; si hubo render, ruta, duración y resolución)

## Dudas o riesgos
(lo que no pude resolver, lo que decidí sin preguntar, lo que haría después)
```

---

## Qué leer antes de cualquier ronda

1. Este archivo.
2. `../../frame.md` — la identidad visual.
3. `../../guiones/03-lo-que-se-te-va.md` — escaleta, tomas y reglas del vertical.
4. `../index.html` — la composición.

---

## Trampas que ya costaron tiempo

Aprendidas en los pilotos (`../../00-piloto*`). Ahórratelas.

**De la composición**

- Las transiciones animan la **capa interna** (`#sN-in`), nunca el contenedor
  del clip (`#sN`, el que tiene `data-start`). Animar el clip deja estados
  colgados al buscar en la línea de tiempo, y el linter lo rechaza.
- Después de cada salida va un **remate duro**: `tl.set("#sN-in", { opacity: 0 }, t)`
  al terminar el tween. Sin él, al saltar a un punto de la línea de tiempo la
  escena puede quedar visible.
- Las escenas que entran después llevan `style="opacity: 0"` **en línea** en su
  capa. El linter no reconoce el primer selector de una regla agrupada
  (`#s2-in, #s3-in { … }`).
- **Nada de `<br>`** en el texto: se suma al salto natural y encima dos líneas.
  Se controla el corte con `max-width`.
- Los `repeat` van con números explícitos que quepan en la escena. `Math.ceil`
  se pasa de la duración y el linter lo marca.
- Un texto gris sobre el filo naranja da ~1.5:1 de contraste. Si un rótulo cae
  encima de algo saturado, ponle chapa propia.

**De las tomas de video**

- Si una toma dura menos que su escena, **se congela o desaparece** a mitad de
  la escena. Es lo que pasa hoy: `t18` dura 0.27 s para una escena de 8.7 s y
  `t19` 1.57 s para una de 4.6 s. Comprobar siempre con
  `ffprobe -v error -show_entries format=duration tomas/<toma>.mp4`.
- El zoom sobre una toma se anima en un **contenedor**, no en el `<video>`.

**Del audio y los subtítulos**

- La voz se genera con `../../herramientas/voz-gemini.mjs`. Para redes va a
  **1.5×** con `--velocidad 1.5`: sintetiza a ritmo natural y estira con
  `atempo`, así los tiempos de cada frase se dividen por el mismo factor y el
  video sigue cuadrando. No le pidas al modelo que "hable rápido".
- La cuota gratuita de Gemini TTS es **por modelo** y tiene tope diario. Si se
  agota, `--listar-modelos` y `--modelo <otro>`.
- Los subtítulos salen de `audio/narracion.tiempos.json` con
  `../../herramientas/subtitulos.mjs --max 70` y se pegan **dentro** de
  `index.html`. Con `--max` bajo cortan a media frase.
- El nivel de la voz va en `data-volume="0.92"`: con 1.0 los picos llegan a
  −0.4 dB y distorsionan cuando Instagram o TikTok recomprimen.

**Del entorno (Windows)**

- En PowerShell 5.1, `>` escribe **UTF-16**. Así quedó `subtitulos.html`, que
  git ve como binario. No se usa (los subtítulos van dentro de `index.html`),
  pero si generas un archivo de texto usa `Out-File -Encoding utf8`, o Node.
- `render` puede **terminar con código 0 aunque haya fallado**. Verifica que el
  `.mp4` exista y mídelo con `ffprobe`.
- Un render de 1080p necesita ~2.5 GB libres de temporal. Sin espacio falla con
  `ENOSPC` a mitad del trabajo.

---

## Estado

| | |
|---|---|
| Base | `a63c86f` — el video tal como lo dejó Gemini |
| Render | 1080×1920 · 34 s · con audio |
| Tomas | `t17` ✅ 13.2 s · `t18` ❌ 0.27 s · `t19` ❌ 1.57 s |
| Ronda en curso | ninguna — esperando las mejoras de Gonzalo |
