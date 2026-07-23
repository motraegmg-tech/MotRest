/**
 * @motrest/protocolo-sync — persistencia del event log y sincronización con el Hub.
 *
 * El contrato de repositorio ya contemplaba el outbox (`pendientes` /
 * `confirmar`) desde la etapa 4, así que la etapa 10 pudo añadir el Hub sin
 * reescribir el almacenamiento (ADR-15).
 *
 * Aquí solo se exporta lo ISOMORFO: lo que corre igual en el navegador, en
 * Tauri y en Node. El almacén SQLite vive en `./sqlite.js` y se importa por
 * separado, porque depende de `node:sqlite` y el navegador no lo tiene —
 * exportarlo desde aquí rompería el empaquetado del POS.
 */
export * from "./repositorio.js";
export * from "./memoria.js";
export * from "./indexeddb.js";
export * from "./protocolo.js";
export * from "./cifrado.js";
export * from "./cliente.js";
