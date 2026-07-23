# ADR-19 — Durabilidad del Hub: qué significa un acuse

**Estado:** aceptado · **Fecha:** 2026-07-23 · **Etapa:** 12 (cierre)

## Contexto

El requisito no es teórico. Un restaurante se queda sin luz, y la instrucción
fue explícita: la tablet conserva sus comandas y, al volver la corriente, todos
los equipos se ponen al corriente.

El sistema lo resuelve con acuses. La terminal manda un evento, el Hub responde
`acks`, y la terminal lo da por guardado y **deja de reintentarlo**. Ese acuse
es el único punto donde la responsabilidad del dato cambia de manos.

El Hub abría su base con `PRAGMA synchronous = NORMAL`, con esta justificación:
*"NORMAL basta con WAL y evita un fsync por cada comanda capturada"*.

La primera mitad es cierta y la segunda es el problema. Con WAL, `NORMAL`
protege contra **corrupción**, no contra **pérdida**: SQLite documenta que una
transacción confirmada bajo `NORMAL` puede deshacerse tras un corte de energía.
La base queda íntegra, pero sin las últimas escrituras.

Combinado con el acuse, eso produce el peor resultado posible: el Hub promete
que guardó, la terminal le cree y descarta su copia pendiente, y el apagón borra
la comanda. **Nadie la vuelve a mandar**, porque nadie sabe que falta. No es una
venta que se cae con estrépito; es una venta que desaparece en silencio y
aparece como faltante en el corte de caja.

## Decisión

`PRAGMA synchronous = FULL` en el log del Hub.

El acuse solo sale después de que el commit tocó el disco. Un acuse que no
significa "está guardado" no sirve para nada.

## Sobre el costo que se quería evitar

Un fsync por lote de eventos. La optimización descartada suponía un volumen que
este sistema no tiene: un restaurante lleno genera unos pocos eventos por
segundo, y cada uno de esos eventos es una venta.

Cambiar ventas perdidas por microsegundos es un mal negocio en cualquier
restaurante, y es un pésimo negocio en un producto que se cobra **por ahorro
verificado**.

## Lo que esto NO resuelve

- **El disco que miente.** Algunos discos confirman el fsync antes de escribir
  de verdad. Contra eso no hay pragma que valga; hay respaldo.
- **La tablet.** Su almacenamiento local tiene sus propias reglas. Lo que la
  protege es otra cosa: mientras no reciba acuse, no descarta nada.
- **El respaldo.** Durabilidad no es respaldo. Un disco que muere se lleva la
  base íntegra y confirmada. Pendiente para F2.

## Alternativas descartadas

**Dejar `NORMAL` y que la terminal reintente por tiempo.** Sigue sin saber qué
falta: el Hub ya dijo que lo tenía. Reintentar a ciegas duplicaría eventos —los
salva la deduplicación por UUID—, pero requiere que la terminal conserve todo
indefinidamente, que es exactamente lo que el acuse existía para evitar.

**`synchronous = OFF`.** Más rápido y sin ninguna garantía, ni siquiera contra
corrupción. Fuera de discusión para el registro de ventas de un negocio.
