/**
 * El enlace del Hub con la nube de MotRest, cuando esa nube es Supabase.
 *
 * Hace exactamente lo mismo que `EnlaceRelayWs` (relay.ts) y por eso implementa
 * su misma interfaz: main.ts elige uno u otro por la forma de la dirección y no
 * sabe cuál le tocó. Lo que cambia es que ya no hay un servidor de MOTRAE
 * sosteniendo el socket — lo sostiene Realtime.
 *
 * POR QUÉ ESTO NO ES REPUNTAR EL ANTERIOR
 *
 * `EnlaceRelayWs` habla un protocolo propio: abre un WebSocket, dice
 * `{tipo:"hola"}` con su credencial y el relay le contesta. Realtime habla
 * Phoenix y autentica con un JWT. No es la misma conversación con otra URL, es
 * otra conversación — de ahí que convivan dos clases en vez de un parámetro.
 *
 * SI ESTO NO CONECTA, EL RESTAURANTE SIGUE VENDIENDO. Igual que antes: el POS,
 * el KDS, las impresoras, el portal y el corte de caja viven en el Hub y no
 * pasan por aquí. Lo que se pierde son los avisos de WhatsApp y que Central vea
 * el pulso.
 *
 * DE LOS CUATRO TRABAJOS, UNO SOLO NECESITA EL SOCKET
 *
 * Los mensajes entrantes, porque el comensal está esperando. El pulso, la
 * licencia y las credenciales son petición-respuesta y van por HTTP, que es más
 * simple y falla de forma más obvia.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import type { Aviso } from "./avisos.js";
import type { EnlaceConMotrae, MensajeDelComensal, OpcionesNube } from "./enlace-motrae.js";

/** El buzón de cada Hub en Supabase Auth. No recibe correo; es un identificador. */
const DOMINIO_HUBS = "hubs.motrae.mx";

/**
 * Cuánto hacia atrás se recogen los mensajes que llegaron con el local apagado.
 *
 * VEINTICUATRO HORAS, y no más, porque es exactamente la ventana que Meta da
 * para contestar con texto libre. Un mensaje más viejo que eso ya no abre nada:
 * recuperarlo solo serviría para llenarle la pantalla al restaurante un lunes
 * por la mañana.
 *
 * El relay no recuperaba ninguno —no tenía dónde guardarlos— y eso dejaba un
 * fallo silencioso: si un comensal escribía de madrugada, el Hub no se enteraba
 * y creía que no podía responderle con texto libre. Ahora que la tabla los
 * guarda, recogerlos es lo correcto.
 */
const VENTANA_RECUPERACION_MS = 24 * 60 * 60 * 1000;

const REINTENTO_BASE_MS = 2_000;
const REINTENTO_MAX_MS = 5 * 60 * 1000;

/**
 * ¿Se puede usar esta dirección para hablar con la nube?
 *
 * **Solo `https://`.** Por aquí viajan la credencial del restaurante y el token
 * de la API de Meta; en claro se los lleva cualquiera en el mismo wifi, y a
 * partir de ahí manda WhatsApp en nombre del restaurante. Es la misma regla que
 * la nube aplica a todo lo que sale del restaurante, y por la misma razón.
 *
 * Se deja pasar el bucle local para poder correr el ensayo contra un Supabase de
 * desarrollo, donde no hay red que escuchar.
 */
export function direccionDeNubeUsable(url: string): { ok: true } | { ok: false; motivo: string } {
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return { ok: false, motivo: `La dirección de la nube no es válida: ${url}` };
  }

  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(destino.hostname);
  if (destino.protocol === "https:") return { ok: true };
  if (destino.protocol === "http:" && local) return { ok: true };

  return {
    ok: false,
    motivo:
      `La nube se configuró como "${url}". Tiene que ser https:// — por ahí van la ` +
      "credencial del local y el token de WhatsApp, y sin cifrar los ve cualquiera.",
  };
}

