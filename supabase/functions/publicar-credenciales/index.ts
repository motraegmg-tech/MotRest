/**
 * El Hub publica el número de WhatsApp de SU restaurante.
 *
 * Sustituye al mensaje `{tipo:"credenciales"}` del relay
 * (apps/relay/src/main.ts:553-569).
 *
 * POR QUÉ ESTO NO ES UN `UPDATE` DIRECTO A LA TABLA
 *
 * Porque **el token se guarda cifrado con una llave que el Hub no tiene**, igual
 * que el relay cifraba su padrón en el volumen. Si el local escribiera la fila
 * él mismo, el token de la API de Meta quedaría en claro en la base de datos, y
 * cualquier volcado —un respaldo, un disco devuelto al proveedor— sería la
 * capacidad de mandar WhatsApp en nombre de cincuenta restaurantes.
 *
 * Aquí dentro está la llave; en la tabla queda un sobre que Supabase no puede
 * abrir. Es lo que conserva la objeción de ADR-27 después de la mudanza.
 *
 * Configuración:
 *   MOTREST_LLAVE_PADRON   32 bytes en base64: con ella se cierra el sobre
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cifrar, llaveDelPadron } from "../_compartido/sobre.ts";

interface Credenciales {
  phone_number_id?: string;
  token?: string;
  nombre?: string;
}

Deno.serve(async (peticion: Request): Promise<Response> => {
  const autorizacion = peticion.headers.get("authorization") ?? "";
  if (!autorizacion.toLowerCase().startsWith("bearer ")) {
    return Response.json({ error: "Hace falta el JWT del local" }, { status: 401 });
  }

  // Con la identidad del Hub: de aquí sale quién es, y no del cuerpo.
  const comoElLocal = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { authorization: autorizacion } }, auth: { persistSession: false } },
  );

  const { data: suya } = await comoElLocal.from("sucursales").select("sucursal_id").maybeSingle();
  if (!suya) {
    return Response.json({ error: "Este local no está en el padrón" }, { status: 403 });
  }

  let cuerpo: Credenciales;
  try {
    cuerpo = await peticion.json();
  } catch {
    return Response.json({ error: "Cuerpo ilegible" }, { status: 400 });
  }

  const phone = cuerpo.phone_number_id?.trim();
  const token = cuerpo.token?.trim();
  if (!phone || !token) return Response.json({ error: "Faltan datos" }, { status: 400 });

  const sobre = await cifrar(token, await llaveDelPadron(Deno.env.get("MOTREST_LLAVE_PADRON")));

  /*
   * La escritura sí va con la llave de servicio, porque el Hub no tiene —ni debe
   * tener— permiso de UPDATE sobre su propia ficha: si lo tuviera, podría
   * escribir el token en claro y saltarse todo lo anterior.
   */
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { error } = await admin
    .from("sucursales")
    .update({
      wa_phone_number_id: phone,
      wa_token_cifrado: sobre,
      wa_nombre: cuerpo.nombre?.slice(0, 120) ?? null,
    })
    .eq("sucursal_id", suya.sucursal_id);

  if (error) {
    /*
     * RECLAMAR EL NÚMERO DE OTRO LOCAL es quedarse con sus mensajes entrantes.
     * Lo impide el índice único de `wa_phone_number_id`, así que aquí solo hay
     * que traducir el choque a algo que se entienda — y dejar constancia, porque
     * esto no pasa por error.
     */
    if (error.code === "23505") {
      console.warn(`${suya.sucursal_id} intentó reclamar el número ${phone}, que es de otro local.`);
      return Response.json({ error: "número de otro local" }, { status: 409 });
    }
    console.error(`No se pudieron guardar las credenciales de ${suya.sucursal_id}: ${error.message}`);
    return Response.json({ error: "no se pudo guardar" }, { status: 500 });
  }

  console.log(`Credenciales de WhatsApp actualizadas: ${suya.sucursal_id}`);
  return Response.json({ ok: true });
});
