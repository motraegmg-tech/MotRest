/**
 * Los correos al comensal (M7): la configuración y las peticiones de envío.
 *
 * DOS COSAS DISTINTAS EN UN MISMO ALMACÉN, y cada una por su camino:
 *
 *   - La CONFIGURACIÓN —desde qué cuenta salen, cuáles están encendidos— es
 *     catálogo del local, igual que el plano o las impresoras: se guarda como
 *     estado, no como eventos.
 *
 *   - Las PETICIONES son hechos: «Lucía le pidió al Hub un cupón para Ana Ruiz
 *     el martes a las 18:02». Van al registro como `correo_solicitado`, el Hub
 *     las atiende y contesta `correo_enviado` o `correo_rechazado` con el mismo
 *     `solicitud_id`. Antes no había manera de pedir nada: de los seis correos
 *     solo salía la confirmación de reserva, que el Hub dispara solo, y los
 *     otros cinco eran interruptores conectados a nada.
 *
 * LA CONTRASEÑA DE GMAIL NO SE GUARDA AQUÍ. Esto vive en cada tableta del salón;
 * una credencial que puede mandar correo en nombre del restaurante no tiene por
 * qué estar en el teléfono de un mesero. Se queda en el Hub, que es quien manda.
 */
import {
  CATALOGO_CORREOS,
  EJEMPLOS_DE_CORREO,
  FabricaEventos,
  TOPES_CORREO,
  botonEditable,
  catalogoDeCorreos,
  compararEventos,
  configuracionVacia,
  correoPlausible,
  correoPropio,
  esCuentaGmail,
  esTipoDeLaCasa,
  esTipoPropio,
  estadosDeCorreo,
  limpiarBorrador,
  pideMensaje,
  problemasDeRemitente,
  problemasDelBorrador,
  propiosDe,
  puedeMandarCorreo,
  streamCorreo,
  uuidv7,
  type BorradorDeCorreo,
  type ConfiguracionCorreo,
  type CorreoPropio,
  type DatosCorreo,
  type DefinicionCorreo,
  type EventoCorreo,
  type ID,
  type PlantillaCorreo,
  type ProblemaDeCorreo,
  type TipoCorreo,
  type TipoCorreoDeLaCasa,
  type TipoCorreoPropio,
} from "@motrest/dominio";
import { catalogoMasNuevo, type Almacen } from "@motrest/protocolo-sync";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export const CLAVE_CORREO = "correo_config";

/** La configuración tal como viaja: con versión y fecha siempre puestas. */
export type ConfiguracionPublicable = ConfiguracionCorreo & { version: number; updated_at: number };

/**
 * La versión y la fecha de una configuración, con cero si no las trae.
 *
 * Las configuraciones guardadas antes de la 1.5.5 no tienen ninguna de las dos.
 * Leerlas como 0 hace que cualquier cambio posterior las supere, y deja que el
 * Hub —que rechaza un catálogo sin versión numérica— las acepte la primera vez.
 */
function versionDe(config: ConfiguracionCorreo): { version: number; updated_at: number } {
  return { version: config.version ?? 0, updated_at: config.updated_at ?? 0 };
}

export interface ResultadoCorreo {
  ok: boolean;
  error?: string;
  /** Lo que impide guardar un correo, campo por campo, para señalarlo en el editor. */
  problemas?: ProblemaDeCorreo[];
}

/** Al crear un correo propio hace falta saber cuál se creó: la pantalla lo enseña. */
export type ResultadoPropio =
  | { ok: true; tipo: TipoCorreoPropio }
  | { ok: false; error: string; problemas?: ProblemaDeCorreo[] };

export type ResultadoSolicitud =
  | { ok: true; solicitud_id: ID }
  | { ok: false; error: string };

/** Una petición de correo tal como la enseña la ficha: qué, a quién y cómo acabó. */
export interface SolicitudCorreo {
  solicitud_id: ID;
  clase_correo: TipoCorreo;
  correo: string;
  cliente_id?: ID;
  datos: DatosCorreo;
  pedido_ts: number;
  /** Quién lo pidió. El Hub firma el resultado; la petición la firma una persona. */
  pedido_por: ID;
  estado: "pendiente" | "enviado" | "rechazado";
  resuelto_ts?: number;
  motivo?: string;
}

