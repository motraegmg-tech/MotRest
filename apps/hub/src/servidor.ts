/**
 * El Hub: árbitro del event log del local.
 *
 * Su única responsabilidad irrenunciable es **asignar la secuencia total**. Los
 * dispositivos sellan con su propio reloj, que puede ir desfasado; quién ocurrió
 * antes lo decide aquí un solo árbitro (TRD §5.1, ADR-17).
 *
 * Lo que el Hub NO hace, a propósito:
 *   - No es requisito para vender. Si se apaga, las terminales siguen operando
 *     en isla y al volver se reconcilian solas (TRD R3).
 *   - No reescribe eventos. Un hecho recibido dos veces conserva su secuencia
 *     original: el log es la bitácora de auditoría y no se corrige, se anexa.
 *
 * La clase no conoce WebSocket ni red: habla con "conexiones" abstractas, para
 * poder probar el protocolo completo sin levantar un servidor.
 */
import {
  aplicarEventoIdentidad,
  esEventoIdentidad,
  esTipoEventoIdentidad,
  evaluar,
  permisosDePlantilla,
  permisosNoOtorgables,
  puedeEliminarA,
  puedeAutorizar,
  puedeGestionarA,
  proyectarIdentidad,
  rolesAsignablesPor,
  streamIdentidad,
  type Accion,
  type EstadoIdentidad,
  type EventoBase,
  type EventoIdentidad,
  type ID,
  type Usuario,
} from "@motrest/dominio";
import {
  VERSION_PROTOCOLO,
  catalogoMasNuevo,
  eventoValido,
  type Ack,
  type Catalogo,
  type MensajeCliente,
  type MensajeHub,
} from "@motrest/protocolo-sync";
import type { LogHub } from "@motrest/protocolo-sync/sqlite";
import type { ColaDeTimbrado } from "./fiscal/cola-timbrado.js";
import type { Facturador } from "./fiscal/facturador.js";
import type { Cancelador } from "./fiscal/cancelador.js";
import type { Sellador } from "./fiscal/sellador.js";

/** Lo mínimo que el Hub necesita de una conexión. */
export interface Conexion {
  id: string;
  enviar(mensaje: MensajeHub): void;
  cerrar(): void;
}

interface Sesion {
  conexion: Conexion;
  device_id: ID;
  sucursal_id: ID;
  saludado: boolean;
  esLocal: boolean;
}

export interface OpcionesHub {
  hub_id: ID;
  log: LogHub;
  /**
   * Exigir que el dispositivo esté aprobado antes de aceptar sus eventos.
   *
   * En un local real va en `true`: alcanzar la red no da derecho a escribir en
   * el log de ventas. Se apaga solo para pruebas y para el primer arranque,
   * donde todavía no hay nadie que pueda aprobar a nadie.
   */
  exigirAprobacion?: boolean;
  /**
   * Compatibilidad para consumidores embebidos durante la migración.
   *
   * El proceso real carga la proyección desde el stream de identidad con
   * `cargarIdentidad`; este resolver solo queda para pruebas y adaptadores que
   * todavía no administran dicho stream.
   */
  usuarioDe?: (empleadoId: ID) => Usuario | undefined;
  /** Persiste un catálogo aceptado, separando el origen de confianza. */
  guardarCatalogo?: (catalogo: Catalogo, origen: "terminal" | "hub") => void;
  /**
   * Fija la identidad del local con la que trae su primera terminal.
   *
   * Solo se llama con el registro EN BLANCO, y por eso es seguro: un local que
   * ya operó tiene eventos, y esos eventos son los que definen a qué sucursal
   * pertenece. Devuelve `false` si quien instaló ya decidió la identidad y no
   * se debe tocar.
   */
  adoptarSucursal?: (sucursalId: ID) => boolean;
  /** Enlaces de emparejamiento, uno por dirección del Hub en la red. */
  enlaces?: () => { etiqueta: string; url: string }[];
  registrar?: (nivel: "info" | "aviso" | "error", mensaje: string) => void;
  /**
   * Se llama con los eventos ACEPTADOS, vengan de donde vengan.
   *
   * Es el punto donde el Hub reacciona a lo que pasa en el local sin que
   * ninguna terminal tenga que acordarse de avisarle: confirmar una reserva
   * dispara su mensaje de WhatsApp aunque quien la confirmó fuera una tablet
   * que ni sabe que el relay existe.
   */
  alIngerir?: (eventos: readonly EventoBase[]) => void;
  /**
   * Facturación. Opcional: un Hub sin CSD sigue siendo un Hub perfectamente
   * útil —arbitra la secuencia y sincroniza— y el restaurante puede operar
   * meses antes de facturar.
   */
  fiscal?: {
    sellador: Sellador;
    cola: ColaDeTimbrado;
    /** Sella y encola los comprobantes que la caja va generando. */
    facturador?: Facturador;
    /** Manda al SAT las cancelaciones pedidas y publica su desenlace. */
    cancelador?: Cancelador;
    nombrePac?: string;
  };
}

/** Eventos cuya emisión exige un permiso concreto, revalidado en el servidor. */
const PERMISO_POR_EVENTO: Partial<Record<string, Accion>> = {
  item_cancelado: "pos.item.cancelar_enviado",
  descuento_aplicado: "pos.descuento.aplicar",
  cortesia_otorgada: "pos.cortesia.otorgar",
  pago_registrado: "pos.cobro.registrar",
  caja_cerrada: "caja.corte.sellar",
  movimiento_efectivo: "caja.retiro.registrar",
  conteo_registrado: "inv.conteo.cerrar",
  usuario_creado: "admin.usuario.crear",
  usuario_actualizado: "admin.usuario.editar",
  usuario_eliminado: "admin.usuario.eliminar",
  usuario_desbloqueado: "admin.usuario.editar",
};

