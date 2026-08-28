/**
 * La puerta de la calle: lo que Meta entrega cuando un comensal escribe.
 *
 * Sustituye a `/webhook/whatsapp` del relay (apps/relay/src/main.ts:261-316).
 * Es la ÚNICA función de las tres que se publica sin autenticar, porque Meta no
 * tiene cómo llevar un JWT nuestro. Lo que la protege es la firma HMAC.
 *
 * QUÉ CAMBIA RESPECTO DEL RELAY, Y ES UNA MEJORA
 *
 * El relay evitaba procesar dos veces un reintento de Meta con `YaVistos`, un
 * Map **en memoria**: cada despliegue lo vaciaba y los reintentos de ese rato
 * entraban duplicados. Aquí lo hace un índice único sobre `externo_id`, que
 * sobrevive a todo. El duplicado no es un caso raro — Meta reintenta siempre
 * que no reciba un 200 a tiempo.
 *
 * Y el mensaje ya no se pierde si el local está apagado: queda en la tabla y su
 * Hub lo recoge al encender, dentro de la ventana de 24 horas de Meta.
 *
 * Configuración (ninguna en el repositorio):
 *   MOTREST_META_APP_SECRET     firma de los webhooks — sin esto no arranca
 *   MOTREST_META_VERIFY_TOKEN   el que se teclea en el panel de Meta
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { firmaValida, leerWebhook } from "../_compartido/whatsapp.ts";

const APP_SECRET = Deno.env.get("MOTREST_META_APP_SECRET") ?? "";
const VERIFY_TOKEN = Deno.env.get("MOTREST_META_VERIFY_TOKEN") ?? "";

/*
 * Sin secretos no se atiende nada.
 *
 * Es a propósito, y es la misma decisión que tomaba el relay al arrancar: un
 * webhook sin `APP_SECRET` aceptaría cualquier cosa que le llegue, y eso es peor
 * que no tener webhook. Aquí no hay proceso que abortar, así que se falla en
 * cada petición — ruidosamente, y sin llegar a tocar la base de datos.
 */
function configurado(): boolean {
  return Boolean(APP_SECRET && VERIFY_TOKEN);
}

/**
 * Se usa la llave de servicio porque esta función escribe en nombre de nadie:
 * no hay un Hub autenticado del otro lado, hay Meta. Es la única de las tres que
 * la necesita, y por eso hace lo mínimo y no acepta nada que no venga firmado.
 */
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

Deno.serve(async (peticion: Request): Promise<Response> => {
  const url = new URL(peticion.url);

  if (!configurado()) {
    console.error("Faltan MOTREST_META_APP_SECRET y/o MOTREST_META_VERIFY_TOKEN.");
    return new Response(null, { status: 503 });
  }

  /*
   * Meta comprueba el webhook con un GET antes de mandar nada. Si el token no
   * coincide se responde 403 y no 404: confirmarle a quien prueba que la URL
   * existe es regalarle la mitad del trabajo.
   */
  if (peticion.method === "GET") {
    const modo = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const reto = url.searchParams.get("hub.challenge");

    if (modo === "subscribe" && token === VERIFY_TOKEN && reto) {
      console.log("Meta verificó el webhook.");
      return new Response(reto, { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response(null, { status: 403 });
  }

  if (peticion.method !== "POST") return new Response(null, { status: 405 });

  const crudo = await peticion.text();

  // LA PUERTA. Se comprueba sobre el cuerpo CRUDO: volver a serializar el JSON
  // cambia los bytes y la firma deja de cuadrar.
  if (!(await firmaValida(crudo, peticion.headers.get("x-hub-signature-256"), APP_SECRET))) {
    console.warn("Webhook con firma inválida: descartado");
    return new Response(null, { status: 401 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    // Firmado pero ilegible: se acepta para que Meta no reintente en bucle algo
    // que nunca va a poder procesarse.
    return new Response(null, { status: 200 });
  }

  /*
   * A qué restaurante le toca cada número.
   *
   * Se lee en cada webhook y no se cachea a propósito: un local puede conectar
   * su WhatsApp en cualquier momento, y una caché aquí significaría que sus
   * primeros mensajes se van al vacío sin que nadie sepa por qué.
   */
  const { data: sucursales, error } = await supabase
    .from("sucursales")
    .select("sucursal_id, wa_phone_number_id")
    .not("wa_phone_number_id", "is", null)
    .is("baja_ts", null);

  if (error) {
    // 500 para que Meta REINTENTE: la base de datos caída es justo el caso en
    // que perder el mensaje sería una lástima evitable.
    console.error(`No se pudo leer el padrón: ${error.message}`);
    return new Response(null, { status: 500 });
  }

  const porNumero = new Map(
    (sucursales ?? []).map((s) => [String(s.wa_phone_number_id), { sucursal_id: s.sucursal_id }]),
  );

  const mensajes = leerWebhook(cuerpo, porNumero);
  if (mensajes.length > 0) {
    /*
     * `ignoreDuplicates` sobre el índice único de `externo_id` es lo que
     * sustituye a `YaVistos`. Un reintento de Meta vuelve a insertar lo mismo y
     * Postgres lo descarta en silencio, que es exactamente lo que se quiere: sin
     * error, sin duplicar, y sin que el Hub reciba dos veces la misma encuesta.
     */
    const { error: alGuardar } = await supabase
      .from("mensajes_entrantes")
      .upsert(
        mensajes.map((m) => ({
          sucursal_id: m.sucursal_id,
          externo_id: m.externo_id,
          contacto: m.contacto,
          texto: m.texto.slice(0, 4096),
          ts: new Date(m.ts).toISOString(),
        })),
        { onConflict: "externo_id", ignoreDuplicates: true },
      );

    if (alGuardar) {
      console.error(`No se pudieron guardar los mensajes: ${alGuardar.message}`);
      return new Response(null, { status: 500 });
    }
  }

  return new Response(null, { status: 200 });
});
