# Piloto — «Un solo sistema» (00-piloto)

| | |
|---|---|
| **Formato** | 16:9 · 1920×1080 |
| **Duración** | 47.2 s |
| **Proyecto** | `video/00-piloto/` |
| **Narración** | [`00-piloto-voz.txt`](00-piloto-voz.txt) (6 bloques, 46.1 s de voz) |
| **Capturas** | **Ninguna.** Todo es HTML animado |

**Para qué existe:** probar la cadena completa —voz, música, subtítulos, marca y
render— antes de invertir una sesión entera en grabar el sistema. Y de paso queda
un *teaser* usable por sí solo: no promete ninguna pantalla que no se enseñe.

---

## Las cuatro escenas

| # | t | Escena | Qué se ve |
|---|---|---|---|
| 1 | 0 – 7.6 | **Gancho** | «¿Cuánto ganaste ayer?» → «No cuánto vendiste. Cuánto **ganaste**.» |
| 2 | 6.9 – 18.1 | **Piezas sueltas** | Cuatro tarjetas ladeadas y desconectadas: punto de venta, contabilidad, nómina, compras por WhatsApp |
| 3 | 17.4 – 38.9 | **Un solo sistema** | Los nueve módulos se ensamblan **al ritmo en que la voz los enumera**, y al final baja la regla naranja: «una sola base de datos» |
| 4 | 38.25 – 47.2 | **Cierre** | Marca, lema, contacto y *Innovation already in motion* |

Transiciones: direccional (1→2), zoom con desenfoque (2→3, el acento: las piezas
se resuelven), y disolución suave (3→4).

---

## Cómo está cuadrado con la voz

El mapa de tiempos vive al principio del `<script>` de `index.html`, en la
constante `T`, y **todo lo demás cuelga de ahí**. Cada transición arranca en el
silencio *entre* dos bloques de narración, para que la escena ya esté puesta
cuando la voz entra.

Si se regenera la voz (otra voz, otro guion), el trabajo es:

```bash
node herramientas/voz-gemini.mjs guiones/00-piloto-voz.txt \
  --salida 00-piloto/audio/narracion.wav --voz Charon
node herramientas/subtitulos.mjs 00-piloto/audio/narracion.tiempos.json --max 52 --pista 7
```

…y luego ajustar los cuatro números de `T` contra el nuevo `narracion.tiempos.json`
y pegar los subtítulos nuevos. Nada más.

> **Nota sobre Gemini:** el plan gratuito admite 3 peticiones por minuto, así que
> `voz-gemini.mjs` espera 21 s entre bloques y reintenta si le devuelven 429.
> Con plan de pago, `--ritmo 0` y sale en segundos.

---

## Audio

| Pista | Contenido |
|---|---|
| 5 | Narración (`narracion.wav`), volumen 1 |
| 6 | Música en tres tramos de `musica-a.mp3`: 0.32 en la entrada, **0.11 bajo la voz**, 0.26 en el cierre |
| 7 | 14 subtítulos generados de los tiempos de la voz |

Suno entregó dos versiones. Está montada la **A**; para probar la B basta cambiar
`musica-a.mp3` por `musica-b.mp3` en los tres `<audio>` de la pista 6.

---

## Estado de la revisión

`npx hyperframes check` pasa: 0 errores de lint, layout, movimiento y contraste.
Quedan dos avisos asumidos:

- **El archivo tiene 324 líneas.** El linter prefiere partir las escenas en
  sub-composiciones. Para los videos 1–3, que además llevan capturas, conviene
  hacerlo; en el piloto no compensa.
- **Solapamiento del folio consigo mismo durante 0.12 s**, en el cruce de la
  escena 2 a la 3. Es lo que hace una disolución: las dos escenas coexisten un
  instante.