/** Estos catálogos los publica exclusivamente el proceso del Hub. */
const CATALOGOS_RESERVADOS = new Set([
  "licencia_estado",
  "actualizacion_estado",
  "modo_abierto",
]);

function catalogoValido(catalogo: Catalogo): boolean {
  return (
    typeof catalogo?.clave === "string" &&
    catalogo.clave.trim().length > 0 &&
    typeof catalogo.version === "number" &&
    Number.isSafeInteger(catalogo.version) &&
    catalogo.version >= 0 &&
    typeof catalogo.updated_at === "number" &&
    Number.isFinite(catalogo.updated_at)
  );
}

export class Hub {
  private sesiones = new Map<string, Sesion>();
  private catalogos = new Map<string, Catalogo>();
  private log: LogHub;
  /** Proyección autoritativa, cargada antes de abrir el canal de sincronización. */
  private identidad: EstadoIdentidad | null = null;
  private sucursalDeIdentidad: ID | null = null;
  private streamDeIdentidad: ID | null = null;

  constructor(private opciones: OpcionesHub) {
    this.log = opciones.log;
  }

  /**
   * Carga el único stream que da identidad a esta instancia del Hub.
   *
   * No usa `porTipo`: leer el stream evita seis recorridos completos del log
   * y deja la proyección lista para la validación síncrona de cada push.
   */
  cargarIdentidad(sucursalId: ID, eventos: readonly EventoBase[]): void {
    const stream = streamIdentidad(sucursalId);
    const identidad = eventos.filter(
      (evento): evento is EventoIdentidad =>
        evento.sucursal_id === sucursalId &&
        evento.stream_id === stream &&
        esEventoIdentidad(evento),
    );

    this.sucursalDeIdentidad = sucursalId;
    this.streamDeIdentidad = stream;
    this.identidad = proyectarIdentidad([], identidad);
    this.anotar(
      "info",
      `Identidad cargada: ${this.identidad.usuarios.length} usuario(s), ${identidad.length} evento(s).`,
    );
  }

  /** Usuario de la proyección actual, o del adaptador heredado si no se cargó una. */
  private usuarioDe(empleadoId: ID, identidad = this.identidad): Usuario | undefined {
    if (identidad) return identidad.usuarios.find((usuario) => usuario.id === empleadoId);
    return this.opciones.usuarioDe?.(empleadoId);
  }

  /** Aplica solo eventos de identidad válidos al estado provisional del lote. */
  private actualizarIdentidad(
    identidad: EstadoIdentidad | null,
    evento: EventoBase,
  ): EstadoIdentidad | null {
    if (
      !identidad ||
      !this.sucursalDeIdentidad ||
      !this.streamDeIdentidad ||
      evento.sucursal_id !== this.sucursalDeIdentidad ||
      evento.stream_id !== this.streamDeIdentidad ||
      !esEventoIdentidad(evento)
    ) {
      return identidad;
    }
    return aplicarEventoIdentidad(identidad, evento);
  }

  private anotar(nivel: "info" | "aviso" | "error", mensaje: string): void {
    this.opciones.registrar?.(nivel, mensaje);
  }

  get conectados(): number {
    return this.sesiones.size;
  }

  get seqActual(): number {
    return this.log.seqActual;
  }

  conectar(conexion: Conexion, esLocal = false): void {
    this.sesiones.set(conexion.id, {
      conexion,
      device_id: "",
      sucursal_id: "",
      saludado: false,
      esLocal,
    });
  }

  desconectar(conexionId: string): void {
    this.sesiones.delete(conexionId);
  }

  /** Punto de entrada de todo lo que llega por el canal. */
  recibir(conexionId: string, mensaje: MensajeCliente): void {
    const sesion = this.sesiones.get(conexionId);
    if (!sesion) return;

    switch (mensaje.tipo) {
      case "hola":
        this.saludar(sesion, mensaje);
        break;
      case "push":
        if (this.exigirSaludo(sesion)) this.ingerir(sesion, mensaje.eventos);
        break;
      case "pull":
        if (this.exigirSaludo(sesion)) {
          this.entregar(sesion, mensaje.desde_seq, mensaje.limite ?? 500);
        }
        break;
      case "catalogo":
        if (this.exigirSaludo(sesion)) this.recibirCatalogos(sesion, mensaje.catalogos);
        break;
      case "admin":
        if (this.exigirSaludo(sesion)) this.administrar(sesion, mensaje);
        break;
      case "fiscal":
        if (this.exigirSaludo(sesion)) this.atenderFiscal(sesion, mensaje);
        break;
      case "ping":
        sesion.conexion.enviar({ tipo: "pong", ts: Date.now() });
        break;
    }
  }

  // --- Administración de terminales ----------------------------------------------------

