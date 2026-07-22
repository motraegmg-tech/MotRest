/**
 * @motrest/hub — el servicio de fondo del local.
 *
 * `servidor.ts` tiene la lógica del protocolo, sin red: es lo que se prueba.
 * `main.ts` es solo el arranque (HTTP + WebSocket + SQLite).
 */
export { Hub, type Conexion, type OpcionesHub } from "./servidor.js";