/**
 * ¿Este local tiene dirección de nube, o no tiene ninguna?
 *
 * Distingue «hay a dónde hablar» de «este local todavía no está enlazado», que
 * es un caso normal: un restaurante recién instalado opera con el portal y sin
 * nube hasta que se le emite la licencia con sus datos.
 *
 * Es deliberadamente laxa —solo mira el esquema— porque quien decide si la
 * dirección SIRVE es `direccionDeNubeUsable`, que exige https salvo en el bucle
 * local. Tener dos comprobaciones estrictas del mismo dato es cómo se acaba con
 * dos que discrepan.
 */
export function pareceNubeSupabase(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export class EnlaceSupabase implements EnlaceConMotrae {
  private cliente: SupabaseClient | null = null;
  private canal: RealtimeChannel | null = null;
  private intentos = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private cerradoAProposito = false;
  private dentro = false;

  constructor(private opciones: OpcionesNube) {}

  conectado(): boolean {
    return this.dentro;
  }

  conectar(): void {
    this.cerradoAProposito = false;
    void this.entrar();
  }

  private async entrar(): Promise<void> {
    const usable = direccionDeNubeUsable(this.opciones.url);
    if (!usable.ok) {
      // No se reintenta: insistir cada dos segundos contra una dirección que
      // nunca va a servir solo llena el registro y esconde el aviso que importa.
      this.opciones.registrar("error", usable.motivo);
      this.cerradoAProposito = true;
      return;
    }

    try {
      this.cliente = createClient(this.opciones.url, this.opciones.llavePublicable, {
        auth: {
          // El Hub es un servicio, no un navegador: no hay dónde persistir una
          // sesión ni quien la comparta. El refresco sí hace falta, porque esto
          // lleva semanas encendido sin reiniciarse.
          persistSession: false,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
        realtime: {
          /*
           * El WebSocket se pasa a mano A PROPÓSITO.
           *
           * Node 22 trae uno global, pero este código acaba dentro de un
           * ejecutable SEA, y ahí es donde las cosas que "ya vienen incluidas"
           * dejan de estarlo sin avisar. Un enlace que funciona en `pnpm dev` y
           * no en la caja instalada es exactamente el fallo que más caro sale.
           */
          transport: WebSocket as unknown as never,
        },
      });

      const { error } = await this.cliente.auth.signInWithPassword({
        email: `${this.opciones.sucursal_id}@${DOMINIO_HUBS}`,
        password: this.opciones.clave,
      });

      if (error) {
        /*
         * Una credencial que no reconoce no se arregla reintentando, igual que
         * en el relay: es un problema de alta que alguien tiene que mirar. Se
         * sigue reintentando de todos modos porque el mismo error sale cuando
         * la nube está caída, y ahí sí conviene volver.
         */
        this.caer(`La nube rechazó la credencial de este local: ${error.message}`);
        return;
      }
    } catch (causa) {
      this.caer(`No se pudo abrir el enlace con la nube: ${String(causa)}`);
      return;
    }

    this.intentos = 0;
    this.dentro = true;
    this.opciones.registrar("info", "Enlace con la nube de MotRest establecido.");

    await this.escuchar();
    await this.recogerLoPendiente();

    this.opciones.alConectar?.();
  }

  /**
   * Lo que llega solo: mensajes del comensal y renovaciones de MOTRAE.
   *
   * El filtro por sucursal va en la suscripción **y** en las políticas RLS de la
   * tabla. Es deliberadamente redundante: el filtro es una comodidad para no
   * recibir de más, la política es la que impide recibir lo ajeno. Confiar solo
   * en el filtro sería confiar en el cliente.
   */
  private async escuchar(): Promise<void> {
    if (!this.cliente) return;
    const suyo = `sucursal_id=eq.${this.opciones.sucursal_id}`;

    this.canal = this.cliente
      .channel(`hub-${this.opciones.sucursal_id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensajes_entrantes", filter: suyo },
        (carga) => void this.atenderMensaje(carga.new as Record<string, unknown>),
      )
      /*
       * INSERT **Y** UPDATE, y esto no es por si acaso.
       *
       * `licencias_pendientes` tiene la sucursal como clave primaria: hay una
       * sola fila por restaurante, para siempre. Así que la PRIMERA renovación
       * de un local es un INSERT y **todas las siguientes son UPDATE**.
       *
       * Escuchando solo INSERT, un restaurante recibía su primera renovación al
       * instante y las demás únicamente al reconectar el Hub — que en un local
       * encendido son semanas. Y el fallo sería intermitente, porque cualquier
       * reinicio lo tapaba. Lo destapó el ensayo contra la nube de verdad
       * (ensayo/nube.ts); ninguna prueba con dobles lo habría visto.
       */
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "licencias_pendientes", filter: suyo },
        (carga) => void this.atenderLicencia(carga.new as Record<string, unknown>),
      )
      .subscribe((estado) => {
        if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") {
          this.caer(`Se perdió la escucha de la nube (${estado})`);
        }
      });
  }

  /**
   * Lo que pasó mientras el local estaba apagado.
   *
   * La renovación se recoge SIEMPRE, sin límite de antigüedad: es lo que hace
   * que renovar a un local cerrado funcione igual, porque la licencia lo espera
   * y la instala al encender por la mañana.
   *
   * Los mensajes, solo los de las últimas 24 horas — más viejos no abren la
   * ventana de respuesta de Meta y no sirven para nada.
   */
  private async recogerLoPendiente(): Promise<void> {
    if (!this.cliente) return;

    const { data: licencia } = await this.cliente
      .from("licencias_pendientes")
      .select("licencia, confirmada_ts")
      .is("confirmada_ts", null)
      .maybeSingle();

    if (licencia) await this.atenderLicencia(licencia as Record<string, unknown>);

    const desde = new Date(Date.now() - VENTANA_RECUPERACION_MS).toISOString();
    const { data: mensajes } = await this.cliente
      .from("mensajes_entrantes")
      .select("id, contacto, texto, externo_id, ts")
      .is("entregado_ts", null)
      .gte("ts", desde)
      .order("ts", { ascending: true });

    if (mensajes?.length) {
      this.opciones.registrar("info", `${mensajes.length} mensaje(s) llegaron con el local apagado.`);
      for (const mensaje of mensajes) await this.atenderMensaje(mensaje as Record<string, unknown>);
    }
  }

  private async atenderMensaje(fila: Record<string, unknown>): Promise<void> {
    this.opciones.alLlegarMensaje({
      sucursal_id: this.opciones.sucursal_id,
      contacto: String(fila.contacto ?? ""),
      texto: String(fila.texto ?? ""),
      externo_id: String(fila.externo_id ?? ""),
      ts: new Date(String(fila.ts ?? Date.now())).getTime(),
    } satisfies MensajeDelComensal);

    // Se marca DESPUÉS de entregarlo al Hub, no antes: si el proceso se cae en
    // medio, es preferible repetir un mensaje que perderlo. El Hub ya descarta
    // repetidos por `externo_id`.
    if (fila.id) {
      await this.cliente
        ?.from("mensajes_entrantes")
        .update({ entregado_ts: new Date().toISOString() })
        .eq("id", fila.id);
    }
  }

  /**
   * MOTRAE renovó: la licencia llega sola y el restaurante no toca nada.
   *
   * QUIEN DECIDE SI VALE ES EL HUB. Lo que llega por aquí es un documento
   * firmado que se verifica contra la pública de MOTRAE compilada en este
   * binario, exactamente igual que si se hubiera pegado a mano. Supabase es un
   * cartero: puede no entregar, no puede falsificar.
   *
   * SIEMPRE SE CONTESTA, salga bien o mal. Si nos callamos porque falló, la
   * renovación se quedaría pendiente para siempre reintentando en cada
   * conexión y nadie sabría por qué. La respuesta con el motivo es lo que
   * convierte un fallo silencioso en una línea en el registro de MOTRAE.
   */
  private async atenderLicencia(fila: Record<string, unknown>): Promise<void> {
    /*
     * Una ya confirmada no se vuelve a instalar.
     *
     * Hace falta porque ahora se escuchan también los UPDATE, y el propio Hub
     * hace uno al confirmar: sin esta guarda, su confirmación le llegaría de
     * vuelta como una licencia nueva y se quedaría dando vueltas contra la
     * nube, instalando lo mismo una y otra vez.
     */
    if (fila.confirmada_ts) return;
    if (!fila.licencia) return;

    let resultado: { ok: boolean; error?: string };
    try {
      resultado = (await this.opciones.alLlegarLicencia?.(fila.licencia)) ?? {
        ok: false,
        error: "Este Hub no sabe recibir licencias por la nube",
      };
    } catch (causa) {
      resultado = { ok: false, error: String(causa) };
    }

    this.opciones.registrar(
      resultado.ok ? "info" : "error",
      resultado.ok
        ? "MOTRAE renovó la licencia de este local."
        : `Llegó una licencia de MOTRAE que no se pudo instalar: ${resultado.error ?? ""}`,
    );

    await this.cliente
      ?.from("licencias_pendientes")
      .update(
        resultado.ok
          ? { confirmada_ts: new Date().toISOString(), ultimo_error: null }
          : { ultimo_error: (resultado.error ?? "sin motivo").slice(0, 500) },
      )
      .eq("sucursal_id", this.opciones.sucursal_id);
  }

  /**
   * El manifiesto firmado de la versión que le toca a ESTE local.
   *
   * Se devuelve el documento TAL CUAL lo firmó Central —la columna
   * `manifiesto`— y no se reconstruye desde las otras columnas. La firma cubre
   * el JSON canónico entero: un campo de más, uno de menos o un número
   * redondeado distinto y la verificación falla. Ese fallo no lo vería nadie
   * hasta que un restaurante dejara de actualizarse.
   *
   * Qué versión es "la que le toca" lo decide la base de datos con RLS: este
   * Hub ve una sola fila de `versiones`, la de su asignación. No puede
   * enumerar el catálogo ni bajarse una beta que no le corresponde — que en el
   * manifiesto público de GitHub dependía de que el propio Hub se aplicara el
   * anillo con honradez.
   */
  async manifiestoDeMiVersion(): Promise<unknown | null> {
    if (!this.dentro || !this.cliente) return null;

    const { data, error } = await this.cliente
      .from("versiones")
      .select("manifiesto")
      .maybeSingle();

    if (error) {
      this.opciones.registrar("aviso", `No se pudo consultar el canal: ${error.message}`);
      return null;
    }
    return data?.manifiesto ?? null;
  }

  /**
   * Una URL con permiso para bajar ESTE instalador, válida un rato.
   *
   * El bucket es privado y tiene que serlo. La autorización no puede viajar
   * dentro del manifiesto —que es inmutable y va firmado—, así que se pide
   * aquí, con la sesión de este Hub, justo antes de bajar.
   *
   * Quién puede pedirla lo decide RLS sobre el objeto: un local solo firma el
   * archivo de la versión que tiene asignada. Pedir el de otro devuelve
   * error, no un enlace.
   *
   * Si algo falla se devuelve la URL original en vez de reventar: que la
   * descarga falle después con un 400 es más fácil de leer en la bitácora que
   * una excepción a mitad del canal.
   */
  async firmarDescarga(url: string): Promise<string> {
    if (!this.dentro || !this.cliente) return url;

    const marca = "/storage/v1/object/";
    const i = url.indexOf(marca);
    if (i < 0) return url;

    // De "…/object/instaladores/1.3.6.exe" salen el bucket y la ruta dentro.
    const resto = url.slice(i + marca.length).replace(/^(public|authenticated)[/]/, "");
    const corte = resto.indexOf("/");
    if (corte < 0) return url;
    const bucket = resto.slice(0, corte);
    const ruta = resto.slice(corte + 1);

    // Cinco minutos: lo que tarda una descarga de 26 MB en un restaurante con
    // internet malo, y no más. Un enlace que dura horas es un enlace que se
    // reenvía.
    const { data, error } = await this.cliente.storage.from(bucket).createSignedUrl(ruta, 300);
    if (error || !data?.signedUrl) {
      this.opciones.registrar(
        "aviso",
        `No se pudo firmar la descarga de ${ruta}: ${error?.message ?? "sin motivo"}`,
      );
      return url;
    }
    return data.signedUrl;
  }
  /** Le pide a la nube que mande un aviso. Las reglas ya se comprobaron antes. */
  enviar(aviso: Aviso): void {
    if (!this.dentro || !this.cliente) return;
    void this.cliente.functions
      .invoke("enviar-whatsapp", {
        body: { contacto: aviso.contacto, texto: aviso.texto, plantilla: aviso.plantilla },
      })
      .then(({ error }) => {
        if (error) this.opciones.registrar("aviso", `La nube no pudo mandar un aviso: ${error.message}`);
      });
  }

  /**
   * El parte de vida del local: qué versión tiene y cómo está.
   *
   * **El `sucursal_id` no viaja**: sale del JWT con el que este Hub entró, y las
   * políticas de la tabla no dejan escribir en la fila de otro. Un local no
   * puede reportar en nombre de otro ni por error ni a propósito.
   *
   * **La hora tampoco**: la pone el servidor con un trigger. El reloj de un
   * local puede estar en cualquier año.
   *
   * Si el enlace está caído el pulso se pierde y no se encola. Es correcto: el
   * siguiente sustituye al anterior por completo, y uno de hace cuatro horas no
   * le sirve a nadie.
   */
  reportarPulso(pulso: Record<string, unknown>): void {
    if (!this.dentro || !this.cliente) return;
    const { sucursal_id: _propio, ts: _servidor, ...cuerpo } = pulso;

    void this.cliente
      .from("pulsos")
      .upsert({ ...cuerpo, sucursal_id: this.opciones.sucursal_id }, { onConflict: "sucursal_id" })
      .then(({ error }) => {
        if (error) this.opciones.registrar("aviso", `No se pudo reportar el pulso: ${error.message}`);
      });
  }

  /**
   * Publica el número de WhatsApp de ESTE restaurante.
   *
   * Va por una Edge Function y no por la tabla porque **el token se guarda
   * cifrado con una llave de MOTRAE que el Hub no tiene** — igual que el relay
   * cifraba el padrón en su volumen. Escribirlo directo dejaría el token de la
   * API de Meta en claro en la base de datos.
   *
   * Se manda en CADA conexión, no solo al darlo de alta: si la nube se
   * reinstalara o perdiera el padrón, el restaurante se recupera solo en vez de
   * dejar de recibir mensajes en silencio.
   */
  publicarCredenciales(cred: { phone_number_id: string; token: string; nombre: string }): void {
    this.opciones.credenciales = cred;
    if (!this.dentro || !this.cliente) return;

    void this.cliente.functions.invoke("publicar-credenciales", { body: cred }).then(({ error }) => {
      if (error) {
        this.opciones.registrar("error", `La nube rechazó el número de WhatsApp del local: ${error.message}`);
      }
    });
  }

  private caer(razon: string): void {
    if (this.dentro) this.opciones.registrar("aviso", razon);
    this.dentro = false;
    void this.canal?.unsubscribe();
    this.canal = null;
    if (this.cerradoAProposito) return;

    /*
     * Espera creciente con tope. Sin ella, una nube caída recibiría un intento
     * por segundo de cada restaurante — que es cómo un servicio que se está
     * recuperando se vuelve a caer.
     */
    this.intentos += 1;
    const espera = Math.min(REINTENTO_BASE_MS * 2 ** (this.intentos - 1), REINTENTO_MAX_MS);
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.entrar(), espera);
  }

  desconectar(): void {
    this.cerradoAProposito = true;
    if (this.temporizador) clearTimeout(this.temporizador);
    void this.canal?.unsubscribe();
    this.canal = null;
    void this.cliente?.auth.signOut();
    this.cliente = null;
    this.dentro = false;
  }
}