  /**
   * Lista y autoriza terminales.
   *
   * Quien pide tiene que estar YA autorizado: sin eso, una terminal recién
   * llegada podría autorizarse a sí misma y el permiso no valdría nada. Y como
   * todo esto viaja por el canal cifrado, ni siquiera se puede formular la
   * petición sin la clave del local.
   */
  private administrar(sesion: Sesion, mensaje: Extract<MensajeCliente, { tipo: "admin" }>): void {
    const quienPide = this.log.dispositivo(sesion.device_id);
    if (!quienPide?.aprobado) {
      sesion.conexion.enviar({
        tipo: "error",
        codigo: "permiso_denegado",
        mensaje: "Solo una terminal autorizada del local puede administrar las demás",
      });
      return;
    }

    if (mensaje.accion === "enlace_emparejamiento") {
      // Solo el Hub sabe sus direcciones en la red, así que él compone el
      // enlace. Va cifrado porque lleva la clave del local.
      sesion.conexion.enviar({ tipo: "enlace", enlaces: this.opciones.enlaces?.() ?? [] });
      return;
    }

    if (mensaje.accion === "autorizar") {
      if (!mensaje.device_id) return;
      this.log.aprobarDispositivo(mensaje.device_id);
      this.anotar("info", `Terminal ${mensaje.device_id} autorizada por ${sesion.device_id}`);
    }

    if (mensaje.accion === "revocar") {
      if (!mensaje.device_id) return;
      /*
       * Nadie puede revocarse a sí mismo.
       *
       * Sin esta regla, la única terminal autorizada de un local podría
       * quitarse el permiso por error y dejar al restaurante sin nadie capaz de
       * autorizar a nadie — habría que reinstalar el Hub para salir de ahí.
       */
      if (mensaje.device_id === sesion.device_id) {
        sesion.conexion.enviar({
          tipo: "error",
          codigo: "permiso_denegado",
          mensaje: "Una terminal no puede revocarse a sí misma",
        });
        return;
      }
      this.log.revocarDispositivo(mensaje.device_id);
      this.anotar("aviso", `Terminal ${mensaje.device_id} revocada por ${sesion.device_id}`);
      this.expulsar(mensaje.device_id);
    }

    sesion.conexion.enviar({
      tipo: "terminales",
      terminales: this.log.dispositivos().map((d) => ({
        device_id: d.device_id,
        nombre: d.nombre,
        aprobado: d.aprobado,
        visto_ts: d.visto_ts,
        ultimo_seq: d.ultimo_seq,
      })),
    });
  }

  // --- Catálogos (menú, plano, impresoras) --------------------------------------------

  /**
   * Guarda un catálogo solo si es más nuevo que el que ya tiene, y lo reparte.
   *
   * El Hub es la copia de referencia: una terminal que se enciende después
   * recibe la carta vigente del local, no la que traía de la última vez que
   * estuvo encendida.
   */
  private recibirCatalogos(origen: Sesion, catalogos: readonly Catalogo[]): void {
    const aceptados: Catalogo[] = [];

    for (const catalogo of catalogos) {
      if (!catalogoValido(catalogo)) continue;
      if (CATALOGOS_RESERVADOS.has(catalogo.clave)) {
        this.anotar(
          "aviso",
          `Terminal ${origen.device_id} intentó publicar el catálogo reservado ${catalogo.clave}.`,
        );
        continue;
      }

      const actual = this.catalogos.get(catalogo.clave) ?? null;
      if (!catalogoMasNuevo(catalogo, actual)) continue;

      this.catalogos.set(catalogo.clave, catalogo);
      this.opciones.guardarCatalogo?.(catalogo, "terminal");
      aceptados.push(catalogo);
    }

    if (aceptados.length === 0) return;
    this.anotar("info", `Catálogo actualizado: ${aceptados.map((c) => c.clave).join(", ")}`);

    for (const sesion of this.sesiones.values()) {
      if (sesion.conexion.id === origen.conexion.id || !sesion.saludado) continue;
      if (sesion.sucursal_id !== origen.sucursal_id) continue;
      sesion.conexion.enviar({ tipo: "catalogo", catalogos: aceptados });
    }
  }

  /** Carga los catálogos replicados por terminales, nunca los reservados. */
  cargarCatalogos(catalogos: readonly Catalogo[]): void {
    for (const catalogo of catalogos) {
      if (!catalogoValido(catalogo) || CATALOGOS_RESERVADOS.has(catalogo.clave)) continue;
      const actual = this.catalogos.get(catalogo.clave) ?? null;
      if (catalogoMasNuevo(catalogo, actual)) this.catalogos.set(catalogo.clave, catalogo);
    }
  }

  /** Carga el estado que el proceso del Hub publicó y persistió por separado. */
  cargarCatalogosInternos(catalogos: readonly Catalogo[]): void {
    for (const catalogo of catalogos) {
      if (!catalogoValido(catalogo) || !CATALOGOS_RESERVADOS.has(catalogo.clave)) continue;
      const actual = this.catalogos.get(catalogo.clave) ?? null;
      if (catalogoMasNuevo(catalogo, actual)) this.catalogos.set(catalogo.clave, catalogo);
    }
  }

  /** Los datos de un catálogo, para quien los necesite dentro del Hub. */
  catalogoDe(clave: string): unknown {
    return this.catalogos.get(clave)?.datos;
  }

  /**
   * Eventos que genera el propio Hub, sin terminal detrás.
   *
   * Hoy solo el kiosco de autoservicio. Va por un camino aparte de `ingerir`
   * porque ahí se revalidan los permisos del EMPLEADO que los mandó, y aquí no
   * hay empleado: los pidió el comensal desde una pantalla. Lo que sustituye a
   * esa comprobación es que el Hub compone los eventos él mismo —la tablet solo
   * dice qué y cuánto— así que no hay nada que un cliente pueda falsear.
   */
  recibirDelSistema(eventos: readonly EventoBase[]): void {
    const validos = eventos.filter((e) => eventoValido(e));
    if (validos.length === 0) return;

    const acks = this.log.ingerir(validos);
    if (acks.length === 0) return;
    for (const evento of validos) this.identidad = this.actualizarIdentidad(this.identidad, evento);
    this.opciones.alIngerir?.(validos);

    const menor = acks.reduce((n, a) => Math.min(n, a.seq), Infinity);
    const nuevos = this.log.desde(menor - 1, acks.length + 50);

    // A TODAS las terminales, sin excluir a nadie: no hay una que ya lo tenga.
    for (const sesion of this.sesiones.values()) {
      if (!sesion.saludado) continue;
      sesion.conexion.enviar({ tipo: "eventos", eventos: nuevos, hay_mas: false });
    }
  }

