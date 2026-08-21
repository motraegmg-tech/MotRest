# frame.md — Identidad visual del video MotRest

Especificación de marca para todas las composiciones de HyperFrames en `video/`.
Fuente de verdad: `packages/ui/src/tokens.css` (ADR-10 del TRD §14) — la misma
paleta que se ve en la interfaz real del sistema, para que los gráficos del video
no choquen con las capturas de pantalla.

> **Nota de contradicción documentada:** el `README.md` §12 declara el verde
> `#57AD30` como acento dominante. La interfaz real usa **naranja** `#F2853A`.
> Para video manda la interfaz: si los overlays fueran verdes chocarían con cada
> captura. El verde conserva su semántica: lo que SUMA.

## Colors

| Rol | Hex | Uso en video |
|---|---|---|
| Acento dominante | `#F2853A` | Títulos clave, callouts, subrayados, barras de progreso, CTA |
| Ámbar de apoyo | `#E6B23A` | Segundo nivel de énfasis, estados intermedios |
| Lo que suma | `#57AD30` | Cifras positivas: ahorro, margen, entradas de almacén, resultado del día |
| Alerta | `#E0392B` | Mermas, cancelaciones, lo que el centinela detecta |
| Fondo premium | `#14181A` | Gancho de apertura, cierre, cartones de texto |
| Pizarra | `#2D3A42` | Fondos secundarios, barras inferiores, lower thirds |
| Texto principal sobre oscuro | `#FFFFFF` | Titulares |
| Texto secundario | `#8A969C` | Subtítulos de apoyo, pies, atribuciones |
| Realce cálido | `#FDEBD7` | Chips y tintes sobre fondo oscuro, con moderación |

Degradado de energía `#F2853A → #E0392B`: **solo** en el cartón de apertura y en
el de cierre, y nunca como degradado lineal a pantalla completa (produce bandeo
en H.264). Usarlo como forma diagonal, filo de borde o glow radial localizado.

## Typography

- **Títulos:** Space Grotesk — pesos 500 y 700. Archivos en `video/fonts/`.
- **Cuerpo y subtítulos:** Inter — pesos 400 y 600. Archivos en `video/fonts/`.
- Tamaños mínimos para render de video: titulares 72 px+, cuerpo 32 px+,
  etiquetas de dato 24 px+. En vertical (1080×1920): titulares 84 px+,
  subtítulos quemados 56 px+.
- `font-variant-numeric: tabular-nums` en toda columna o contador de cifras.
- Espaciado de letra: `-0.02em` en titulares de Space Grotesk; `0` en Inter.

```css
@font-face { font-family: "Space Grotesk"; src: url("fonts/space-grotesk-latin-500-normal.woff2") format("woff2"); font-weight: 500; }
@font-face { font-family: "Space Grotesk"; src: url("fonts/space-grotesk-latin-700-normal.woff2") format("woff2"); font-weight: 700; }
@font-face { font-family: "Inter"; src: url("fonts/inter-latin-400-normal.woff2") format("woff2"); font-weight: 400; }
@font-face { font-family: "Inter"; src: url("fonts/inter-latin-600-normal.woff2") format("woff2"); font-weight: 600; }
```

## Corners and depth

- Radios: `12px` en chips y callouts, `16px` en tarjetas, `999px` en píldoras.
  Coinciden con `--r-md`, `--r-lg` y `--r-pill` del sistema.
- Profundidad: sombras suaves y glow naranja localizado
  (`0 6px 16px rgba(242,133,58,.28)`). Nada de sombras duras ni bordes de 1 px
  grises sobre fondo oscuro (desaparecen al comprimir).

## Motion

- Marca: *moderna, profesional, con movimiento*. Entradas decididas, nunca
  rebotes caricaturescos.
- Eases preferidos: `power3.out` para entradas, `expo.out` para titulares,
  `power2.inOut` para movimientos de cámara sobre las capturas.
- Los zooms sobre las capturas de pantalla son lentos y continuos
  (2–4 s, `scale` de 1.0 a 1.25 máximo). El sistema tiene que leerse.
- Los callouts entran 0.4 s después de que la acción ocurre en pantalla, nunca antes.

## Voz y tono

Español de México, profesional, directo, sin superlativos vacíos. Se habla de
dinero y de control, no de "soluciones innovadoras". Frases cortas. El sistema
se muestra, no se elogia.

## What NOT to do

- **No** usar verde `#57AD30` como acento dominante: choca con la interfaz real.
- **No** mostrar módulos que aún son roadmap como si existieran. Ver la bandera
  `operativo` y los campos `enF1` / `etapa` en `apps/pos-ui/src/lib/nav/modulos.ts`.
  Voz del Cliente y Copiloto por WhatsApp son F3: se pueden nombrar como visión,
  jamás mostrar como pantalla.
- **No** exhibir datos reales de Rodizio: nombres de comensales, RFC, montos
  reales, teléfonos. Solo datos de demostración.
- **No** degradados lineales a pantalla completa sobre fondo oscuro (bandeo H.264).
- **No** inventar cifras de ahorro, porcentajes de merma ni comparativas de precio.
  Si un número aparece en pantalla, sale de la interfaz.
- **No** sustituir las tipografías: Space Grotesk e Inter están en `video/fonts/`.
- **No** poner logotipos de terceros (Soft Restaurant, Wansoft, Uber Eats, Rappi)
  en la comparativa. Se dice "el punto de venta común", sin marca ajena.
