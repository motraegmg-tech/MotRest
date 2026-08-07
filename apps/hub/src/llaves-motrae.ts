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

export const LLAVE_PUBLICA_LICENCIAS =
  typeof __MOTREST_LICENCIA_PUBLICA__ === "string"
    ? __MOTREST_LICENCIA_PUBLICA__
    : (process.env.MOTREST_LICENCIA_PUBLICA ?? "").trim();

export const LLAVE_PUBLICA_ACTUALIZACIONES =
  typeof __MOTREST_ACTUALIZACIONES_PUBLICA__ === "string"
    ? __MOTREST_ACTUALIZACIONES_PUBLICA__
    : (process.env.MOTREST_ACTUALIZACIONES_PUBLICA ?? "").trim();
