# Video 3 — «Lo que se te va sin que lo veas»

| | |
|---|---|
| **Formato** | **9:16 · 1080×1920** (vertical) |
| **Duración objetivo** | 40–45 s |
| **Uso** | WhatsApp Status, Reels, TikTok, Shorts — el formato que circula solo entre restauranteros |
| **Narración** | [`03-lo-que-se-te-va-voz.txt`](03-lo-que-se-te-va-voz.txt) (87 palabras) |
| **Proyecto** | `video/03-lo-que-se-te-va/` |

**Idea en una línea:** el diferencial puro, en cuarenta segundos y sin sonido.

---

## Escaleta

| # | t (aprox) | Escena | Toma | Overlay |
|---|---|---|---|---|
| 0 | 0:00–0:05 | **Gancho** — negro, texto enorme | — | «¿Cuánto dinero se te fue ayer…» / «…sin que nadie lo notara?» |
| 1 | 0:05–0:17 | Centinela de mermas | `t17-centinela.mp4` | Etiqueta roja `#E0392B`: *anomalía detectada* · Zoom a la alerta |
| 2 | 0:17–0:29 | Ingeniería de menú | `t18-ingenieria-menu.mp4` | Las cuatro clases entrando en escalera |
| 3 | 0:29–0:37 | Pronóstico de demanda | `t19-pronostico.mp4` | Zoom al viernes de la barra de pronóstico |
| 4 | 0:37–0:45 | **Cierre** — negro | — | «Ningún software restaurantero del mercado hace esto hoy.» + logo + www.motrae.com |

**Ritmo declarado:** golpe seco · hold · hold · golpe · resolución. Sin respiros
largos: en vertical, tres segundos sin cambio es una salida del video.

---

## Reglas propias del vertical

- **Subtítulos quemados obligatorios**, grandes (Inter 600, 56 px+), centrados en
  el tercio medio, con fondo pizarra al 80 % detrás del texto. Más de la mitad de
  la gente lo va a ver sin sonido: si no se entiende mudo, el video no sirve.
- La captura es 16:9 y el lienzo es 9:16: **no** se encoge la captura hasta que
  quepa. Se hace zoom sobre la zona útil de cada pantalla (`scale` 1.6–2.0) y se
  encuadra la parte que importa. Por eso las tomas de este video se graban
  **con la pantalla ya posicionada** en la sección relevante.
- Zona segura: nada de texto en los primeros 220 px ni en los últimos 320 px del
  lienzo (ahí van los controles de las apps).
- La marca aparece desde el segundo 1 en una esquina, pequeña: en redes el video
  se ve una vez y no siempre hasta el final.

---

## Lista de tomas a grabar

| Archivo | Pantalla (módulo · sección) | Acción a grabar | Duración |
|---|---|---|---|
| `t17-centinela.mp4` | Inteligencia · Reportes → bloque **Centinela de mermas** | Recorrer las anomalías detectadas: qué insumo, qué turno, cuánto | 14 s |
| `t18-ingenieria-menu.mp4` | Inteligencia · Reportes → bloque **Ingeniería de menú** | La matriz con las cuatro clases y un platillo de cada una | 14 s |
| `t19-pronostico.mp4` | Inteligencia · Reportes → bloque de **pronóstico** (cabecera) | Los próximos días con su venta esperada, deteniéndose en el viernes | 10 s |

**Dos avisos importantes para grabar estas tomas:**

1. Los nombres en pantalla son **estrella · caballo · rompecabezas · perro**
   (así los clasifica [`Inteligencia.svelte`](../../apps/pos-ui/src/lib/modulos/Inteligencia.svelte)),
   no «vaca» ni «enigma» como dice el README. La narración ya está escrita para
   no nombrarlos y evitar la contradicción: se habla de «margen y popularidad».
2. El pronóstico muestra **«Aprendiendo · N días observados»** mientras no haya
   una semana completa de historia. Para grabar, el ambiente de demostración
   necesita al menos siete días de cuentas cerradas, o la toma delata que el
   módulo va vacío.
3. El centinela y la ingeniería de menú **solo se muestran a un perfil con acceso
   a costos** (`verCostos`). Grabar con un usuario de dirección, no con uno de caja.

---

## Música

```
Tense minimal electronic that resolves into confidence, 100 BPM, instrumental,
sparse pulse, rising tension in the first half, bright resolve at 0:28, 45 seconds
```

Mezcla: entrada 0.30 → cuerpo 0.16 → cierre 0.34. En vertical la música pesa más
que en 16:9: es lo que sostiene el ritmo cuando el espectador ve sin sonido y
vuelve a activarlo.