  /**
   * El Hub publica un catálogo por su cuenta, sin que venga de una terminal.
   *
   * Lo usan las cosas que SOLO el Hub sabe: el veredicto de la licencia y las
   * actualizaciones disponibles. Que viajen por el mismo canal que la carta y el
   * plano no es pereza — es lo que hace que una terminal que se enciende a media
   * tarde reciba el estado completo del local sin un mecanismo aparte.
   *
   * LO QUE SE PUBLIQUE AQUÍ LLEGA A TODAS LAS TERMINALES, incluidas las tablets
   * del salón. Nada secreto puede salir por este camino: la credencial de
   * soporte, por ejemplo, viaja aparte por `/licencia`, que solo contesta a la
   * propia caja.
   */
  publicarCatalogo(clave: string, datos: unknown): void {
    const previo = this.catalogos.get(clave);
    /*
     * Los catálogos reservados usan una versión anclada al reloj del Hub.
     * Así una licencia falsa de la vulnerabilidad anterior (por ejemplo,
     * versión 999999) no puede ganarle al primer estado auténtico tras migrar.
     */
    const base = CATALOGOS_RESERVADOS.has(clave)
      ? Math.max(previo?.version ?? 0, Date.now())
      : (previo?.version ?? 0);
    const version = base >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : base + 1;
    const catalogo: Catalogo = {
      clave,
      version,
      updated_at: Date.now(),
      datos,
    };
    this.catalogos.set(clave, catalogo);
    this.opciones.guardarCatalogo?.(catalogo, "hub");

    for (const sesion of this.sesiones.values()) {
      if (!sesion.saludado) continue;
      sesion.conexion.enviar({ tipo: "catalogo", catalogos: [catalogo] });
    }
  }

  /**
   * Corta las conexiones de una terminal revocada.
   *
   * Revocar sin expulsar no serviría de nada: la terminal ya está conectada y
   * seguiría escribiendo en el registro de ventas hasta que alguien la apagara.
   */
  private expulsar(deviceId: ID): void {
    for (const sesion of this.sesiones.values()) {
      if (sesion.device_id !== deviceId) continue;
      sesion.conexion.enviar({
        tipo: "error",
        codigo: "no_emparejado",
        mensaje: "Esta terminal dejó de estar autorizada en el local",
      });
      sesion.conexion.cerrar();
    }
  }

  /** Nadie escribe ni lee sin identificarse primero. */
  private exigirSaludo(sesion: Sesion): boolean {
    if (sesion.saludado) return true;
    sesion.conexion.enviar({
      tipo: "error",
      codigo: "no_emparejado",
      mensaje: "Preséntate con 'hola' antes de sincronizar",
    });
    return false;
  }

  private saludar(sesion: Sesion, mensaje: Extract<MensajeCliente, { tipo: "hola" }>): void {
    if (mensaje.v !== VERSION_PROTOCOLO) {
      sesion.conexion.enviar({
        tipo: "error",
        codigo: "version_incompatible",
        mensaje: `Este Hub habla la versión ${VERSION_PROTOCOLO} del protocolo y el dispositivo la ${mensaje.v}. Actualiza la terminal.`,
      });
      sesion.conexion.cerrar();
      return;
    }

    if (this.sucursalDeIdentidad && mensaje.sucursal_id !== this.sucursalDeIdentidad) {
      /*
       * UN HUB RECIÉN INSTALADO NO TIENE IDENTIDAD PROPIA TODAVÍA.
       *
       * Al arrancar sobre un registro en blanco, el Hub no tiene de dónde sacar
       * a qué sucursal pertenece, así que se inventa una (`suc-xxxxxxxx`) y la
       * fija. Pero las terminales se presentan con la suya, que es otra — y esta
       * comprobación las rechazaba TODAS, incluida la caja del propio equipo.
       *
       * El resultado era un local que no podía abrir nunca: sin terminales no
       * entra un solo evento, sin eventos el registro sigue en blanco, y la
       * identidad inventada no cambiaba jamás porque queda escrita en disco. La
       * caja mostraba «Modo isla» contra su propio Hub.
       *
       * Con el registro vacío no hay nada que proteger: nada del local se
       * atribuye todavía a ninguna sucursal. Así que la primera terminal que se
       * presenta es la que dice cuál es —la misma confianza en el primer uso con
       * la que se aprueba el primer dispositivo unas líneas más abajo— y a
       * partir de ahí queda fijada.
       */
      const enBlanco = this.log.seqActual === 0;
      const adoptada = enBlanco && this.opciones.adoptarSucursal?.(mensaje.sucursal_id) === true;

      if (!adoptada) {
        // Se anota: rechazar en silencio es lo que hacía este fallo invisible.
        this.anotar(
          "aviso",
          `Terminal rechazada: se presentó como ${mensaje.sucursal_id} y este Hub es ${this.sucursalDeIdentidad}.`,
        );
        sesion.conexion.enviar({
          tipo: "error",
          codigo: "sucursal_distinta",
          mensaje: "Este Hub pertenece a otra sucursal.",
        });
        sesion.conexion.cerrar();
        return;
      }

      this.anotar(
        "aviso",
        `Local sin identidad: se adopta la de su primera terminal, ${mensaje.sucursal_id}.`,
      );
      this.cargarIdentidad(mensaje.sucursal_id, []);
    }

    /*
     * Confianza en el primer uso.
     *
     * La primera terminal de un Hub recién instalado se aprueba sola: si no,
     * nadie podría aprobar a nadie —la pantalla que autoriza vive dentro de una
     * terminal que todavía no está autorizada—. A partir de ahí toda alta nueva
     * exige la firma de una terminal ya autorizada.
     *
     * Es la postura razonable mientras no exista el emparejamiento por
     * certificado de la etapa 12, y se registra en la bitácora del Hub para que
     * quede constancia de quién quedó como terminal de confianza.
     */
    let dispositivo = this.log.dispositivo(mensaje.device_id);
    if (!dispositivo) {
      dispositivo = this.log.registrarDispositivo(mensaje.device_id, "");
      if (this.log.dispositivos().length === 1 || sesion.esLocal) {
        this.log.aprobarDispositivo(mensaje.device_id);
        dispositivo = this.log.dispositivo(mensaje.device_id)!;
        this.anotar(
          "aviso",
          `Terminal local o primera terminal del local autorizada: ${mensaje.device_id}. Las siguientes por red requieren su aprobación.`,
        );
      }
    }

    if (this.opciones.exigirAprobacion && !dispositivo.aprobado) {
      this.anotar("aviso", `Dispositivo sin aprobar intentó sincronizar: ${mensaje.device_id}`);
      sesion.conexion.enviar({
        tipo: "error",
        codigo: "no_emparejado",
        mensaje: "Este dispositivo aún no está autorizado en el local. Apruébalo desde Administración.",
      });
      sesion.conexion.cerrar();
      return;
    }

    sesion.device_id = mensaje.device_id;
    sesion.sucursal_id = mensaje.sucursal_id;
    sesion.saludado = true;

    this.anotar("info", `Dispositivo conectado: ${mensaje.device_id} (desde seq ${mensaje.desde_seq})`);
    sesion.conexion.enviar({
      tipo: "bienvenida",
      v: VERSION_PROTOCOLO,
      hub_id: this.opciones.hub_id,
      seq_actual: this.log.seqActual,
      ts: Date.now(),
    });

    // La carta vigente del local va de inmediato: una terminal que se enciende
    // después no debe atender con los precios que traía de la última vez.
    if (this.catalogos.size > 0) {
      sesion.conexion.enviar({ tipo: "catalogo", catalogos: [...this.catalogos.values()] });
    }
  }

