/**
 * @motrest/protocolo-sync — persistencia del event log y, más adelante,
 * sincronización con el Hub.
 *
 * Hoy solo existe el almacenamiento local, pero el contrato ya contempla el
 * outbox (`pendientes` / `confirmar`), de modo que añadir el Hub en la etapa 10
 * no obligue a reescribir nada (ADR-15).
 */
export * from "./repositorio.js";
export * from "./memoria.js";
export * from "./indexeddb.js";
