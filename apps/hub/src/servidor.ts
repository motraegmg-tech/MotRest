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
import { evaluar, type Accion, type Usuario } from "@motrest/dominio";
import type { EventoBase, ID } from "@motrest/dominio";
import {
  VERSION_PROTOCOLO,
  catalogoMasNuevo,
  eventoValido,
  type Catalogo,
  type MensajeCliente,
  type MensajeHub,
} from "@motrest/protocolo-sync";
import type { LogHub } from "@motrest/protocolo-sync/sqlite";

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
  /** Resuelve un empleado para revalidar permisos. */
  usuarioDe?: (empleadoId: ID) => Usuario | undefined;
  /** Persiste un catálogo aceptado, para que sobreviva al reinicio del Hub. */
  guardarCatalogo?: (catalogo: Catalogo) => void;
  /** Enlaces de emparejamiento, uno por dirección del Hub en la red. */
  enlaces?: () => { etiqueta: string; url: string }[];
  registrar?: (nivel: "info" | "aviso" | "error", mensaje: string) => void;
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
};

export class Hub {
  private sesiones = new Map<string, Sesion>();
  private catalogos = new Map<string, Catalogo>();
  private log: LogHub;

  constructor(private opciones: OpcionesHub) {
    this.log = opciones.log;
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

  conectar(conexion: Conexion): void {
    this.sesiones.set(conexion.id, {
      conexion,
      device_id: "",
      sucursal_id: "",
      saludado: false,
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
      if (typeof catalogo?.clave !== "string" || typeof catalogo.version !== "number") continue;

      const actual = this.catalogos.get(catalogo.clave) ?? null;
      if (!catalogoMasNuevo(catalogo, actual)) continue;

      this.catalogos.set(catalogo.clave, catalogo);
      this.opciones.guardarCatalogo?.(catalogo);
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

  /** Carga los catálogos guardados al arrancar el Hub. */
  cargarCatalogos(catalogos: readonly Catalogo[]): void {
    for (const catalogo of catalogos) this.catalogos.set(catalogo.clave, catalogo);
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
      if (this.log.dispositivos().length === 1) {
        this.log.aprobarDispositivo(mensaje.device_id);
        dispositivo = this.log.dispositivo(mensaje.device_id)!;
        this.anotar(
          "aviso",
          `Primera terminal del local: ${mensaje.device_id} queda autorizada. Las siguientes requieren su aprobación.`,
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

      const veto = this.revalidarPermiso(crudo);
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
    }

    if (aceptados.length === 0) return;

    const acks = this.log.ingerir(aceptados);
    sesion.conexion.enviar({ tipo: "acks", acks });

    const mayor = acks.reduce((n, a) => Math.max(n, a.seq), 0);
    this.log.anotarAvance(sesion.device_id, mayor);

    this.difundir(sesion, acks);
  }

  /**
   * Vuelve a comprobar el permiso en el servidor.
   *
   * El cliente ya lo evaluó, pero eso es para la experiencia: un cliente
   * manipulado puede mandar lo que quiera. Sin `usuarioDe` el Hub todavía no
   * conoce la plantilla de usuarios y solo arbitra la secuencia — se documenta
   * como pendiente en vez de fingir que valida.
   */
  private revalidarPermiso(evento: EventoBase): string | null {
    const accion = PERMISO_POR_EVENTO[evento.tipo];
    if (!accion || !this.opciones.usuarioDe) return null;

    const usuario = this.opciones.usuarioDe(evento.empleado_id);
    if (!usuario) return `Empleado desconocido: ${evento.empleado_id}`;
    if (!usuario.activo) return `El usuario ${usuario.nombre} está desactivado`;

    // Un evento con autorizador ya pasó por la firma de un superior en el
    // dispositivo; lo que se comprueba aquí es que el autorizador exista y pueda.
    const autorizadorId = (evento as unknown as { autorizador_id?: ID }).autorizador_id;
    if (autorizadorId) {
      const autorizador = this.opciones.usuarioDe(autorizadorId);
      if (!autorizador) return `Autorizador desconocido: ${autorizadorId}`;
      const v = evaluar(autorizador, accion);
      if (v.resultado === "denegado") {
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
