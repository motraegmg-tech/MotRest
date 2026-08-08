/**
 * Llaves públicas de MOTRAE que viajan DENTRO del ejecutable del Hub.
 *
 * No son secretos: extraerlas de un restaurante no permite emitir licencias ni
 * publicar actualizaciones. Sí son parte de la identidad de MOTRAE, por eso el
 * empaquetador exige las dos al crear un instalador y las inserta con esbuild.
 *
 * El fallback existe solo para `tsx src/main.ts` durante desarrollo y pruebas.
 * Acepta únicamente llaves PÚBLICAS; un instalador nunca lee las privadas ni
 * `MOTREST_LICENCIA_LLAVE`/`MOTREST_ACTUALIZACIONES_LLAVE`, que desaparecieron
 * con la migración desde HMAC.
 */
declare const __MOTREST_LICENCIA_PUBLICA__: string;
declare const __MOTREST_ACTUALIZACIONES_PUBLICA__: string;
declare const __MOTREST_ACTUALIZACIONES_REPO__: string;

export const LLAVE_PUBLICA_LICENCIAS =
  typeof __MOTREST_LICENCIA_PUBLICA__ === "string"
    ? __MOTREST_LICENCIA_PUBLICA__
    : (process.env.MOTREST_LICENCIA_PUBLICA ?? "").trim();

export const LLAVE_PUBLICA_ACTUALIZACIONES =
  typeof __MOTREST_ACTUALIZACIONES_PUBLICA__ === "string"
    ? __MOTREST_ACTUALIZACIONES_PUBLICA__
    : (process.env.MOTREST_ACTUALIZACIONES_PUBLICA ?? "").trim();

/**
 * De qué repositorio se bajan las actualizaciones. **Viaja en el binario.**
 *
 * No es una llave, pero se incrusta por el mismo motivo que ellas: dependía de
 * una variable de entorno que nadie escribía —ni el instalador NSIS, ni Tauri al
 * lanzar el Hub—, así que cada local se instalaba con el canal apagado y no
 * llegaba nunca a preguntar si había versión nueva. Una configuración que hay
 * que acordarse de poner en cada instalación es una configuración que no está.
 *
 * Tampoco es un secreto: dice de dónde se baja, y lo que decide si un instalador
 * se ejecuta o no es la firma del manifiesto, no su procedencia.
 */
export const REPOSITORIO_ACTUALIZACIONES =
  typeof __MOTREST_ACTUALIZACIONES_REPO__ === "string"
    ? __MOTREST_ACTUALIZACIONES_REPO__
    : (process.env.MOTREST_ACTUALIZACIONES_REPO ?? "").trim();