  /**
   * Acepta eventos, les asigna secuencia y los difunde.
   *
   * Los inválidos se descartan UNO POR UNO en vez de rechazar el lote: si una
   * terminal manda algo corrupto entre veinte comandas buenas, las diecinueve
   * restantes tienen que entrar igual.
   */
  private ingerir(sesion: Sesion, eventos: readonly unknown[]): void {
    const aceptados: EventoBase[] = [];
    /** Los que el log ya tenía. Se confirman, pero no se vuelven a difundir. */
    const repetidos: Ack[] = [];
    // El lote puede contener la semilla completa: cada evento siguiente debe
    // ver lo que los anteriores ya validaron, pero el estado real solo cambia
    // cuando SQLite confirma todo el lote.
    let identidadProvisional = this.identidad;

    for (const crudo of eventos) {
      if (!eventoValido(crudo)) {
        this.anotar("aviso", `Evento descartado por malformado desde ${sesion.device_id}`);
        sesion.conexion.enviar({
          tipo: "error",
          codigo: "evento_invalido",
          mensaje: "El evento no trae los campos mínimos y se descartó",
        });
        continue;
      }

      if (crudo.sucursal_id !== sesion.sucursal_id) {
        sesion.conexion.enviar({
          tipo: "error",
          codigo: "sucursal_distinta",
          mensaje: "El evento pertenece a otra sucursal",
          evento_id: crudo.id,
        });
        continue;
      }

      /*
       * LO QUE EL LOG YA TIENE NO SE VUELVE A JUZGAR.
       *
       * Un evento registrado se validó cuando entró, y el log es inmutable:
       * revalidarlo hoy solo puede producir un rechazo falso. No es teórico —lo
       * destapó el ensayo del viernes—. Cuando el Hub pierde historia (cambio de
       * disco, respaldo restaurado, Hub nuevo), la terminal reenvía su outbox
       * ENTERO confiando en que el Hub deduplica por id, y ahí dentro viaja el
       * alta del propietario: el arranque de confianza que solo vale mientras el
       * local no tiene usuarios. En un local ya estrenado nadie puede firmarla,
       * ni siquiera él mismo, así que el Hub la rechazaba, la terminal caía a
       * isla y la recuperación no terminaba nunca. Justo la pérdida de ventas
       * que ese reenvío existe para evitar.
       *
       * Aceptar aquí no relaja nada: para llegar a esta rama el evento tiene que
       * estar YA en el log, es decir, haber pasado la validación alguna vez.
       */
      const registrado = this.log.seqDe(crudo.id);
      if (registrado !== null) {
        repetidos.push({ id: crudo.id, seq: registrado });
        continue;
      }

      const veto = this.revalidarPermiso(crudo, identidadProvisional);
      if (veto) {
        this.anotar("aviso", `Permiso denegado en el Hub: ${crudo.tipo} de ${crudo.empleado_id}`);
        sesion.conexion.enviar({
          tipo: "error",
          codigo: "permiso_denegado",
          mensaje: veto,
          evento_id: crudo.id,
        });
        continue;
      }

      aceptados.push(crudo);
      identidadProvisional = this.actualizarIdentidad(identidadProvisional, crudo);
    }

    if (aceptados.length === 0 && repetidos.length === 0) return;

    const acks = this.log.ingerir(aceptados);
    if (acks.length > 0) this.identidad = identidadProvisional;
    if (acks.length > 0) this.opciones.alIngerir?.(aceptados);

    // Los repetidos van en el mismo acuse: sin él, la terminal los daría por no
    // entregados y los reenviaría en cada reconexión, para siempre.
    sesion.conexion.enviar({ tipo: "acks", acks: [...acks, ...repetidos] });

    const mayor = [...acks, ...repetidos].reduce((n, a) => Math.max(n, a.seq), 0);
    this.log.anotarAvance(sesion.device_id, mayor);

    // Solo lo nuevo. Difundir lo repetido despertaría a todas las terminales
    // para contarles algo que ya tienen.
    if (acks.length > 0) this.difundir(sesion, acks);

    /*
     * Facturar es reaccionar a un hecho ya guardado, no un paso del cobro.
     *
     * Va DESPUÉS del acuse y de la difusión a propósito: la caja no espera al
     * sellado para dar la cuenta por cobrada, y un fallo aquí no puede tumbar
     * la venta. El comprobante ya está en el log; si esto falla, el siguiente
     * barrido lo encuentra.
     */
    if (aceptados.some((e) => e.tipo === "cfdi_generado")) {
      const fiscal = this.opciones.fiscal;
      try {
        fiscal?.facturador?.procesar();
      } catch (error) {
        this.anotar("error", `Fallo al sellar comprobantes: ${String(error)}`);
      }

      /*
       * El timbrado sale en segundo plano y, al terminar, publica su resultado
       * en el registro del local para que la caja lo vea. No se espera: la
       * venta ya está cerrada y el comensal no tiene que aguardar al PAC.
       */
      if (fiscal?.cola) {
        void fiscal.cola
          .procesar()
          .then(() => fiscal.facturador?.publicarResultados())
          .catch((error: unknown) => {
            this.anotar("error", `Fallo al timbrar: ${String(error)}`);
          });
      }
    }

    // Una cancelación pedida se atiende igual: en segundo plano, sin frenar nada.
    if (aceptados.some((e) => e.tipo === "cfdi_cancelacion_solicitada")) {
      void this.opciones.fiscal?.cancelador?.procesar().catch((error: unknown) => {
        this.anotar("error", `Fallo al cancelar: ${String(error)}`);
      });
    }
  }

