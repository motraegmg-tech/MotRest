/**
 * De qué es capaz el navegador donde corre esta terminal.
 *
 * EL PROBLEMA QUE ESTO RESUELVE
 *
 * Los navegadores solo exponen `crypto.subtle` —el motor criptográfico— en
 * "contextos seguros": HTTPS, o `localhost`. Una terminal abierta como
 * `http://192.168.1.50:5173` NO lo tiene, y ahí se caen tres cosas a la vez:
 *
 *   - verificar contraseñas y PIN (PBKDF2),
 *   - cifrar el canal con el Hub (AES-GCM),
 *   - sellar el corte de caja (SHA-256).
 *
 * Sin esta comprobación el síntoma era "no me deja entrar", sin ninguna pista
 * de que la causa era la dirección desde la que se abrió la aplicación. Un
 * fallo que no se puede diagnosticar desde la pantalla es peor que un fallo
 * ruidoso.
 *
 * Se resuelve sirviendo el POS por HTTPS (`pnpm --filter pos-ui dev` ya lo
 * hace) o, definitivamente, con la aplicación instalada de la etapa 12: una app
 * nativa corre en un origen que siempre es seguro.
 */

/** ¿El navegador expone el motor criptográfico? */
export function contextoSeguro(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof crypto.subtle.importKey === "function"
  );
}

/** ¿Se está abriendo por la red, en claro? Es la causa habitual. */
export function abiertoEnClaroPorLaRed(): boolean {
  if (typeof location === "undefined") return false;
  return location.protocol === "http:" && !esOrigenLocal(location.hostname);
}

function esOrigenLocal(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** Mensaje que explica el problema y cómo salir de él. */
export function explicacionContextoInseguro(): string {
  const puerto = typeof location !== "undefined" ? location.port : "";
  const sufijo = puerto ? `:${puerto}` : "";
  const host = typeof location !== "undefined" ? location.hostname : "la-ip-del-equipo";

  return abiertoEnClaroPorLaRed()
    ? `Esta terminal se abrió por una dirección sin cifrar, y el navegador no permite verificar contraseñas ni cifrar la conexión así. Ábrela como https://${host}${sufijo} — la primera vez habrá que aceptar el aviso del certificado.`
    : "Este navegador no expone el motor criptográfico, así que no se pueden verificar contraseñas ni cifrar la conexión con el Hub.";
}
