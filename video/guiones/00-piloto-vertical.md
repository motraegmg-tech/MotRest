# Piloto vertical — «Un solo sistema» (00-piloto-vertical)

| | |
|---|---|
| **Formato** | **9:16 · 1080×1920** |
| **Duración** | 34 s |
| **Velocidad** | **1.5×** — el guion se cuenta al ritmo de redes |
| **Voz** | **Orus** (firme y cálida) |
| **Proyecto** | `video/00-piloto-vertical/` |
| **Narración** | [`00-piloto-voz.txt`](00-piloto-voz.txt) — el mismo guion que la versión 16:9 |
| **Capturas** | Ninguna. Todo es HTML animado |

Para WhatsApp Status, Reels, TikTok y Shorts. Es la versión que de verdad
circula: vertical, rápida y legible sin sonido.

---

## Qué cambia frente a la versión 16:9

| | 16:9 | 9:16 |
|---|---|---|
| Duración | 47.2 s | **34 s** |
| Voz | Charon, ritmo natural | **Orus, 1.5×** |
| Fondo | Tipografía fantasma gigante | **Sin ella** — la textura la ponen grano, resplandores, filos y reglas |
| Folio | Abajo a la derecha | Arriba a la derecha, con chapa propia |
| Subtítulos | 44 px, 14 clips | **52 px, 13 clips**, en la banda inferior |
| Contenido | Todo el cuadro | Por encima de los 1 380 px: abajo manda el subtítulo |

En vertical el contenido no puede bajar de los ~1 380 px. Por debajo va la banda
de subtítulos, y por debajo de eso los controles de la app que lo reproduce.

---

## Cómo se hizo el 1.5×

**No** se le pide a Gemini que hable rápido: cada bloque saldría a un ritmo
distinto y el cuadre se rompería. Se sintetiza a ritmo natural y se estira el
resultado con `atempo` de ffmpeg, que conserva el tono y es exacto:

```bash
node herramientas/voz-gemini.mjs guiones/00-piloto-voz.txt \
  --salida 00-piloto-vertical/audio/narracion.wav \
  --voz Orus --velocidad 1.5 --modelo gemini-3.1-flash-tts-preview
```

Como el estirado es uniforme, **todas las marcas de tiempo se dividen por el
mismo factor**: el script las reescala solo y el video sigue cuadrando. Queda
también `narracion.natural.wav`, por si algún día se quiere el ritmo original.

> **Cuota de Gemini:** el límite diario del plan gratuito es **por modelo**. Se
> agotó `gemini-2.5-flash-tts` y esta voz salió con
> `gemini-3.1-flash-tts-preview`. Los modelos disponibles se consultan con
> `node herramientas/voz-gemini.mjs --listar-modelos`.

---

## Mapa de tiempos

Voz Orus a 1.5× · 33.03 s:

| Bloque | t | Escena |
|---|---|---|
| b1 | 0.00 – 1.49 | 1 · Gancho |
| b2 | 1.86 – 4.95 | 1 · Gancho |
| b3 | 5.32 – 13.32 | 2 · Piezas sueltas |
| b4 | 13.69 – 24.25 | 3 · Un solo sistema |
| b5 | 24.61 – 28.05 | 3 · Un solo sistema |
| b6 | 28.42 – 33.03 | 4 · Cierre |

Las transiciones arrancan en el silencio *entre* bloques (`T` en el `<script>`),
así que cada escena ya está puesta cuando la voz entra.

---

## Estado

`npx hyperframes check` pasa: **0 errores** de lint, layout, movimiento y
contraste. Quedan los dos avisos estructurales de siempre (archivo de 315 líneas
y 13 subtítulos en una pista), asumidos para un piloto.