  /**
   * Vuelve a comprobar el permiso en el servidor.
   *
   * El cliente ya lo evaluó, pero eso es para la experiencia: un cliente
   * manipulado puede mandar lo que quiera. La proyección del stream de
   * identidad es la autoridad; si todavía no está cargada, se rechaza una
   * acción sensible en vez de aceptar a ciegas.
   */
  private revalidarPermiso(
    evento: EventoBase,
    identidad: EstadoIdentidad | null,
  ): string | null {
    if (esTipoEventoIdentidad(evento.tipo)) {
      if (!esEventoIdentidad(evento)) return "El evento de identidad no tiene una forma válida";
      return this.revalidarEventoIdentidad(evento, identidad);
    }

    const accion = PERMISO_POR_EVENTO[evento.tipo];
    if (!accion) return null;
    return this.revalidarAccion(evento, accion, identidad);
  }

  /** Las altas y cambios de usuarios no pueden crear una escalada circular. */
  private revalidarEventoIdentidad(
    evento: EventoIdentidad,
    identidad: EstadoIdentidad | null,
  ): string | null {
    if (!identidad || !this.sucursalDeIdentidad || !this.streamDeIdentidad) {
      return "El Hub todavía no cargó la identidad del local";
    }
    if (
      evento.sucursal_id !== this.sucursalDeIdentidad ||
      evento.stream_id !== this.streamDeIdentidad
    ) {
      return "El evento de identidad pertenece a otro stream del local";
    }

    /*
     * Arranque de confianza inicial. Antes de existir un usuario no hay quien
     * firme el primer usuario; se permite únicamente que ese mismo propietario
     * se declare a sí mismo. Queda en el event log y la primera terminal ya
     * pasó por la confianza en el primer uso del Hub.
     */
    if (
      evento.tipo === "usuario_creado" &&
      identidad.usuarios.length === 0 &&
      evento.rol_id === "propietario" &&
      evento.usuario_id === evento.empleado_id
    ) {
      return null;
    }

    const accion = PERMISO_POR_EVENTO[evento.tipo];
    if (!accion) return null;

    const permiso = this.revalidarAccion(evento, accion, identidad, false);
    if (permiso) return permiso;

    const actor = this.usuarioDe(evento.empleado_id, identidad);
    if (!actor) return `Empleado desconocido: ${evento.empleado_id}`;

    switch (evento.tipo) {
      case "usuario_creado": {
        if (!rolesAsignablesPor(actor).includes(evento.rol_id)) {
          return `${actor.nombre} no puede crear un usuario con el rol ${evento.rol_id}`;
        }
        const permisos = evento.permisos.length > 0
          ? evento.permisos
          : permisosDePlantilla(evento.rol_id);
        if (permisosNoOtorgables(actor, permisos).length > 0) {
          return `${actor.nombre} intentó otorgar permisos que no posee`;
        }
        return null;
      }

      case "usuario_actualizado": {
        const objetivo = this.usuarioDe(evento.usuario_id, identidad);
        if (!objetivo) return `Usuario a actualizar desconocido: ${evento.usuario_id}`;
        if (!puedeGestionarA(actor, objetivo)) {
          return `${actor.nombre} no puede administrar a ${objetivo.nombre}`;
        }
        if (
          evento.cambios.rol_id !== undefined &&
          !rolesAsignablesPor(actor).includes(evento.cambios.rol_id)
        ) {
          return `${actor.nombre} no puede asignar el rol ${evento.cambios.rol_id}`;
        }
        if (
          evento.cambios.permisos !== undefined &&
          permisosNoOtorgables(actor, evento.cambios.permisos).length > 0
        ) {
          return `${actor.nombre} intentó otorgar permisos que no posee`;
        }
        return null;
      }

      /*
       * Borrar a alguien de la plantilla se revalida aquí con más motivo que
       * nada: no se deshace. Una terminal manipulada que mandara este evento
       * dejaría al restaurante sin personal, y el `filter` de la proyección no
       * tiene vuelta atrás.
       */
      case "usuario_eliminado": {
        if (evento.eliminado_por !== actor.id) {
          return "La baja definitiva debe quedar firmada por quien la ejecuta";
        }
        const objetivo = this.usuarioDe(evento.usuario_id, identidad);
        if (!objetivo) return `Usuario a eliminar desconocido: ${evento.usuario_id}`;
        if (!puedeEliminarA(actor, objetivo)) {
          return `${actor.nombre} no puede eliminar a ${objetivo.nombre}`;
        }
        return null;
      }

      case "usuario_desbloqueado": {
        if (evento.desbloqueado_por !== actor.id) {
          return "El desbloqueo debe quedar firmado por quien lo ejecuta";
        }
        const objetivo = this.usuarioDe(evento.usuario_id, identidad);
        if (!objetivo) return `Usuario a desbloquear desconocido: ${evento.usuario_id}`;
        if (!puedeGestionarA(actor, objetivo)) {
          return `${actor.nombre} no puede desbloquear a ${objetivo.nombre}`;
        }
        return null;
      }

      default:
        return null;
    }
  }

