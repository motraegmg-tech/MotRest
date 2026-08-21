# Video 2 — «Piezas sueltas»

| | |
|---|---|
| **Formato** | 16:9 · 1920×1080 |
| **Duración objetivo** | 75–85 s |
| **Uso** | Redes (LinkedIn, Facebook), retargeting. Para quien **ya tiene un POS** y cree que el tema está resuelto |
| **Narración** | [`02-piezas-sueltas-voz.txt`](02-piezas-sueltas-voz.txt) (224 palabras) |
| **Proyecto** | `video/02-piezas-sueltas/` |

**Idea en una línea:** enseñar exactamente el punto donde un punto de venta se
detiene y MotRest sigue caminando.

---

## Escaleta

| # | t (aprox) | Escena | Toma | Overlay |
|---|---|---|---|---|
| 0 | 0:00–0:12 | **Gancho** — cartón negro | — | «Tu restaurante no tiene un problema de ventas.» / «Tiene un problema de **piezas sueltas**.» |
| 1 | 0:12–0:18 | Puente | — | Cuatro chips que caen desordenados: *POS · contabilidad · nómina · WhatsApp* |
| 2 | 0:18–0:28 | Costeo | `t11-receta-costeo.mp4` | Par comparativo 1 |
| 3 | 0:28–0:38 | Finanzas | `t12-resultado-cfdi.mp4` | Par comparativo 2 |
| 4 | 0:38–0:47 | Personal | `t13-personal.mp4` | Par comparativo 3 |
| 5 | 0:47–0:56 | Compras | `t14-compras.mp4` | Par comparativo 4 |
| 6 | 0:56–1:06 | Permisos y bitácora | `t15-usuarios-bitacora.mp4` | Par comparativo 5 |
| 7 | 1:06–1:15 | Inteligencia | `t16-inteligencia.mp4` | Par comparativo 6 |
| 8 | 1:15–1:25 | **Cierre** — cartón negro | — | Frase de cierre + contacto |

**Patrón del «par comparativo»** (la firma visual de este video, se repite seis veces):

1. La pantalla se divide. En la izquierda, una tarjeta pizarra `#2D3A42` con la
   frase del POS en gris `#8A969C` — y **se apaga**: baja a 35 % de opacidad y se
   desatura. Es el muro.
2. La derecha se abre y entra la captura real de MotRest, a tamaño completo,
   empujando el borde de la tarjeta apagada.
3. Un callout naranja nombra lo que se está viendo.

El apagado es una animación de **entrada** de la escena siguiente, no una salida
de la anterior: HyperFrames prohíbe animaciones de salida salvo en la escena final.

**Ritmo declarado:** golpe · golpe · golpe · golpe · golpe · golpe · resolución.
Sin holds. Cada par dura lo que dura su frase, ni un segundo más.

---

## Los seis pares

| # | Izquierda (se apaga) | Derecha (captura real) |
|---|---|---|
| 1 | «Costeo por receta, a grandes rasgos» | Cocina · Editor de receta: costo por ingrediente |
| 2 | «Contabilidad por enlace externo» | Finanzas · Resultado del día + factura CFDI |
| 3 | «Recursos humanos, fuera» | Personal · Checador, rol de mesas, prenómina |
| 4 | «Aviso cuando ya se acabó» | Compras · Qué pedir según consumo real |
| 5 | «Permisos básicos» | Administración · Usuarios, permisos y bitácora |
| 6 | «Reportes a fin de mes» | Inteligencia · Ventas por producto, mesero y hora |

---

## Lista de tomas a grabar

Mismas reglas que el video 1: 1920×1080, 60 fps, sin audio, 2 s de aire, una
acción por toma, datos de demostración.

| Archivo | Pantalla (módulo · sección) | Acción a grabar | Duración |
|---|---|---|---|
| `t11-receta-costeo.mp4` | Cocina · Menú → Editor de receta | Abrir la receta de una pizza y recorrer el desglose de insumos con su costo | 12 s |
| `t12-resultado-cfdi.mp4` | Finanzas · Resultado, y luego Facturación | Resultado del día y, con un corte, el diálogo de factura CFDI | 12 s |
| `t13-personal.mp4` | Personal · Checador → Prenómina | Una checada por PIN y luego la prenómina con horas y propinas | 12 s |
| `t14-compras.mp4` | Compras · Proveedores y órdenes | La sugerencia de qué pedir y la orden de compra generada | 12 s |
| `t15-usuarios-bitacora.mp4` | Administración · Usuarios y permisos → Bitácora | Recorrer los permisos de un rol y luego la bitácora con una cancelación | 14 s |
| `t16-inteligencia.mp4` | Inteligencia · Reportes | Ventas por producto, por mesero y por hora | 12 s |

---

## Música

```
Driving modern electronic, purposeful and confident, 118 BPM, instrumental,
tight percussion, staccato synth stabs, no vocals, hard stop at the end, 85 seconds
```

Mezcla: entrada 0.35 → cuerpo 0.14 → cierre 0.30. El corte final de la música cae
**exactamente** en la última sílaba de la narración.
