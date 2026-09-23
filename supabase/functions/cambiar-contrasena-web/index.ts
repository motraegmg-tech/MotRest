/**
 * El propietario cambia la contraseña web de su restaurante (1.6.0).
 *
 * Gonzalo lo decidió así: la contraseña la pueden cambiar Central y el
 * propietario, y Gonzalo tiene que poder verla siempre en Central. Central la
 * cambia por su cuenta con la llave de servicio; ESTA función es el camino del
 * restaurante, y la llaman dos:
 *
 * - **La web** (modalidad nube, o ambas desde fuera), con el pase del usuario
 *   web. Tiene que mandar también la contraseña ACTUAL: un pase robado —una
 *   tableta olvidada con la sesión abierta— no debe bastar para dejar fuera al
 *   dueño.
 * - **El Hub** (modalidad ambas, desde la caja), con su propio pase. En la caja
 *   el propietario ya se identificó con su PIN, y el Hub es de confianza.
 *
 * LO QUE LLEGA YA HECHO, y la nube no puede comprobar ni necesita:
 * - `envoltura`: la clave remota envuelta con la contraseña nueva. La hace quien
 *   tiene la clave remota (el navegador dentro, o el Hub).
 * - `sobre_para_central`: la contraseña nueva sellada con la pública del buzón
 *   de Central, que viaja firmada en la licencia. Supabase la guarda y no puede
 *   abrirla; Central la abre al refrescar y se la enseña a Gonzalo.
 *
 * Al terminar se cierran las sesiones web abiertas y sube la `version`: el Hub
 * la escucha y corta los túneles. Quien cambió la contraseña vuelve a entrar
 * con la nueva, que ya conoce.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cabecerasCors, responder } from "../_compartido/cors.ts";

const MINIMO = 10;

function esCofre(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return c.formato === "motrest-cofre-v1" && typeof c.sal === "string" && typeof c.iv === "string" &&
    typeof c.contenido === "string" && typeof c.iteraciones === "number";
}

function esSobre(v: unknown): boolean {
  return !!v && typeof v === "object" && (v as Record<string, unknown>).formato === "motrest-sobre-v1";
}

Deno.serve(async (peticion: Request): Promise<Response> => {
  if (peticion.method === "OPTIONS") return new Response(null, { headers: cabecerasCors(peticion) });
  if (peticion.method !== "POST") return responder(peticion, { error: "Método no permitido" }, 405);

  const autorizacion = peticion.headers.get("authorization") ?? "";
  if (!autorizacion.toLowerCase().startsWith("bearer ")) {
    return responder(peticion, { error: "Hace falta haber entrado" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const comoQuienLlama = createClient(url, anon, {
    global: { headers: { authorization: autorizacion } },
    auth: { persistSession: false },
  });
  const { data: quien } = await comoQuienLlama.auth.getUser();
  const meta = (quien.user?.app_metadata ?? {}) as Record<string, unknown>;
  const sucursalWeb = typeof meta.sucursal_web === "string" ? meta.sucursal_web : null;
  const sucursalHub = typeof meta.sucursal_id === "string" ? meta.sucursal_id : null;
  const sucursal = sucursalWeb ?? sucursalHub;
  if (!sucursal) return responder(peticion, { error: "No se reconoce este acceso" }, 403);

  let cuerpo: { contrasena?: unknown; contrasena_actual?: unknown; envoltura?: unknown; sobre_para_central?: unknown };
  try {
    cuerpo = await peticion.json();
  } catch {
    return responder(peticion, { error: "Cuerpo ilegible" }, 400);
  }

  const nueva = typeof cuerpo.contrasena === "string" ? cuerpo.contrasena : "";
  if (nueva.length < MINIMO || nueva.length > 200 || new Set(nueva).size < 4) {
    return responder(peticion, { error: `La contraseña necesita al menos ${MINIMO} caracteres variados` }, 400);
  }
  if (!esCofre(cuerpo.envoltura) || !esSobre(cuerpo.sobre_para_central)) {
    return responder(peticion, { error: "Faltan datos para guardar la contraseña" }, 400);
  }

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false },
  });
  const { data: acceso } = await admin
    .from("accesos_web")
    .select("usuario_id, version, activo")
    .eq("sucursal_id", sucursal)
    .maybeSingle();
  if (!acceso || !acceso.activo) {
    return responder(peticion, { error: "Este restaurante no tiene acceso por internet" }, 404);
  }

  // Desde la web, además del pase, la contraseña actual.
  if (sucursalWeb) {
    const actual = typeof cuerpo.contrasena_actual === "string" ? cuerpo.contrasena_actual : "";
    const prueba = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await prueba.auth.signInWithPassword({
      email: `web-${sucursal}@web.motrae.mx`,
      password: actual,
    });
    if (error) return responder(peticion, { error: "La contraseña actual no es correcta" }, 403);
  }

  const { error: errorAuth } = await admin.auth.admin.updateUserById(acceso.usuario_id, { password: nueva });
  if (errorAuth) {
    console.error(`No se pudo cambiar la contraseña web de ${sucursal}: ${errorAuth.message}`);
    return responder(peticion, { error: "No se pudo cambiar la contraseña" }, 500);
  }

  const version = acceso.version + 1;
  const { error: errorFila } = await admin
    .from("accesos_web")
    .update({
      envoltura: cuerpo.envoltura,
      version,
      contrasena_para_central: cuerpo.sobre_para_central,
      cambiada_por_restaurante_ts: new Date().toISOString(),
      actualizado_ts: new Date().toISOString(),
    })
    .eq("sucursal_id", sucursal);
  if (errorFila) {
    /*
     * La contraseña de Auth ya cambió y la envoltura no: nadie podría abrir la
     * clave remota con la nueva. Se deja constancia fuerte; Central lo arregla
     * generando otra contraseña, que reescribe las dos cosas a la vez.
     */
    console.error(`Contraseña web de ${sucursal} cambiada SIN envoltura nueva: ${errorFila.message}`);
    return responder(peticion, { error: "La contraseña cambió a medias. Pide a MOTRAE que genere otra." }, 500);
  }

  await admin.rpc("cerrar_sesiones_web", { p_usuario: acceso.usuario_id });
  console.log(`Contraseña web de ${sucursal} cambiada desde el restaurante (versión ${version}).`);
  return responder(peticion, { ok: true, version });
});