  /** Revisa una acción contra la proyección autoritativa del Hub. */
  private revalidarAccion(
    evento: EventoBase,
    accion: Accion,
    identidad: EstadoIdentidad | null,
    permiteAutorizador = true,
  ): string | null {
    if (!identidad && !this.opciones.usuarioDe) {
      return "El Hub todavía no cargó la identidad del local";
    }

    const usuario = this.usuarioDe(evento.empleado_id, identidad);
    if (!usuario) return `Empleado desconocido: ${evento.empleado_id}`;
    if (!usuario.activo) return `El usuario ${usuario.nombre} está desactivado`;

    const autorizadorId = (evento as { autorizador_id?: unknown }).autorizador_id;
    if (autorizadorId !== undefined && (typeof autorizadorId !== "string" || autorizadorId.length === 0)) {
      return "El autorizador del evento no es válido";
    }
    if (autorizadorId) {
      if (!permiteAutorizador) return "Los cambios de usuarios no admiten una autorización delegada";
      const autorizador = this.usuarioDe(autorizadorId, identidad);
      if (!autorizador) return `Autorizador desconocido: ${autorizadorId}`;
      if (!puedeAutorizar(autorizador, accion)) {
        return `${autorizador.nombre} no puede autorizar "${accion}"`;
      }
      return null;
    }

    const veredicto = evaluar(usuario, accion);
    if (veredicto.resultado === "denegado") {
      return `${usuario.nombre} no tiene permiso para "${accion}"`;
    }
    if (veredicto.resultado === "requiere_autorizacion") {
      return `"${accion}" requiere la firma de un superior`;
    }
    return null;
  }

  // --- Facturación ----------------------------------------------------------------------

  /**
   * El CSD y la cola de timbrado.
   *
   * Dos comprobaciones, no una. Que la terminal esté autorizada dice que el
   * aparato pertenece al local; administrar el CSD exige además que la PERSONA
   * pueda, porque es entregar la firma fiscal del negocio. Consultar el estado
   * de la cola, en cambio, es información de operación y le basta con lo
   * primero: quien cobra tiene que poder ver si una factura salió.
   */
  private atenderFiscal(
    sesion: Sesion,
    mensaje: Extract<MensajeCliente, { tipo: "fiscal" }>,
  ): void {
    const fiscal = this.opciones.fiscal;
    if (!fiscal) {
      sesion.conexion.enviar({
        tipo: "error",
        codigo: "permiso_denegado",
        mensaje: "Esta caja no tiene la facturación configurada",
      });
      return;
    }

    if (!this.log.dispositivo(sesion.device_id)?.aprobado) {
      sesion.conexion.enviar({
        tipo: "error",
        codigo: "permiso_denegado",
        mensaje: "Solo una terminal autorizada del local puede consultar la facturación",
      });
      return;
    }

    const modifica =
      mensaje.accion === "instalar_csd" ||
      mensaje.accion === "desinstalar_csd" ||
      mensaje.accion === "reintentar";

    if (modifica) {
      const negativa = this.puedeAdministrarCsd(mensaje.empleado_id);
      if (negativa) {
        this.anotar("aviso", `Intento de administrar el CSD sin permiso: ${negativa}`);
        sesion.conexion.enviar({ tipo: "error", codigo: "permiso_denegado", mensaje: negativa });
        return;
      }
    }

    let problema: string | undefined;

    switch (mensaje.accion) {
      case "instalar_csd": {
        if (!mensaje.cer || !mensaje.key || !mensaje.contrasena || !mensaje.rfc_emisor) {
          problema = "Faltan el certificado, la llave, la contraseña o el RFC del emisor.";
          break;
        }
        const resultado = fiscal.sellador.instalar(
          Buffer.from(mensaje.cer, "base64"),
          Buffer.from(mensaje.key, "base64"),
          mensaje.contrasena,
          mensaje.rfc_emisor,
        );
        if (resultado.ok) {
          // Sin la contraseña ni nada que se le parezca: la bitácora se lee.
          this.anotar("info", `CSD instalado para el RFC ${mensaje.rfc_emisor}.`);

          /*
           * Un restaurante puede llevar semanas operando sin CSD, con los
           * comprobantes acumulados en el log. Este es el momento de sellarlos
           * todos: si no se hiciera aquí, esas facturas esperarían al siguiente
           * cobro para salir, y podrían pasar del plazo del SAT.
           */
          const barrido = fiscal.facturador?.procesar(1000);
          if (barrido && barrido.encolados > 0) {
            this.anotar(
              "info",
              `Se sellaron ${barrido.encolados} comprobante(s) que esperaban un certificado.`,
            );
          }
          /*
           * El timbrado arranca en segundo plano, sin esperarlo.
           *
           * Quien acaba de subir su certificado no tiene por qué aguardar una
           * ida y vuelta a internet para saber si quedó bien: el sellado ya
           * ocurrió y es local. Si el PAC tarda o falla, la cola lo maneja.
           */
          void fiscal.cola
            .procesar()
            .then(() => fiscal.facturador?.publicarResultados())
            .catch((error: unknown) => {
              this.anotar("error", `Fallo al timbrar tras instalar el CSD: ${String(error)}`);
            });
        } else {
          problema = resultado.problema;
        }
        break;
      }

      case "desinstalar_csd":
        fiscal.sellador.desinstalar();
        this.anotar("aviso", "Se retiró el CSD de esta caja. No se podrá facturar hasta cargar otro.");
        break;

      case "reintentar":
        if (mensaje.orden_id) fiscal.cola.reintentar(mensaje.orden_id);
        // Se intenta enseguida —quien reintenta a mano acaba de arreglar la
        // causa— pero sin bloquear la respuesta.
        void fiscal.cola
          .procesar()
          .then(() => fiscal.facturador?.publicarResultados())
          .catch((error: unknown) => {
            this.anotar("error", `Fallo al reintentar el timbrado: ${String(error)}`);
          });
        break;

      case "estado":
      case "listar_cola":
        break;
    }

    const csd = fiscal.sellador.estado();
    sesion.conexion.enviar({
      tipo: "fiscal",
      problema,
      estado: {
        csd_cargado: csd.cargado,
        rfc: csd.rfc,
        no_certificado: csd.no_certificado,
        valido_hasta: csd.valido_hasta,
        dias_restantes: csd.dias_restantes,
        pac: fiscal.nombrePac ?? null,
        cola: fiscal.cola.resumen(),
      },
      cola: mensaje.accion === "listar_cola" ? fiscal.cola.listar() : undefined,
    });
  }

