# Video promocional de MotRest

Tres videos «sin cara»: solo voz e interfaz real del sistema. Aquí vive todo lo
necesario para producirlos — guiones, marca, herramientas y composiciones.

| Video | Formato | Duración | Para qué |
|---|---|---|---|
| [0 · Piloto «Un solo sistema»](guiones/00-piloto.md) | 16:9 | 47 s | Prueba de la cadena completa · teaser sin capturas |
| [0v · Piloto vertical](guiones/00-piloto-vertical.md) | **9:16** | 34 s | Redes: Reels, TikTok, Shorts, WhatsApp Status · voz Orus a 1.5× |
| [1 · Un viernes completo](guiones/01-un-viernes-completo.md) | 16:9 | 105–115 s | El ancla: landing, correo, primera reunión |
| [2 · Piezas sueltas](guiones/02-piezas-sueltas.md) | 16:9 | 75–85 s | Redes, para quien ya tiene un POS |
| [3 · Lo que se te va](guiones/03-lo-que-se-te-va.md) | 9:16 | 40–45 s | WhatsApp Status, Reels, TikTok |

> **En pausa (ago-2026):** los videos 1, 2 y 3 están detenidos a la espera de
> las capturas de pantalla. Los guiones y las listas de tomas ya están escritos
> y no caducan. Lo vivo ahora mismo son los dos pilotos.

La identidad visual de todos está en [`frame.md`](frame.md) — HyperFrames la lee
antes de escribir una sola línea de HTML.

---

## Antes de empezar: dos cosas que faltan en esta máquina

`npx hyperframes doctor` reporta dos ausencias que **sí** hacen falta:

```powershell
# 1. FFmpeg — sin esto no se puede renderizar ni leer los .mp4 de las capturas
winget install --id Gyan.FFmpeg -e

# 2. Un grabador de pantalla. OBS da más control (área exacta, sin cursor gigante):
winget install --id OBSProject.OBSStudio -e
```

Windows 11 trae la **Barra de juegos** (`Win`+`G`) como alternativa a OBS, pero
graba la ventana completa y no deja elegir el área.

Lo que **no** hace falta: whisper, Kokoro ni MusicGen. La voz la pone Gemini, la
música la pone Suno, y los tiempos de los subtítulos salen del propio guion
(ver «Voz», abajo).

---

## Orden de trabajo

### 1. Llaves

```powershell
Copy-Item .env.example .env
# pegar dentro:  GEMINI_API_KEY  y  SUNO_API_KEY
```

`video/.env` está ignorado por git. Las llaves **nunca** al repositorio.

### 2. Grabar las tomas

Cada guion trae su lista de tomas con el nombre exacto del archivo, la pantalla,
la acción y la duración. Los `.mp4` van a [`tomas/`](tomas/) (ignorada por git:
pesan demasiado).

Reglas que valen para las tres listas:

- 1920×1080, 60 fps, **sin audio**, cursor visible sin efectos.
- **Una acción por toma**, movimientos lentos y deliberados.
- **2 segundos de aire** al principio y al final: el montaje los necesita para
  entrar y salir con transición.
- Sin notificaciones de Windows en pantalla. Modo concentración activado.
- **Datos de demostración, nunca datos reales de Rodizio**: sin nombres de
  comensales, sin RFC, sin teléfonos, sin montos reales.
- **Solo módulos operativos.** Lo que sea roadmap no se graba: la bandera está en
  [`apps/pos-ui/src/lib/nav/modulos.ts`](../apps/pos-ui/src/lib/nav/modulos.ts)
  (`operativo`, `enF1`, `etapa`).
- Todas las tomas de un video, **en una sola sesión y en orden**: los importes y
  la hora del sistema tienen que ser coherentes de una toma a la siguiente.

Sobre qué grabar: la **app instalada** (`MotRest_1.3.x`) con datos de
demostración. Alternativa rápida en navegador: `pnpm --filter pos-ui dev` (sirve
por HTTPS en localhost, que es lo que exige `crypto.subtle`), con la salvedad de
que fuera del Hub no hay impresión ni licencia.

### 3. Voz

```bash
node herramientas/voz-gemini.mjs --listar-voces
node herramientas/voz-gemini.mjs guiones/01-un-viernes-completo-voz.txt \
  --salida 01-un-viernes-completo/audio/narracion.wav --voz Charon
```

El script sintetiza **párrafo por párrafo** y los une con silencio real, así que
el ritmo de las pausas se controla desde aquí (`--pausa`, en milisegundos) y no
queda a criterio del modelo.

De regalo escribe `narracion.tiempos.json` con el inicio y el fin de cada frase.
**Esos son los subtítulos**: como sabemos exactamente dónde empieza y termina cada
bloque, no hace falta transcribir nada. (Solo el karaoke palabra por palabra
pediría whisper de verdad.)