/**
 * Pone al día una configuración, venga de donde venga.
 *
 * ARREGLA LAS CONFIGURACIONES VIEJAS. `configuracionVacia()` ya nace en modo
 * Gmail, pero una guardada antes no trae `modo`, y el Hub lee «sin modo» como
 * dominio propio: intentaba mandar por Resend desde un `@gmail.com`, que Resend
 * no puede verificar, y no llegaba nada. Si el remitente es una cuenta de
 * Google, el modo es Gmail y no hay nada que decidir.
 *
 * Y QUITA EL «RESPONDER A» fuera del modo MOTRAE. Salió del formulario en la
 * 1.5.5; un valor viejo que se quedara guardado seguiría viajando, y si no
 * pareciera un correo válido la pantalla enseñaría un problema que ya no hay
 * dónde corregir.
 */
export function normalizarConfiguracion(config: ConfiguracionCorreo): ConfiguracionCorreo {
  const { responder_a, modo: modoGuardado, ...resto } = config;
  const modo = esCuentaGmail(config.remitente) ? "gmail" : modoGuardado;

  return {
    ...resto,
    ...(modo ? { modo } : {}),
    ...(modo === "motrae" && responder_a ? { responder_a } : {}),
  };
}

/**
 * ¿Es una dirección web a la que se puede mandar a alguien?
 *
 * El enlace de la encuesta acaba siendo el botón «Dejar mi opinión». Un
 * `g.page/r/…` sin `https://` delante, o un «reseñas de Google» escrito a mano,
 * dan un botón que no abre nada — y un botón roto en un correo es peor que no
 * mandar el correo.
 */