  /** `null` si puede administrar el CSD; si no, por qué no. */
  private puedeAdministrarCsd(empleadoId: ID): string | null {
    /*
     * Sin una proyección (o el adaptador heredado) se DENIEGA: no saber quién
     * pregunta jamás puede equivaler a entregar la firma fiscal.
     */
    if (!this.identidad && !this.opciones.usuarioDe) {
      return "Esta caja todavía no puede verificar quién eres. Administra el CSD desde la caja principal.";
    }

    const usuario = this.usuarioDe(empleadoId);
    if (!usuario) return "Usuario desconocido";
    if (!usuario.activo) return `El usuario ${usuario.nombre} está desactivado`;

    const veredicto = evaluar(usuario, "fin.csd.administrar");
    if (veredicto.resultado === "permitido") return null;

    return `${usuario.nombre} no puede administrar el Certificado de Sello Digital`;
  }

  /** Reparte lo recién aceptado a las demás terminales de la misma sucursal. */
  private difundir(origen: Sesion, acks: readonly { id: string; seq: number }[]): void {
    if (acks.length === 0) return;
    const menor = acks.reduce((n, a) => Math.min(n, a.seq), Infinity);
    const nuevos = this.log.desde(menor - 1, acks.length + 50);

    for (const sesion of this.sesiones.values()) {
      if (sesion.conexion.id === origen.conexion.id || !sesion.saludado) continue;
      if (sesion.sucursal_id !== origen.sucursal_id) continue;
      const suyos = nuevos.filter((e) => e.device_id !== sesion.device_id);
      if (suyos.length > 0) {
        sesion.conexion.enviar({ tipo: "eventos", eventos: suyos, hay_mas: false });
      }
    }
  }

  /**
   * Mete eventos que nacieron EN EL HUB y los reparte a todas las terminales.
   *
   * Los usa el portal del comensal: su opinión y su solicitud de reserva no
   * vienen de ninguna terminal del local —vienen de un teléfono ajeno— así que
   * no hay una sesión de la que excluir en la difusión. Van a todas, incluida
   * la caja, que es donde el mesero tiene que enterarse.
   */
  inyectar(eventos: readonly EventoBase[]): void {
    const validos = eventos.filter(eventoValido);
    if (validos.length === 0) return;

    const acks = this.log.ingerir(validos);
    if (acks.length === 0) return;
    for (const evento of validos) this.identidad = this.actualizarIdentidad(this.identidad, evento);
    this.opciones.alIngerir?.(validos);

    const menor = acks.reduce((n, a) => Math.min(n, a.seq), Infinity);
    const nuevos = this.log.desde(menor - 1, acks.length + 50);

    for (const sesion of this.sesiones.values()) {
      if (!sesion.saludado) continue;
      sesion.conexion.enviar({ tipo: "eventos", eventos: nuevos, hay_mas: false });
    }
  }

  /** Responde a un `pull`: lo que le falta al dispositivo, por lotes. */
  private entregar(sesion: Sesion, desdeSeq: number, limite: number): void {
    const tope = Math.min(Math.max(limite, 1), 1000);
    const eventos = this.log.desde(desdeSeq, tope);
    const hayMas = eventos.length === tope;

    sesion.conexion.enviar({ tipo: "eventos", eventos, hay_mas: hayMas });

    if (eventos.length > 0) {
      this.log.anotarAvance(sesion.device_id, eventos[eventos.length - 1]!.seq);
    }
  }
}
