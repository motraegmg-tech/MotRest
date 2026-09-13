/**
 * La versión de MotRest que corre en esta terminal.
 *
 * VIENE DEL EMPAQUETADO, no de una consulta al Hub. Se inyecta al compilar
 * desde `apps/hub/package.json` —la misma fuente que el Hub reporta en `/salud`
 * y que valida `empaquetar.mjs`— porque el POS y el Hub viajan juntos en el
 * mismo instalador: preguntarla por red dejaría sin número a cada tablet del
 * salón que abra el menú con el wifi caído, que es justo cuando alguien llama a
 * soporte y hay que preguntarle "¿qué versión tienes?".
 *
 * En `pnpm dev` el valor existe igual: `vite.config.ts` lo define siempre.
 */
declare const __MOTREST_VERSION__: string;

export const VERSION_MOTREST: string =
  typeof __MOTREST_VERSION__ === "string" && __MOTREST_VERSION__ ? __MOTREST_VERSION__ : "";
