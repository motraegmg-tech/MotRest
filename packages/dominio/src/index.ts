/**
 * @motrest/dominio — Núcleo de dominio de MotRest.
 *
 * Isomórfico: se importa igual desde el Hub (Node) y desde los clientes web.
 * Todo el dinero va en centavos enteros (ADR-12) y los eventos se sellan con el
 * reloj del propio dispositivo (ADR-17).
 */

// Comunes
export * from "./comun/dinero.js";
export * from "./comun/ids.js";
export * from "./comun/impuestos.js";

// Event log
export * from "./evento.js";

// Catálogo
export * from "./catalogo/productos.js";
export * from "./catalogo/porciones.js";
export * from "./catalogo/recetas.js";

// Comanda
export * from "./comanda/renglon.js";
export * from "./comanda/eventos.js";
export * from "./comanda/reducers.js";
export * from "./comanda/totales.js";

// Costeo
export * from "./costeo/costeo.js";

// Identidad, roles y permisos
export * from "./identidad/acciones.js";
export * from "./identidad/roles.js";
export * from "./identidad/matriz.js";
export * from "./identidad/credenciales.js";
export * from "./identidad/eventos.js";
export * from "./identidad/reducers.js";
