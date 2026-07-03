# MotRest — Presentación comercial · Bundle para Claude Design

Paquete de **14 láminas editables** (HTML autocontenido, 1920×1080) listo para subirse a un proyecto de **Claude Design** (claude.ai/design). Cada lámina es un archivo independiente: se puede editar, reordenar o duplicar sin afectar a las demás.

## Contenido

| Archivo | Lámina |
|---|---|
| `index.html` | **Deck completo navegable** — las 14 láminas en un solo archivo, con flechas, teclado (←/→, espacio, Home/End), contador, barra de progreso y pantalla completa. Se genera con `node build-deck.js`; no editarlo a mano: editar las láminas de `slides/` y regenerar. |
| `slides/01-portada.html` | Portada — MotRest, el sistema operativo del restaurante (fondo oscuro) |
| `slides/02-el-problema.html` | El problema: 6 costos de operar con piezas sueltas |
| `slides/03-la-solucion.html` | La solución: frase eje + 3 pilares |
| `slides/04-nueve-modulos.html` | Los 9 módulos integrados (grid M1–M9) |
| `slides/05-mas-que-un-pos.html` | Comparativa POS común vs MotRest ERP AI-first |
| `slides/06-panel-por-roles.html` | Jerarquía de visión y administración (organigrama) |
| `slides/07-copiloto-del-dueno.html` | Copiloto del Dueño con mockup de chat WhatsApp |
| `slides/08-capacidades-ai-first.html` | Portada de sección: 5 capacidades AI-first (fondo oscuro) |
| `slides/09-capacidades-1-3.html` | Gemelo digital · Menu engineering · Compras/turnos autónomos |
| `slides/10-capacidades-4-5.html` | Voz del Cliente · Centinela de mermas |
| `slides/11-respaldo-motrae.html` | Plataforma 4 capas + DELTA OPS + ODS 9 y 12 |
| `slides/12-caso-rodizio.html` | Caso ancla Rodizio + plan por fases F0–F4 |
| `slides/13-modelo-comercial.html` | Modelo sin cifras: suscripción + resultado + garantía |
| `slides/14-cierre.html` | CTA Diagnóstico 360° + contacto (fondo oscuro) |

## Mockups del producto (grupos "Producto · Pantallas" y "Producto · Renders")

| Archivo | Contenido |
|---|---|
| `producto/p1-pos-mitad-y-mitad.html` | POS: mapa de salón, configurador mitad-y-mitad con costeo en vivo, cuenta (1920×1080) |
| `producto/p2-kds-cocina.html` | KDS oscuro: 4 estaciones con timers y semáforo de tiempos (1920×1080) |
| `producto/p3-dashboard-direccion.html` | Dashboard Dirección: KPIs, real vs pronóstico (SVG), P&L, alertas (1920×1080) |
| `producto/p4-menu-engineering.html` | Matriz margen × popularidad + recomendaciones del agente (1920×1080) |
| `producto/p5-centinela-mermas.html` | Feed de anomalías con severidad + merma vs línea base (1920×1080) |
| `producto/p6-copiloto-whatsapp.html` | Copiloto del Dueño estilo WhatsApp (430×932, teléfono) |
| `renders/r1…r6-*.html` | Cada pantalla montada en su dispositivo (tablet/monitor/laptop/teléfono) sobre fondo de marca. **Generados** con `node build-renders.js` — no editar a mano; editar la pantalla en `producto/` y regenerar. |
| `renders-deck.html` | **Deck navegable de renders** — los 6 renders en un solo archivo con flechas, teclado, contador y pantalla completa (mismo shell que `index.html`). **Generado** con `node build-renders-deck.js`. Cadena de fuentes: `producto/` → `build-renders.js` → `renders/` → `build-renders-deck.js` → este archivo. |
| `demo.html` | **Demo clicable guiada** — flujo POS → KDS → Dirección → Centinela → Menu engineering → Copiloto con hotspots verdes, barra de guía por paso e intro. **Generado** con `node build-demo.js` a partir de `producto/`. |
| `producto/p7-reporte-mensual.html` | **Reporte de Rentabilidad Mensual con IA** (Idea 6 del README maestro): documento A4 mock + entrega por WhatsApp; sustenta el cobro por resultado. No entra en renders ni demo. |
| `one-pager.html` | **One-pager comercial imprimible** (1240×1600, hoja carta): propuesta de valor, 9 módulos, 5 capacidades, modelo y CTA. Con `@media print` — abrir en navegador y Ctrl+P para PDF. |

Los datos de las pantallas son **de demostración** (universo Rodizio: mitad-y-mitad, masa, viernes pico) y cada pantalla lo indica con un chip "Datos de demostración". El shell de app (sidebar M1–M9 + header con rol y sucursal) se repite en P1/P3/P4/P5 como semilla del design system del producto.

## Marca aplicada

> ⚠️ **Decisión de Gonzalo (2026-07-03): el acento dominante de este proyecto es NARANJA `#F2853A`, no el verde del README maestro §12.** Las variables CSS conservan el nombre `--verde` pero contienen el naranja (cambio hecho por swap de valores; marcador `<!-- rebrand-naranja -->` en cada archivo).

- Acento dominante: **naranja `#F2853A`** · tinte claro `#FDEBD7` · texto acento oscuro `#B4591A`.
- Semántica de severidad en pantallas de producto: advertencia = **ámbar `#E6B23A`** (tinte `#FBF0D9`), crítico = rojo `#E0392B`.
- Fondos oscuros `#14181A` en láminas 1, 8 y 14; el degradado de energía naranja→rojo se conserva.
- Tipografía: Space Grotesk (títulos) + Inter (cuerpo), con respaldo `Segoe UI, Arial`.
- Sin precios ni cifras comerciales de MotRest; los precios de platillos en los mockups llevan la nota "*Precios estimados, sujetos a la realidad de cada restaurante" (P1 y caption del render R1).

## Cómo subirlo a Claude Design

1. En una terminal interactiva de Claude Code, ejecutar `/design-login` para autorizar el acceso a claude.ai/design.
2. Pedir a Claude que sincronice este bundle: crea el proyecto (p. ej. «MotRest — Presentación Comercial»), sube `slides/*.html` y registra cada lámina como tarjeta de 1920×1080 en el grupo «Presentación».
3. Editar las láminas directamente en Claude Design; los textos y estilos están en HTML/CSS simple.

## Vista previa local

Abrir `index.html` en el navegador para el deck completo, o cualquier archivo de `slides/` para una lámina suelta. El lienzo lógico es 1920×1080 px y se escala automáticamente al tamaño de la ventana o tarjeta (script `id="fit"` en cada lámina).

## Regenerar el deck tras editar una lámina

```
node build-deck.js
```

Lee `slides/NN-*.html`, aísla los estilos de cada lámina con prefijos por sección y produce `index.html`. Luego re-sincronizar con Claude Design (DesignSync: finalize_plan → write_files).
