# Relevo — el dinero del restaurante y el corte que no llegaba

Rama `feature/finanzas-tesoreria`. Cinco commits, del `4d82d0d` al `730f131`.

Dos trabajos que acabaron siendo el mismo: las mejoras de finanzas que pidió Gonzalo, y
el defecto que descubrieron al construirlas.

---

## 1. Lo que se construyó

| Qué | Dónde |
| --- | --- |
| Tesorería: dos saldos (efectivo y banco), derivados | `packages/dominio/src/finanzas/tesoreria.ts`, `flujo.ts` |
| El gasto en efectivo baja el corte | `packages/dominio/src/caja/reducers.ts` |
| Estado financiero del mes en PDF, sin dependencias | `packages/impresion/src/pdf.ts`, `estado-financiero-pdf.ts` |
| Compra de insumos dentro del gasto; pago o crédito | `apps/pos-ui/src/lib/egresos.svelte.ts` |
| Cuentas por pagar, presupuesto por categoría | `packages/dominio/src/finanzas/presupuesto.ts` |
| Arqueo por denominaciones, faltantes por cajero | `packages/dominio/src/caja/arqueos.ts` |
| Pantalla **Caja y dinero** (Finanzas, entre Facturación y Canales) | `apps/pos-ui/src/lib/modulos/finanzas/Dinero.svelte` |
| Corregir la forma de cobro de un ticket | evento `pago_corregido` |
| Categorías de insumo y edición de las del menú | `packages/dominio/src/catalogo/menu.ts` |

Las decisiones de producto que **no** se deducen del código están en la memoria del
proyecto: `tesoreria-el-dinero-del-restaurante`.

---

## 2. El defecto: por qué Rodizio no tenía un solo corte de caja

**Dos aperturas y cero cierres** en su base, durante meses. La hipótesis de que nadie se
acuerda de cerrar a las dos de la mañana **era falsa**: el cajero cerraba y la pantalla
decía que había cerrado.

`abrir()` fijaba el actor —`actuarComo(cajeroId)`— justo antes de emitir. **`cerrar()` no
lo hacía**: confiaba en que lo hubiera dejado puesto la apertura. Dentro de la misma
sesión del navegador funcionaba. Pero entre abrir a las once de la mañana y cerrar a las
dos de la madrugada **el POS se recarga**, el store se rehidrata desde los eventos y el
contexto de la fábrica vuelve a su valor inicial: `sistema`.

`sistema` no está en el padrón, así que el Hub rechazaba el `caja_cerrada` por permisos.

> Eso explica el detalle que no encajaba en el diagnóstico de septiembre: **por qué las
> aperturas sí llegaban y los cierres no.** Las aperturas son las únicas que firman justo
> antes de emitir.

**Y por qué duró meses invisible:** un evento rechazado nunca se confirma, así que seguía
en el outbox. Cada reconexión lo reenviaba, lo rechazaban otra vez, la terminal caía a
isla. Bucle cada pocos minutos. La única forma de enterarse era leer la bitácora del Hub
por SSH.

### Lo que se cambió

1. **Guarda estricta** (`sinActor`) en caja, egresos y tesorería. Ningún evento de dinero
   sale sin firma — y **no vale el actor que quedó en la fábrica**: un id viejo, el de
   quien abrió hace catorce horas, también es un error. La primera versión del arreglo sí
   caía de vuelta a él; las pruebas lo tumbaron.
2. **Tercer estado `RECHAZADO`** en el outbox. Un rechazo por permisos es determinista:
   no se reintenta. `reabrirOutbox` **no** lo resucita y el enlace deja de caer a isla por
   él. El evento no se borra: sigue en el log local.
3. **Se enseña.** El corte de caja avisa en rojo cuando el Hub no aceptó algo, con el
   motivo que dio el Hub y qué hacer.

---

## 3. Qué va a pasar en Rodizio al actualizar

**Decisión de Gonzalo (9-sep-2026): no se repara la base. El histórico arranca limpio
desde el primer corte bueno.**

Lo que van a ver, en orden:

1. **La primera vez que el POS conecte con el Hub**, los cierres viejos que llevaban meses
   atascados se envían una última vez, el Hub los rechaza, y el sistema los aparta. Sale
   **una vez** el aviso rojo en Finanzas → Corte de caja, con el texto del Hub.
2. **Se acabó el bucle.** No se vuelven a enviar, la terminal deja de caer a isla cada
   pocos minutos, y el aviso no reaparece en los siguientes arranques. El apartado vive en
   la base, no en memoria — probado en `repositorio.test.ts`.
3. **La caja se abre y se cierra con normalidad.** A partir del primer cierre, el corte sí
   llega al Hub, firmado por quien lo hizo.

### El residuo, y por qué es aceptable

En el Hub queda un `caja_abierta` de hace meses sin su cierre. **Deja de estorbar en
cuanto abran un turno nuevo**: `sesionAbierta` devuelve siempre el turno abierto más
reciente, así que el viejo deja de ser «el turno activo» para todas las terminales y para
el aviso de turno olvidado.

Su única huella es en un corte por fechas de aquellos días de agosto, que nadie va a
consultar. Eso es exactamente lo que significa «historial limpio desde el primer corte
bueno».

**No hay nada que hacer en sitio.** Si alguien pregunta por el aviso rojo: es el sistema
avisando de un problema viejo que ya está arreglado, y solo sale una vez.

---

## 4. Antes de publicar

- [ ] Fusionar la rama. Está en `feature/finanzas-tesoreria`, sin mergear.
- [ ] Subir versión en `motrest.json` (va en 1.4.1) y escribir las notas.
- [ ] Empaquetar y firmar — ver `PUBLICAR-UNA-ACTUALIZACION.md`.
- [ ] **Avisar de la doble resta.** Es lo único que cambia una costumbre del personal: ya
      no hay que registrar un *retiro* de caja al pagar un gasto de contado. El gasto solo
      baja el cajón. Hacer las dos cosas resta el dinero dos veces. Hay un aviso puesto en
      el panel de retiros, pero si llevan meses con esa costumbre conviene decírselo.
- [ ] **Declarar el saldo inicial.** En Finanzas → Caja y dinero, «Ajustar con
      justificación» → «Saldo con el que empezamos». Sin eso, el saldo cuenta solo desde la
      instalación, que es cierto pero no es lo que hay en la caja fuerte.

## 5. Verificar sobre la app instalada, no en desarrollo

Lo de siempre (memoria `verificacion-sobre-app-instalada`). Lo que hay que comprobar en la
caja de verdad:

1. Abrir caja, **recargar el POS**, y cerrar. El cierre tiene que aparecer en el Hub:
   `SELECT tipo, COUNT(*) FROM eventos WHERE tipo LIKE 'caja_%' GROUP BY tipo`.
   Es el escenario exacto del defecto — sin la recarga no se reproduce.
2. Registrar un gasto en efectivo y ver que el corte lo descuenta.
3. Descargar el estado financiero en PDF y abrirlo. La descarga es lo que fallaba en
   silencio dentro del WebView.

Ver `leer-la-base-del-hub-en-sitio` y `acceso-ssh-a-rodizio` en la memoria del proyecto.
