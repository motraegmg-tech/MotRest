/**
 * @motrest/impresion — ESC/POS, plantillas versionadas y cola de impresión.
 *
 * Lo de aquí es ISOMORFO: genera los bytes y administra la cola igual en el
 * navegador, en Tauri y en el Hub. El transporte real —abrir un socket al
 * puerto 9100, hablar por USB— vive fuera, porque depende de la plataforma.
 */
export * from "./escpos.js";
export * from "./plantillas.js";
export * from "./sello.js";
export * from "./cola.js";
