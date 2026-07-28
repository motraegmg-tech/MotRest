# ADR-21 · Crecimiento del event log: medirlo ahora, archivarlo después

**Estado:** aceptado · **Fecha:** 2026-07-27

## Contexto

El registro del local es un event log append-only (ADR-02): nada se borra y el
estado se reconstruye reproduciéndolo. Eso es lo que hace confiable la bitácora
y lo que permite que un respaldo sirva de verdad.

También significa que **crece para siempre**, y que cada terminal lo carga
entero al arrancar (`leerTodos()` en `arranque.iniciar()`). No hay instantáneas
ni compactación.

## Los números, medidos

Una pizzería con ~60 cuentas al día genera unos **24 eventos por cuenta**
—abrir, capturar, mandar a cocina, tres cambios de estado por platillo, el pago,
el cierre y los movimientos de inventario—:

| Horizonte | Eventos | Tamaño |
|---|---:|---:|
| Un día | ~1 400 | ~1 MB |
| Seis meses | ~250 000 | ~160 MB |
| **Un año** | **~525 000** | **~336 MB** |

Costo de reproducir 200 000 eventos, medido en este equipo:

| Operación | Tiempo |
|---|---:|
| Ordenar | 5 ms |
| Parsear al leer de disco | 442 ms |
| Ocho filtros por familia | 52 ms |

La CPU no es el problema —cerca de un segundo al arrancar, con un año de
historia—. El problema es la **memoria**: cientos de MB de objetos vivos en una
tablet barata de cocina, donde el navegador tiene mucho menos margen que la caja.

## Decisión

**Medir y avisar ahora; archivar cuando toque, no antes.**

- El Hub calcula el tamaño del registro al arrancar y lo reporta en `/salud`.
- Avisa a partir de **400 000 eventos** (cerca de un año) y marca crítico en
  **800 000**. El aviso llega con meses de margen: uno que aparece el día en que
  la caja ya tarda en abrir no sirve de nada.
- **No** se compacta ni se archiva todavía.

## Por qué no archivar ya

1. **Riesgo asimétrico.** Archivar mal es perder historia fiscal que el SAT
   exige conservar cinco años. Esperar de más solo cuesta un arranque lento, y
   avisado.
2. **A un local que arranca le sobran meses.** Rodizio empieza en cero: el
   umbral de aviso está a un año de operación.
3. **La forma correcta depende de datos que aún no existen.** Si conviene cortar
   por ejercicio fiscal, por corte de caja o por antigüedad se decide mejor
   viendo un año real de operación que suponiéndolo hoy.

## Cuándo se implementa, y cómo

Cuando el aviso aparezca, o antes si un local resulta más movido de lo previsto.
La forma prevista:

- **Instantánea + cola.** Guardar el estado proyectado a una fecha de corte y
  conservar solo los eventos posteriores en el log activo.
- **Los archivados no se borran**: pasan a `respaldos/archivo-AAAA.sqlite`, que
  sigue siendo consultable y respaldable. La historia fiscal se conserva íntegra;
  lo que cambia es qué se carga al arrancar.
- El corte natural es el **cierre de ejercicio fiscal**, que es cuando un
  restaurante ya cerró sus libros.

## Consecuencias

- Se conoce el límite y está instrumentado, en vez de descubrirse en producción.
- Se asume un arranque cada vez más lento durante el primer año, dentro de lo
  tolerable y con aviso antes de que deje de serlo.
- Queda una deuda técnica **explícita y con fecha de revisión**, no un olvido.