> **Plan gratuito de Gemini.** Hay dos límites y los dos son **por modelo**:
> 3 peticiones por minuto (el script espera 21 s entre bloques y reintenta ante
> un 429) y un tope diario. Si se agota el diario, cambia de modelo:
> `node herramientas/voz-gemini.mjs --listar-modelos` y luego `--modelo <otro>`.
> Con plan de pago: `--ritmo 0`.

Para redes, el guion se cuenta más rápido:

```bash
node herramientas/voz-gemini.mjs guiones/00-piloto-voz.txt \
  --salida 00-piloto-vertical/audio/narracion.wav --voz Orus --velocidad 1.5
```

`--velocidad` **no** le pide a Gemini que hable deprisa —cada bloque saldría
distinto y el cuadre se rompería—: sintetiza a ritmo natural y estira el
resultado con `atempo`, que conserva el tono. Como el estirado es uniforme, los
tiempos de cada frase se dividen por el mismo factor y el video sigue cuadrando.

Después, los subtítulos:

```bash
node herramientas/subtitulos.mjs 00-piloto/audio/narracion.tiempos.json --max 52 --pista 7
```

Parte cada frase en trozos legibles, les reparte la duración y escupe los clips
HTML por pantalla, listos para pegar en la composición. No los inyecta solo a
propósito: el HTML es la fuente de verdad del video.

Antes de generar el guion completo, prueba el gancho con dos o tres voces:

```bash
head -6 guiones/01-un-viernes-completo-voz.txt > /tmp/gancho.txt
node herramientas/voz-gemini.mjs /tmp/gancho.txt --voz Charon --salida pruebas/charon.wav
node herramientas/voz-gemini.mjs /tmp/gancho.txt --voz Kore   --salida pruebas/kore.wav
```

### 4. Música

```bash
node herramientas/musica-suno.mjs --prompt-de 01 --seco   # ver qué enviaría
node herramientas/musica-suno.mjs --prompt-de 01          # generar de verdad
```

Los prompts de los tres videos están registrados dentro del script y espejados en
la sección «Música» de cada guion. Siempre **instrumental**: encima va la voz.

Suno tarda minutos y entrega dos versiones. Si se corta la espera, la tarea sigue
viva: `node herramientas/musica-suno.mjs --tarea <taskId>`.

### 5. Componer

```bash
npx hyperframes init 01-un-viernes-completo
npx hyperframes preview
```

Estructura de pistas de las tres composiciones:

| Pista | Contenido |
|---|---|
| 0 | Las tomas `.mp4` (`muted playsinline`), cada una dentro de un `div` no temporizado — el zoom se anima **sobre el wrapper**, jamás sobre el `<video>` |
| 1 | Overlays: títulos, callouts, lower thirds, comparativas |
| 2 | `<audio>` de la narración, `data-volume="1"` |
| 3 | Música, partida en tres clips con distinto `data-volume` (entrada · cuerpo bajo la voz · cierre) usando `data-media-start`. Es la manera de hacer *ducking* sin animar volumen, cosa que HyperFrames no permite |
| 4 | Subtítulos, tomados de `narracion.tiempos.json` |

### 6. Revisar y entregar

```bash
npx hyperframes lint
npx hyperframes validate          # incluye contraste WCAG
npx hyperframes inspect           # texto que se sale de cuadro
npx hyperframes render --output MotRest_Promo_01.mp4
```

El `.mp4` final se copia a [`../entregables/`](../entregables/).

**Revisión final, siempre:**

1. Verlo **con el sonido apagado**. Así lo va a ver la mitad de la gente. Si no se
   entiende solo con los subtítulos, el video no está terminado.
2. Ninguna toma con datos reales de Rodizio ni con módulos de roadmap.
3. Cifras coherentes entre tomas. El ojo lo nota aunque nadie sepa decir por qué.

---

## Estructura

```
video/
  frame.md              Identidad visual (paleta, tipografía, qué NO hacer)
  .env.example          Nombres de las llaves; copiar a .env y llenar
  fonts/                Space Grotesk e Inter, para que el render no dependa de red
  guiones/              Un .md (escaleta + tomas) y un -voz.txt (narración) por video
  tomas/                Capturas de pantalla crudas · ignorada por git
  herramientas/
    voz-gemini.mjs      Guion .txt -> narracion.wav + tiempos por frase
    musica-suno.mjs     Prompt -> pista instrumental .mp3
    subtitulos.mjs      Tiempos por frase -> clips de subtítulo en HTML
  00-piloto/                Proyectos de HyperFrames (uno por video)
  00-piloto-vertical/
  01-un-viernes-completo/
  02-piezas-sueltas/
  03-lo-que-se-te-va/
```