export function esEnlaceWeb(texto: string): boolean {
  try {
    const url = new URL(texto.trim());
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** La parte de la dirección: «Rodizio <rodizio@gmail.com>» → «rodizio@gmail.com». */
export function direccionDe(remitente: string): string {
  return (remitente.match(/<([^>]+)>/)?.[1] ?? remitente).trim();
}

/** Las peticiones con su estado, la más reciente primero. */
export function solicitudesDeCorreo(eventos: readonly EventoCorreo[]): SolicitudCorreo[] {
  const estados = estadosDeCorreo(eventos);
  const porId = new Map<ID, SolicitudCorreo>();

  for (const ev of eventos) {
    if (ev.tipo !== "correo_solicitado") continue;
    const estado = estados.get(ev.solicitud_id);
    porId.set(ev.solicitud_id, {
      solicitud_id: ev.solicitud_id,
      clase_correo: ev.clase_correo,
      correo: ev.correo,
      ...(ev.cliente_id ? { cliente_id: ev.cliente_id } : {}),
      datos: ev.datos,
      pedido_ts: ev.ts,
      pedido_por: ev.empleado_id,
      estado: estado?.estado ?? "pendiente",
      ...(estado && estado.estado !== "pendiente" ? { resuelto_ts: estado.resuelto_ts } : {}),
      ...(estado?.estado === "rechazado" ? { motivo: estado.motivo } : {}),
    });
  }

  return [...porId.values()].sort((a, b) => b.pedido_ts - a.pedido_ts);
}

/**
 * Copia los datos a un objeto plano, sin campos vacíos.
 *
 * Plano porque lo que llega de una pantalla suele ser un `$state` de Svelte, es
 * decir un Proxy, e IndexedDB no sabe guardar un Proxy. Y sin vacíos porque un
 * `mensaje: ""` en el registro es ruido que se queda ahí para siempre.
 */
function datosLimpios(datos: DatosCorreo): DatosCorreo {
  const limpio: DatosCorreo = {};
  for (const clave of ["nombre", "cuando", "enlace", "mensaje", "baja"] as const) {
    const valor = datos[clave]?.trim();
    if (valor) limpio[clave] = valor;
  }
  // Con tope: el mensaje queda escrito en el registro para siempre.
  if (limpio.mensaje) limpio.mensaje = limpio.mensaje.slice(0, TOPES_CORREO.mensaje);
  if (typeof datos.personas === "number" && datos.personas > 0) limpio.personas = datos.personas;
  return limpio;
}

/**
 * Los campos de un correo propio a partir de lo escrito, sin vacíos: un botón
 * sin texto o un enlace en blanco no se guardan como `""`.
 */
function camposDePropio(
  limpio: BorradorDeCorreo,
): Pick<CorreoPropio, "nombre" | "asunto" | "titulo" | "texto" | "boton" | "enlace"> {
  return {
    nombre: limpio.nombre ?? "",
    asunto: limpio.asunto,
    titulo: limpio.titulo,
    texto: limpio.texto,
    ...(limpio.boton ? { boton: limpio.boton } : {}),
    ...(limpio.enlace ? { enlace: limpio.enlace } : {}),
  };
}

export class StoreCorreo {
  private datos = $state<ConfiguracionCorreo>(configuracionVacia());
  private almacen: Almacen | null = null;
  private eventos = $state.raw<EventoCorreo[]>([]);

  private fabrica = new FabricaEventos<EventoCorreo>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  /** Todas las peticiones de este local, la más reciente primero. */
  solicitudes = $derived(solicitudesDeCorreo(this.eventos));

  get config(): ConfiguracionCorreo {
    return this.datos;
  }

  /**
   * Qué correos hay, con su explicación: los seis de fábrica y, detrás, los que
   * escribió el restaurante (1.5.6).
   */
  get catalogo(): DefinicionCorreo[] {
    return catalogoDeCorreos(this.datos);
  }

  /** Los seis de fábrica, que se editan pero no se borran. */
  get deLaCasa(): DefinicionCorreo[] {
    return CATALOGO_CORREOS;
  }

  /** Los correos que escribió el restaurante, ya saneados. */
  get propios(): CorreoPropio[] {
    return propiosDe(this.datos);
  }

  /** ¿Cabe otro correo propio? Ver `TOPES_CORREO.propios`. */
  get cabeOtro(): boolean {
    return this.propios.length < TOPES_CORREO.propios;
  }

  /**
   * ¿Está encendido? Los seis lo dicen en `activos`; los propios, en sí mismos.
   * Una sola pregunta para las dos cosas, para que ninguna pantalla tenga que
   * saber dónde vive cada interruptor.
   */
  encendido(tipo: TipoCorreo): boolean {
    if (esTipoPropio(tipo)) return correoPropio(tipo, this.datos)?.activo === true;
    return !!this.datos.activos[tipo];
  }

  /**
   * ¿Está listo para mandar algo?
   *
   * Sin remitente no sale nada, y conviene decirlo arriba de la pantalla en vez
   * de dejar que el restaurantero encienda seis correos y ninguno llegue.
   */
  get listo(): boolean {
    return this.datos.remitente.trim().length > 0;
  }

  get encendidos(): TipoCorreo[] {
    return this.catalogo.filter((d) => this.encendido(d.tipo)).map((d) => d.tipo);
  }

  /** Lo que impide que la configuración guardada funcione, dicho en claro. */
  get problemas(): string[] {
    return problemasDeRemitente(this.datos);
  }

  /** El estado de cada petición, por su `solicitud_id`. */
  get estados() {
    return estadosDeCorreo(this.eventos);
  }

  /**
   * Carga la configuración guardada y deja el almacén conectado.
   *
   * Hace las veces de `conectarAlmacen` de los demás almacenes: el arranque la
   * llama después de conectarlos a todos, y a partir de ahí cada petición de
   * correo se guarda en el registro como cualquier otro evento.
   */
  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardada = await almacen.estado.cargar<ConfiguracionCorreo>(CLAVE_CORREO);
    if (guardada) this.datos = normalizarConfiguracion(guardada);
  }

  /** Las peticiones y respuestas que ya estaban en el registro de esta terminal. */
  hidratarEventos(eventos: readonly EventoCorreo[]): void {
    this.eventos = [...eventos];
  }

  /**
   * Lo que llega del Hub o de otra terminal, sin duplicar lo ya conocido.
   *
   * Es por aquí por donde vuelve la respuesta del Hub: sin esta puerta, la ficha
   * se quedaría en «Enviando…» para siempre aunque el correo ya hubiera llegado.
   */
  integrar(eventos: readonly EventoCorreo[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  /**
   * La configuración que llega del Hub o de otra terminal — SOLO si es más nueva.
   *
   * Antes la adoptaba sin mirar, así que una tableta que se reconectaba con una
   * copia vieja podía pisar lo que alguien acababa de cambiar en la caja. Se
   * compara versión y fecha igual que la carta y el plano, y se guarda al
   * adoptarla para que sobreviva a un reinicio de la terminal.
   *
   * Devuelve si la adoptó, que es lo que cuenta el enlace para saber si llegó
   * algo nuevo.
   */
  fusionar(entrante: ConfiguracionCorreo): boolean {
    const normalizada = normalizarConfiguracion(entrante);
    if (!catalogoMasNuevo(versionDe(normalizada), versionDe(this.datos))) return false;
    this.datos = normalizada;
    this.guardar();
    return true;
  }

  /** Quien publica los cambios hacia el Hub. Lo engancha el enlace al arrancar. */
  private alCambiar: ((config: ConfiguracionPublicable) => void) | null = null;

  alPublicar(escucha: (config: ConfiguracionPublicable) => void): void {
    this.alCambiar = escucha;
  }

  /** Lo que se publica como catálogo: la configuración con su versión, y nada secreto. */
  get paraPublicar(): ConfiguracionPublicable {
    /*
     * La contraseña de aplicación de Gmail NO viaja por aquí, ni aunque alguien
     * la hubiera dejado en este objeto: este catálogo llega a TODAS las tabletas
     * del salón, incluido el teléfono de un mesero, y con esa contraseña se
     * puede mandar correo en nombre del restaurante. Vive solo en el Hub.
     */
    const { llave: _llave, ...sinSecreto } = this.datos as ConfiguracionCorreo & {
      llave?: string;
    };
    return { ...sinSecreto, ...versionDe(this.datos) };
  }

  /**
   * Aplica un cambio: sube la versión, lo guarda y lo manda al Hub.
   *
   * Es el único camino por el que cambia la configuración, a propósito. Tener
   * `guardar()` repartido en cada método era lo que permitía cambiar algo sin
   * publicarlo, que es exactamente el defecto que dejaba al Hub sin enterarse.
   */
  private cambiar(nuevos: ConfiguracionCorreo): void {
    this.datos = {
      ...nuevos,
      version: (this.datos.version ?? 0) + 1,
      updated_at: Date.now(),
    };
    this.guardar();
    this.alCambiar?.(this.paraPublicar);
  }

  /** Quién está pidiendo los correos. Sin esto, la petición saldría a nombre de «sistema». */
  actuarComo(empleadoId: ID): void {
    this.fabrica.actualizarContexto({ empleado_id: empleadoId });
  }

  private emitir(evento: EventoCorreo): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar la petición de correo", causa);
    });
  }

  private guardar(): void {
    void this.almacen?.estado.guardar(CLAVE_CORREO, this.datos).catch((causa) => {
      console.error("No se pudo guardar la configuración de correo", causa);
    });
  }

  // --- Consultas ----------------------------------------------------------------

  /** Lo que se le ha pedido a un comensal, lo más reciente primero. */
  ultimosDe(clienteId: ID): SolicitudCorreo[] {
    return this.solicitudes.filter((s) => s.cliente_id === clienteId);
  }

  /**
   * El recordatorio de UNA reserva, si ya se pidió.
   *
   * El evento no guarda de qué reserva era —habla de correos, no de mesas—, así
   * que se reconoce por lo que sí lleva: la misma fecha escrita y el mismo
   * destinatario. Una reserva no se mueve de hora sin cancelarse y volverse a
   * apartar, así que esa pareja la identifica.
   *
   * Se prefiere uno en camino o entregado sobre uno rechazado: si el primero
   * falló y el segundo salió, lo que importa es que ya salió.
   */
  recordatorioDe(cuando: string, correos: readonly (string | undefined)[]): SolicitudCorreo | undefined {
    const direcciones = new Set(
      correos.map((c) => c?.trim().toLowerCase()).filter((c): c is string => !!c),
    );
    const suyos = this.solicitudes.filter(
      (s) =>
        s.clase_correo === "reserva_recordatorio" &&
        s.datos.cuando === cuando &&
        direcciones.has(s.correo.trim().toLowerCase()),
    );
    return suyos.find((s) => s.estado !== "rechazado") ?? suyos[0];
  }

  // --- Pedir un correo --------------------------------------------------------------

  /**
   * Le pide al Hub que mande un correo.
   *
   * Pasa ANTES por `puedeMandarCorreo`, la misma puerta que el Hub vuelve a
   * comprobar: pedir algo que se sabe que se va a rechazar solo llena la ficha
   * de «No se mandó» que nadie entiende.
   *
   * No empuja al Hub a mano: el arranque envuelve el almacén para que todo lo
   * que se anota salga solo, sin depender de que cada almacén se acuerde.
   */
  solicitar(
    tipo: TipoCorreo,
    correo: string,
    datos: DatosCorreo,
    opciones: { cliente_id?: ID; acepta_marketing: boolean },
  ): ResultadoSolicitud {
    /*
     * NUNCA A NOMBRE DE «SISTEMA». Un evento de terminal firmado así estuvo
     * meses rechazándose en bucle en este proyecto (el cierre de caja). Y
     * aquí, además, borraría lo que más importa ante una queja por publicidad:
     * quién decidió mandarla.
     */
    if (this.fabrica.empleadoActual === "sistema") {
      return {
        ok: false,
        error: "Inicia sesión para mandar correos: cada correo queda a nombre de quien lo pidió",
      };
    }

    const para = correo.trim();
    const veredicto = puedeMandarCorreo(tipo, para, this.datos, opciones.acepta_marketing);
    if (!veredicto.puede) return { ok: false, error: veredicto.razon };

    const limpios = datosLimpios(datos);
    /*
     * El mensaje lo pide la PLANTILLA, no la clase (1.5.6). Antes toda la
     * publicidad lo exigía porque su cuerpo era el mensaje; ahora un cupón que
     * el restaurante dejó escrito sale con su texto, y exigir un mensaje que no
     * va a aparecer en ningún lado solo frenaría el envío.
     */
    if (pideMensaje(tipo, this.datos) && !limpios.mensaje) {
      return { ok: false, error: "Escribe el mensaje antes de mandarlo" };
    }
    if ((tipo === "reserva_confirmada" || tipo === "reserva_recordatorio") && !limpios.cuando) {
      return { ok: false, error: "Falta el día y la hora de la reserva" };
    }

    const solicitud_id = uuidv7();
    this.emitir(
      this.fabrica.crear("correo_solicitado", streamCorreo(SUCURSAL_ID), {
        solicitud_id,
        clase_correo: tipo,
        correo: para,
        ...(opciones.cliente_id ? { cliente_id: opciones.cliente_id } : {}),
        datos: limpios,
        acepta_marketing: opciones.acepta_marketing,
      }),
    );
    return { ok: true, solicitud_id };
  }

  // --- Configuración ----------------------------------------------------------------

  actualizar(cambios: Partial<ConfiguracionCorreo>): ResultadoCorreo {
    const remitente = (cambios.remitente ?? this.datos.remitente).trim();

    /*
     * El remitente admite dos formas: "correo@dominio" o "Nombre <correo@dominio>".
     * La segunda es la que conviene —el comensal ve "Rodizio" y no una
     * dirección— así que se acepta y se valida solo la parte del correo.
     */
    if (remitente && !correoPlausible(direccionDe(remitente))) {
      return { ok: false, error: "El remitente no parece una dirección de correo" };
    }

    const enlace = (cambios.enlace_encuesta ?? this.datos.enlace_encuesta ?? "").trim();
    if (enlace && !esEnlaceWeb(enlace)) {
      return {
        ok: false,
        error: "El enlace de la encuesta tiene que ser una dirección web completa, que empiece con https://",
      };
    }

    this.cambiar(
      normalizarConfiguracion({
        ...this.datos,
        ...cambios,
        remitente,
        enlace_encuesta: enlace || undefined,
      }),
    );
    return { ok: true };
  }

  /** Enciende o apaga un tipo de correo, de los seis o de los propios. */
  alternar(tipo: TipoCorreo): void {
    if (esTipoPropio(tipo)) {
      if (!correoPropio(tipo, this.datos)) return;
      this.cambiar({
        ...this.datos,
        propios: this.propios.map((p) => (p.tipo === tipo ? { ...p, activo: !p.activo } : p)),
      });
      return;
    }
    this.cambiar({
      ...this.datos,
      activos: { ...this.datos.activos, [tipo]: !this.datos.activos[tipo] },
    });
  }

  // --- Lo que escribe el restaurante (1.5.6) ------------------------------------------

  /**
   * Guarda lo que el restaurante reescribió de uno de los seis.
   *
   * SE GUARDA SOLO LO QUE CAMBIÓ. Un campo igual al ejemplo no se escribe, así
   * que «Volver al ejemplo» y guardar deja el correo exactamente como venía de
   * fábrica —sin una copia congelada del texto de hoy—, y el asunto sigue
   * viviendo en `asuntos`, donde un Hub de la 1.5.5 también lo lee.
   *
   * Pasa por la misma validación que las pruebas: un marcador que no se puede
   * llenar o un hueco del ejemplo sin llenar no llegan a la configuración, y
   * por lo tanto tampoco al Hub.
   */
  guardarPlantilla(tipo: TipoCorreoDeLaCasa, borrador: BorradorDeCorreo): ResultadoCorreo {
    if (!esTipoDeLaCasa(tipo)) return { ok: false, error: "Ese correo no es de los de fábrica" };
    const limpio = limpiarBorrador({ ...borrador, nombre: undefined, enlace: undefined });
    const problemas = problemasDelBorrador(tipo, limpio);
    if (problemas.length > 0) return { ok: false, error: problemas[0]!.mensaje, problemas };

    const ejemplo = EJEMPLOS_DE_CORREO[tipo];
    const asuntoDeFabrica = CATALOGO_CORREOS.find((d) => d.tipo === tipo)!.asuntoPorDefecto;

    const suya: PlantillaCorreo = {};
    if (limpio.titulo && limpio.titulo !== ejemplo.titulo) suya.titulo = limpio.titulo;
    if (limpio.texto !== ejemplo.texto) suya.texto = limpio.texto;
    if (botonEditable(tipo) && limpio.boton && limpio.boton !== ejemplo.boton) {
      suya.boton = limpio.boton;
    }

    const asuntos = { ...(this.datos.asuntos ?? {}) };
    if (limpio.asunto !== asuntoDeFabrica) asuntos[tipo] = limpio.asunto;
    else delete asuntos[tipo];

    const plantillas = { ...(this.datos.plantillas ?? {}) };
    if (Object.keys(suya).length > 0) plantillas[tipo] = suya;
    else delete plantillas[tipo];

    this.cambiar({ ...this.datos, asuntos, plantillas });
    return { ok: true };
  }

  /**
   * Crea un correo propio, ya encendido.
   *
   * Encendido porque para llegar aquí alguien lo leyó entero en el editor, con
   * su vista previa al lado; pedirle además que lo encienda sería un paso que
   * se olvida. Si el restaurante lo quiere guardado sin usar, lo apaga.
   */
  crearPropio(borrador: BorradorDeCorreo, arranque?: string): ResultadoPropio {
    if (!this.cabeOtro) {
      return {
        ok: false,
        error: `Ya hay ${TOPES_CORREO.propios} correos del restaurante: borra uno que ya no uses para hacer otro`,
      };
    }
    const tipo: TipoCorreoPropio = `propio:${uuidv7()}`;
    const limpio = limpiarBorrador({ ...borrador, nombre: borrador.nombre ?? "" });
    const problemas = problemasDelBorrador(tipo, limpio);
    if (problemas.length > 0) return { ok: false, error: problemas[0]!.mensaje, problemas };

    const nuevo: CorreoPropio = {
      tipo,
      ...camposDePropio(limpio),
      activo: true,
      ...(arranque ? { arranque } : {}),
      creado_ts: Date.now(),
    };
    this.cambiar({ ...this.datos, propios: [...this.propios, nuevo] });
    return { ok: true, tipo };
  }

  /** Guarda los cambios a un correo propio. Conserva si estaba encendido. */
  guardarPropio(tipo: TipoCorreoPropio, borrador: BorradorDeCorreo): ResultadoCorreo {
    const previo = correoPropio(tipo, this.datos);
    if (!previo) return { ok: false, error: "Ese correo ya no existe: alguien lo borró" };

    const limpio = limpiarBorrador({ ...borrador, nombre: borrador.nombre ?? "" });
    const problemas = problemasDelBorrador(tipo, limpio);
    if (problemas.length > 0) return { ok: false, error: problemas[0]!.mensaje, problemas };

    const { boton: _boton, enlace: _enlace, ...base } = previo;
    const actualizado: CorreoPropio = { ...base, ...camposDePropio(limpio) };
    this.cambiar({
      ...this.datos,
      propios: this.propios.map((p) => (p.tipo === tipo ? actualizado : p)),
    });
    return { ok: true };
  }

  /**
   * Lo borra de la configuración. Lo ya mandado se queda en el registro, con su
   * tipo: la ficha lo sigue enseñando, como «Correo que ya se borró». Y si una
   * tableta que todavía no se entera lo pide, el Hub contesta que ya no existe.
   */
  borrarPropio(tipo: TipoCorreoPropio): void {
    if (!correoPropio(tipo, this.datos)) return;
    this.cambiar({ ...this.datos, propios: this.propios.filter((p) => p.tipo !== tipo) });
  }

  cambiarAsunto(tipo: TipoCorreo, asunto: string): void {
    const limpio = asunto.trim();
    const asuntos = { ...(this.datos.asuntos ?? {}) };
    // Vaciarlo devuelve el asunto de fábrica, en vez de mandar uno en blanco.
    if (limpio) asuntos[tipo] = limpio;
    else delete asuntos[tipo];

    this.cambiar({ ...this.datos, asuntos });
  }
}

export const correo = new StoreCorreo();
