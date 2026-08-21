# Video 1 — «Un viernes completo»

| | |
|---|---|
| **Formato** | 16:9 · 1920×1080 · 30 fps de render |
| **Duración objetivo** | 105–115 s |
| **Uso** | Landing, correo de prospección, primera reunión, WhatsApp a un dueño |
| **Narración** | [`01-un-viernes-completo-voz.txt`](01-un-viernes-completo-voz.txt) (240 palabras) |
| **Proyecto** | `video/01-un-viernes-completo/` |

**Idea en una línea:** un servicio entero atravesando el sistema, de la mesa al
estado de resultados, para responder la pregunta que ningún POS responde.

---

## Escaleta

| # | t (aprox) | Escena | Toma | Overlay |
|---|---|---|---|---|
| 0 | 0:00–0:14 | **Gancho** — cartón negro, sin captura | — | Texto grande en tres golpes |
| 1 | 0:14–0:22 | Salón: se abre la mesa 4 | `t01-salon.mp4` | Lower third: *M1 · Venta* |
| 2 | 0:22–0:38 | Configurador mitad-y-mitad | `t02-mitad-y-mitad.mp4` | Callout naranja: *costeo por ingrediente, no por platillo* |
| 3 | 0:38–0:48 | KDS con cronómetro y semáforo | `t04-kds.mp4` | Zoom lento al semáforo · Lower third: *M2 · Cocina* |
| 4 | 0:48–1:04 | Inventario descontándose solo | `t05-inventario.mp4` | Callout naranja: *nadie capturó nada* · Zoom a las tres existencias |
| 5 | 1:04–1:14 | Cobro, ticket y factura por QR | `t06-cobro.mp4` + `t07-qr-portal.mp4` | PiP del teléfono entrando por la derecha |
| 6 | 1:14–1:27 | Corte de caja sellado + bitácora | `t08-corte.mp4` + `t10-bitacora.mp4` | Callout: *se sella, no se cuadra* |
| 7 | 1:27–1:38 | Resultado del día | `t09-resultado.mp4` | Zoom a la cifra de utilidad, realce verde `#57AD30` |
| 8 | 1:38–1:50 | **Cierre** — cartón negro | — | Logo, frase, contacto, *Innovation already in motion* |

**Ritmo declarado:** hold-lento · normal · **hold largo (mitad-y-mitad)** · rápido ·
**hold largo (inventario)** · rápido-rápido · resolución. El corazón del video son
las escenas 2 y 4: ahí se demuestra lo que nadie más hace.

---

## Lista de tomas a grabar

Todas: 1920×1080, 60 fps, sin audio, cursor visible sin efectos, **2 segundos de
aire** al principio y al final. Una sola acción por toma. Datos de demostración,
nunca datos reales de Rodizio.

| Archivo | Pantalla (módulo · sección) | Acción a grabar | Duración |
|---|---|---|---|
| `t01-salon.mp4` | Venta · Salón y comandas | Vista del plano de piso, clic en la mesa 4, se abre la comanda vacía | 12 s |
| `t02-mitad-y-mitad.mp4` | Venta · Configurador de producto | Elegir pizza, abrir el configurador, elegir mitad hawaiana y mitad pepperoni, aceptar; **el precio se recalcula a la vista** | 20 s |
| `t03-cuenta.mp4` | Venta · Panel de cuenta | El renglón ya en la cuenta con las dos mitades desglosadas | 8 s |
| `t04-kds.mp4` | Cocina · Tablero | Enviar a cocina desde la caja y **cortar** al tablero de KDS: la comanda aparece, el cronómetro corre, el semáforo cambia | 14 s |
| `t05-inventario.mp4` | Inventario · Existencias y mermas | Las existencias de harina, queso y pepperoni **después** del envío a cocina; recorrer las tres líneas despacio | 16 s |
| `t06-cobro.mp4` | Venta · Cobro | Cobrar la cuenta, forma de pago, ticket impreso en pantalla con el QR visible | 12 s |
| `t07-qr-portal.mp4` | Portal del comensal (teléfono) | Escanear el QR con el celular y que aparezca la autofactura. Grabar la pantalla del teléfono, vertical | 10 s |
| `t08-corte.mp4` | Finanzas · Caja | Corte de caja: arqueo contra el efectivo real y sellado | 14 s |
| `t09-resultado.mp4` | Finanzas · Resultado | Resultado del día: venta, costo y utilidad | 12 s |
| `t10-bitacora.mp4` | Administración · Bitácora | Recorrer la bitácora: quién canceló, quién dio cortesía, a qué hora | 10 s |

**Coherencia entre tomas (el ojo lo nota):** el mismo restaurante, la misma mesa 4,
los mismos importes de una toma a otra, y el reloj del sistema avanzando hacia la
noche de un viernes. Grabar en una sola sesión, en orden.

---

## Overlays por escena

- **Gancho (0:00–0:14):** fondo `#14181A`. Tres líneas que entran una a una en
  Space Grotesk 700, 120 px, blanco; la palabra «ganaste» en `#F2853A`.
  Filo diagonal del degradado de energía en la esquina inferior derecha.
- **Lower thirds:** píldora pizarra `#2D3A42`, texto Inter 600, 32 px, con punto
  naranja. Entran 0.4 s después del corte, salen con la transición.
- **Callouts:** tarjeta `#14181A` al 92 % de opacidad, borde izquierdo naranja
  de 4 px, radio 12 px, con línea guía hacia el punto exacto de la interfaz.
- **Cierre (1:38–1:50):** logo MotRest, «Un solo sistema. Una sola base de datos.»,
  contacto (motrae.gmg@gmail.com · 228 353 6911 · www.motrae.com) y el pie
  *MOTRAE · Innovation already in motion*.

---

## Música

Prompt para Suno (instrumental):

```
Modern corporate tech, warm optimism, 92 BPM, instrumental, subtle percussion and
warm pads, quiet sparse intro, builds at 0:45, confident clean resolve, 120 seconds
```

Mezcla: entrada 0.35 → cuerpo 0.12 (bajo la voz) → cierre 0.30, partida en tres
clips de la misma pista con `data-media-start`.
