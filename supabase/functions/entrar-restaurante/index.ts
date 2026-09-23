/**
 * «Entra a tu restaurante» (MotRest en la web, 1.6.0).
 *
 * El navegador manda la clave del restaurante y su contraseña; aquí se frena a
 * quien adivina, se inicia la sesión en Supabase Auth y se devuelve lo que la
 * web necesita para arrancar: el pase, la modalidad y la clave remota ENVUELTA,
 * que el navegador abre con la misma contraseña.
 *
 * POR QUÉ HAY UNA FUNCIÓN EN MEDIO y el navegador no llama a Auth directamente:
 *
 * 1. **La clave no es el usuario.** El usuario de Auth va por sucursal
 *    (`web-<sucursal>@web.motrae.mx`) para que corregir la clave en Central no
 *    lo cambie. Traducir clave → sucursal exige leer `accesos_web` sin estar
 *    dentro todavía, y eso solo puede hacerlo la llave de servicio.
 * 2. **El freno.** Auth tiene su propio límite, pero por red y genérico. Aquí se
 *    cuenta por clave (quien ataca a UN restaurante desde muchas redes) y por
 *    red (quien prueba muchas claves), igual que el portal de autofactura.
 * 3. **La misma respuesta para todo fallo.** «Esa clave no existe» le diría a
 *    quien prueba qué restaurantes usan MotRest. Clave inexistente, contraseña
 *    mala o acceso apagado contestan exactamente lo mismo y tardan lo mismo.
 *
 * `verify_jwt = false` porque quien llama todavía no tiene sesión: ese es el
 * punto. La función no confía en nada del cuerpo más allá de la clave y la
 * contraseña, y la contraseña la verifica Auth.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cabecerasCors, ipDe, responder } from "../_compartido/cors.ts";

const MAXIMO_POR_CLAVE = 10;
const MAXIMO_POR_RED = 30;
const HORA_MS = 60 * 60 * 1000;
const DEMORA_FALLO_MS = 600;

const INCORRECTA = "Clave o contraseña incorrecta";
const DEMASIADOS = "Demasiados intentos. Por seguridad, espera una hora antes de volver a probar.";

function normalizarClave(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  const limpia = texto.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9-]{3,20}$/.test(limpia) ? limpia : null;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (peticion: Request): Promise<Response> => {
  if (peticion.method === "OPTIONS") return new Response(null, { headers: cabecerasCors(peticion) });
  if (peticion.method !== "POST") return responder(peticion, { error: "Método no permitido" }, 405);

  let cuerpo: { clave?: unknown; contrasena?: unknown };
  try {
    cuerpo = await peticion.json();
  } catch {
    return responder(peticion, { error: "Cuerpo ilegible" }, 400);
  }

  const clave = normalizarClave(cuerpo.clave);
  const contrasena = typeof cuerpo.contrasena === "string" ? cuerpo.contrasena : "";
  // Un texto de un megabyte no llega ni al contador.
  if (!clave || contrasena.length === 0 || contrasena.length > 200) {
    await esperar(DEMORA_FALLO_MS);
    return responder(peticion, { error: INCORRECTA }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false },
  });
  const ip = ipDe(peticion);

  // --- ¿Está frenado? ---
  const hace = new Date(Date.now() - HORA_MS).toISOString();
  const { data: intentos } = await admin
    .from("intentos_entrada")
    .select("llave, fallos")
    .in("llave", [`clave:${clave}`, `ip:${ip}`])
    .gte("ultimo_ts", hace);
  for (const fila of intentos ?? []) {
    const tope = fila.llave.startsWith("clave:") ? MAXIMO_POR_CLAVE : MAXIMO_POR_RED;
    if (fila.fallos >= tope) return responder(peticion, { error: DEMASIADOS }, 429);
  }

  const fallar = async () => {
    await admin.rpc("registrar_fallo_entrada", { p_clave: clave, p_ip: ip });
    await esperar(DEMORA_FALLO_MS);
    return responder(peticion, { error: INCORRECTA }, 401);
  };

  // --- Clave → restaurante ---
  const { data: acceso } = await admin
    .from("accesos_web")
    .select("sucursal_id, modalidad, envoltura, version, activo")
    .eq("clave", clave)
    .maybeSingle();
  if (!acceso || !acceso.activo) return fallar();

  // --- La contraseña la verifica Auth ---
  const publica = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: entrada, error } = await publica.auth.signInWithPassword({
    email: `web-${acceso.sucursal_id}@web.motrae.mx`,
    password: contrasena,
  });
  if (error || !entrada.session) return fallar();

  // Quien acierta limpia el contador de SU restaurante (no el de su red).
  await admin.from("intentos_entrada").delete().eq("llave", `clave:${clave}`);

  const { data: ficha } = await admin
    .from("sucursales")
    .select("nombre")
    .eq("sucursal_id", acceso.sucursal_id)
    .maybeSingle();

  return responder(peticion, {
    sesion: {
      access_token: entrada.session.access_token,
      refresh_token: entrada.session.refresh_token,
      expires_at: entrada.session.expires_at,
    },
    clave,
    sucursal_id: acceso.sucursal_id,
    nombre: ficha?.nombre ?? clave,
    modalidad: acceso.modalidad,
    envoltura: acceso.envoltura,
    version: acceso.version,
  });
});
