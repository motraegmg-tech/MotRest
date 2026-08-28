/**
 * El Hub pide mandar un WhatsApp. Aquí se llama a Meta con el token de SU local.
 *
 * Sustituye al mensaje `{tipo:"enviar"}` del relay (apps/relay/src/main.ts:610).
 *
 * POR QUÉ NO LLAMA EL HUB DIRECTAMENTE A META
 *
 * Podría: el Hub tiene el token, él mismo lo publicó. Pero entonces cada
 * restaurante sería un sitio más desde el que se puede mandar en nombre del
 * número, y el token quedaría también en la caja. Manteniendo la llamada aquí,
 * el token vive cifrado en un solo lugar y el local solo tiene permiso para
 * *pedir* que se mande.
 *
 * LAS REGLAS DE A QUIÉN Y CUÁNDO NO SE COMPRUEBAN AQUÍ. Ya las comprobó el Hub
 * con el dominio (`clientes/mensajeria.ts`): la ventana de 24 horas, la baja del
 * comensal, el horario. Duplicar esa regla en dos sitios es garantizar que un
 * día discrepen, y la que manda es la del Hub porque es la que tiene el
 * historial.
 *
 * Configuración:
 *   MOTREST_LLAVE_PADRON   32 bytes en base64: abre el token de cada local
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cuerpoDeEnvio, type PeticionEnvio } from "../_compartido/whatsapp.ts";
import { descifrar, llaveDelPadron } from "../_compartido/sobre.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

Deno.serve(async (peticion: Request): Promise<Response> => {
  const autorizacion = peticion.headers.get("authorization") ?? "";
  if (!autorizacion.toLowerCase().startsWith("bearer ")) {
    return Response.json({ error: "Hace falta el JWT del local" }, { status: 401 });
  }

  /*
   * EL CLIENTE HEREDA EL JWT DEL HUB, y esa es la decisión importante.
   *
   * No se usa la llave de servicio: al leer con la identidad del propio local,
   * las políticas RLS deciden qué fila puede ver, y la respuesta a "¿de quién es
   * este token?" la da la base de datos y no un `sucursal_id` que venga en el
   * cuerpo. Un local no puede mandar en nombre de otro ni pidiéndolo.
   */
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    {
      global: { headers: { authorization: autorizacion } },
      auth: { persistSession: false },
    },
  );

  let cuerpo: PeticionEnvio;
  try {
    cuerpo = await peticion.json();
  } catch {
    return Response.json({ error: "Cuerpo ilegible" }, { status: 400 });
  }

  if (!cuerpo?.contacto || (!cuerpo.texto && !cuerpo.plantilla)) {
    return Response.json({ error: "Falta el contacto, o el texto/plantilla" }, { status: 400 });
  }

  // RLS se encarga de que esto sea la fila del local que llama, y ninguna otra.
  const { data: suya, error } = await supabase
    .from("sucursales")
    .select("sucursal_id, wa_phone_number_id, wa_token_cifrado")
    .maybeSingle();

  if (error || !suya) {
    return Response.json({ error: "Este local no está en el padrón" }, { status: 403 });
  }
  if (!suya.wa_phone_number_id || !suya.wa_token_cifrado) {
    return Response.json({ error: "sin credenciales" }, { status: 409 });
  }

  let token: string;
  try {
    token = await descifrar(suya.wa_token_cifrado, await llaveDelPadron(Deno.env.get("MOTREST_LLAVE_PADRON")));
  } catch (causa) {
    // Casi siempre es que la llave del entorno no es la misma con la que se
    // cifró. Se dice en el registro y no al local: a él no le sirve de nada.
    console.error(`No se pudo abrir el token de ${suya.sucursal_id}: ${String(causa)}`);
    return Response.json({ error: "sin credenciales" }, { status: 409 });
  }

  const respuesta = await fetch(`${GRAPH}/${suya.wa_phone_number_id}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(cuerpoDeEnvio(cuerpo)),
  });

  if (!respuesta.ok) {
    /*
     * El detalle de Meta se registra porque sus errores son crípticos y sin el
     * cuerpo no hay forma de saber si fue la plantilla, el token o la hora. Al
     * local se le contesta que falló y nada más: el mensaje de Meta puede traer
     * partes del token.
     */
    console.warn(`Meta rechazó un envío de ${suya.sucursal_id}: ${await respuesta.text()}`);
    return Response.json({ ok: false }, { status: 502 });
  }

  return Response.json({ ok: true });
});
