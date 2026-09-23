/**
 * CORS para las funciones que llama un NAVEGADOR (la web de MotRest, 1.6.0).
 *
 * Las demás funciones las llama el Hub desde Node y no necesitan esto. Estas sí:
 * la página vive en Vercel y la función en Supabase, que son orígenes distintos.
 *
 * `MOTREST_WEB_ORIGENES` es la lista de direcciones de la web separadas por
 * comas (`https://motrest.vercel.app,https://app.motrest.mx`). Sin configurar,
 * se responde al origen que pregunte: sirve para la vista previa y no abre nada
 * que la contraseña no cierre ya, pero en producción conviene fijarla.
 */
export function cabecerasCors(peticion: Request): Record<string, string> {
  const origen = peticion.headers.get("origin") ?? "";
  const permitidos = (Deno.env.get("MOTREST_WEB_ORIGENES") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const aceptado = permitidos.length === 0 ? origen || "*" : permitidos.includes(origen) ? origen : permitidos[0];

  return {
    "access-control-allow-origin": aceptado,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

export function responder(peticion: Request, cuerpo: unknown, estado = 200): Response {
  return Response.json(cuerpo, { status: estado, headers: cabecerasCors(peticion) });
}

/** La red de quien llama, para el freno de intentos. */
export function ipDe(peticion: Request): string {
  const reenviada = peticion.headers.get("x-forwarded-for") ?? "";
  return (reenviada.split(",")[0] ?? "").trim().slice(0, 64) || "desconocida";
}
