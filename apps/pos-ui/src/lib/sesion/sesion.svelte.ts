/**
 * Store de sesión, identidad y permisos.
 *
 * Todo lo relevante se emite como EVENTOS al mismo log que la operación, porque
 * el TRD §10 es explícito: el event log ES la bitácora. Quién entró, quién
 * autorizó qué, en qué dispositivo y a qué hora.
 */
import {
  FabricaEventos,
  MAX_INTENTOS,
  ROLES,
  crearCredencial,
  etiquetaAccion,
  evaluar,
  permisosDePlantilla,
  permisosNoOtorgables,
  politicaIntentos,
  proyectarIdentidad,
  puedeAutorizar,
  puedeEliminarA,
  puedeGestionarA,
  puedeOtorgar,
  puedeVer,
  rangoDe,
  rolesAsignablesPor,
  streamIdentidad,
  uuidv7,
  generarCodigoRescate,
  normalizarCodigo,
  cuentaResponsableDeLicencia,
  credencialDeSoporte,
  esSoporte,
  localYaEstrenado,
  requiereAltaDeResponsable,
  usuarioResponsable,
  usuarioSoporte,
  usuariosVisibles,
  PUESTO_RESPONSABLE,
  USUARIO_RESPONSABLE_ID,
  USUARIO_SOPORTE_ID,
  validarSecreto,
  verificarCredencial,
  type Accion,
  type ContextoAccion,
  type Credencial,
  type EstadoIntentos,
  type EventoIdentidad,
  type ID,
  type Licencia,
  type Permiso,
  type RolId,
  type TipoCredencial,
  type Usuario,
  type Veredicto,
} from "@motrest/dominio";
import { CLAVES, type Almacen } from "@motrest/protocolo-sync";

/**
 * Dueño ficticio del hash del código de rescate.
 *
 * El código no pertenece a una persona sino al LOCAL: si se atara al id del
 * propietario, cambiar de dueño invalidaría la llave de repuesto del negocio.
 */
const RESCATE_ID = "local:rescate";
import { asistencia } from "../asistencia.svelte";
import { esLaCaja } from "../entorno";
import { SUCURSAL_ID, obtenerDeviceId } from "../presentacion";
import { USUARIOS_SEMILLA, USUARIO_POR_DEFECTO } from "./usuarios";

/**
 * Dónde se apunta quién tiene la sesión abierta.
 *
 * `sessionStorage` y no el almacén del dispositivo, y esa es toda la diferencia
 * entre «recargar la pantalla no me echa fuera» y «cualquiera que encienda la
 * caja entra como el dueño». Sobrevive a un F5 y a que el Hub reinicie la vista;
 * NO sobrevive a cerrar y volver a abrir la aplicación, que es justo cuando hay
 * que volver a preguntar quién está frente a la caja.
 */
const LLAVE_SESION = "motrest.sesion_activa";

export interface Resultado {
  ok: boolean;
  error?: string;
}

const STREAM = streamIdentidad(SUCURSAL_ID);

class Sesion {
  usuarios = $state<Usuario[]>(USUARIOS_SEMILLA.map((s) => ({ ...s.usuario })));
  /*
   * AQUÍ HUBO UN USUARIO FANTASMA, y hay que dejar dicho por qué se fue.
   *
   * Mientras faltaba dar de alta al responsable, esto devolvía un «Configuración
   * Inicial» con TODOS los permisos de propietario. Resolvía un problema real
   * —el alta se pintaba encima de la aplicación, que sin sesión mostraba «Sin
   * acceso» detrás— pero al precio de que cualquiera que abriera la caja en ese
   * momento tuviera el negocio entero: finanzas, inteligencia, usuarios.
   *
   * El problema era de dónde se pintaba el alta, no de quién estaba en sesión.
   * Ahora el alta se muestra SOLA (ver `App.svelte`) y nadie opera sin
   * identificarse, que es la regla de la que cuelga toda la bitácora.
   */
  usuarioActual = $state<Usuario | null>(null);

  /**
   * ¿Este equipo es el que puede dar de alta al responsable del restaurante?
   *
   * Lo es la caja —la terminal a la que el propio Hub le sirve la pantalla— y lo
   * es una terminal suelta que todavía no está enlazada con ningún local. NO lo
   * es una tablet emparejada: ahí el personal llega por sincronización, y ofrecer
   * un alta de propietario en el salón crearía un segundo dueño del negocio en la
   * mano de quien tomara la tablet. Lo fija el arranque, que es quien sabe con
   * qué Hub trabaja esta terminal.
   */
  private terminalPrincipal = $state(false);

  /** Bitácora de identidad (se fusiona con la operativa en la vista de auditoría). */
  eventos = $state.raw<EventoIdentidad[]>([]);

  /** Credenciales por usuario. No es estado reactivo: no se muestra jamás. */
  private credenciales = new Map<ID, Credencial[]>();
  /** Qué provisión firmada ya se aplicó al responsable de este local. */
  private provisionesResponsable = $state<Record<ID, { provision_id: string; debe_cambiar_credencial: boolean }>>({});
  /** Hash del código de rescate. El código en claro nunca se guarda. */
  private rescate = $state.raw<Credencial | null>(null);
  /**
   * El código recién generado, para enseñarlo UNA vez.
   *
   * Vive solo en memoria y se borra al confirmarse: si se guardara, dejaría en
   * el disco justo lo que este mecanismo protege.
   */
  codigoRescateNuevo = $state<string | null>(null);

  /** Intentos fallidos por usuario. Reactivo: la UI muestra los restantes. */
  private intentos = $state<Record<ID, EstadoIntentos>>({});
  /** Vacío mientras los secretos se guarden bien. Lo lee la pantalla. */
  errorAlGuardar = $state("");
  /** Qué provisión trae la licencia vigente, por usuario. No se persiste. */
  private provisionVigente: Record<ID, string> = {};
  /** Intentos fallidos del diálogo de autorización (no se sabe de quién es el PIN). */
  private intentosAutorizacion = $state<EstadoIntentos>({ fallos: 0, ultimo_fallo_ts: 0 });

  private fabrica = new FabricaEventos<EventoIdentidad>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  /** Almacén local. Mientras sea null, todo vive solo en memoria. */
  private almacen: Almacen | null = null;

  constructor() {
    this.sembrarCredenciales();
  }

  private sembrarCredenciales(): void {
    // En producción la semilla está VACÍA: la primera credencial del local la
    // crea el responsable en `crearResponsableInicial`.
    for (const sembrado of USUARIOS_SEMILLA) {
      if (!sembrado.credencial) continue;
      const lista: Credencial[] = [sembrado.credencial];
      if (sembrado.pin) lista.push(sembrado.pin);
      this.credenciales.set(sembrado.usuario.id, lista);
    }
  }

  // --- Persistencia -------------------------------------------------------------

  /**
   * Rehidrata identidad desde el event log y el almacén local:
   *  - usuarios y bloqueos, proyectados desde los eventos sobre la semilla;
   *  - credenciales e intentos, que NO van al log porque son secretos;
   *  - la sesión que estaba abierta antes de recargar.
   */
  async hidratar(eventos: readonly EventoIdentidad[], almacen: Almacen): Promise<void> {
    this.eventos = [...eventos];

    const proyeccion = proyectarIdentidad(
      USUARIOS_SEMILLA.map((s) => s.usuario),
      eventos,
    );
    this.usuarios = proyeccion.usuarios;

    const guardadas = await almacen.estado.cargar<Record<ID, Credencial[]>>(CLAVES.credenciales);
    if (guardadas) {
      this.credenciales = new Map(Object.entries(guardadas));
    }
    /* El soporte se deriva de la licencia actual; nunca sobrevive por su cuenta. */
    this.credenciales.delete(USUARIO_SOPORTE_ID);

    const provisiones = await almacen.estado.cargar<
      Record<ID, { provision_id: string; debe_cambiar_credencial: boolean }>
    >(CLAVES.provisionesResponsable);
    if (provisiones) this.provisionesResponsable = provisiones;

    this.rescate = (await almacen.estado.cargar<Credencial>(CLAVES.rescate)) ?? null;
    /*
     * El código de rescate NO se emite solo.
     *
     * Se emitía al arrancar y la pantalla lo enseñaba una vez. Salía en cada
     * instalación y estorbaba más de lo que ayudaba, así que ahora se pide a
     * mano desde Administración → Usuarios cuando se quiere tener uno.
     */

    const intentos = await almacen.estado.cargar<Record<ID, EstadoIntentos>>(CLAVES.intentos);
    if (intentos) this.intentos = intentos;

    // Los bloqueos del log mandan sobre el contador en disco.
    for (const id of proyeccion.bloqueados) {
      if ((this.intentos[id]?.fallos ?? 0) < MAX_INTENTOS) {
        this.intentos = {
          ...this.intentos,
          [id]: { fallos: MAX_INTENTOS, ultimo_fallo_ts: Date.now() },
        };
      }
    }

    /*
     * Las cuentas que llegan con la licencia de MOTRAE.
     *
     * Va DESPUÉS de cargar las credenciales del disco y ANTES de restaurar la
     * sesión: si fuera antes, las credenciales guardadas lo sobrescribirían; si
     * fuera después de restaurar, un soporte con sesión previa no se
     * reconocería.
     *
     * Se arma en memoria a partir de la licencia y NO se persiste, ni el usuario
     * ni su credencial. Es deliberado: así el acceso existe exactamente mientras
     * exista una licencia firmada que lo diga. Quitarle la licencia a un local
     * le quita también el acceso de MOTRAE, sin que quede un usuario huérfano
     * con todos los permisos en su disco.
     */
    await this.montarCuentasDeLicencia();

    /*
     * Sesión abierta en ESTA ejecución de la aplicación.
     *
     * Antes se leía del almacén del dispositivo, y eso hacía que abrir MotRest
     * dejara dentro al último que entró: la caja amanecía con la sesión del dueño
     * puesta desde la noche anterior. Ahora solo sobrevive a recargar la pantalla
     * (`sessionStorage`), así que cada vez que el software se abre pide el PIN
     * contra la lista de personal. Un turno nuevo se identifica.
     */
    const activa = this.sesionDeEstaEjecucion();
    const usuario = activa ? this.usuarioDe(activa) : undefined;
    if (usuario?.activo && !this.estaBloqueado(usuario.id)) {
      // Se restaura la sesión sin volver a emitir un inicio: no hubo uno nuevo.
      this.usuarioActual = usuario;
      this.fabrica.actualizarContexto({ empleado_id: usuario.id });
    } else if (USUARIO_POR_DEFECTO) {
      // Solo en demo hay un usuario por defecto. En producción esto es null y la
      // app queda SIN sesión: la pantalla de acceso pide identificarse.
      const inicial = this.usuarioDe(USUARIO_POR_DEFECTO);
      if (inicial) this.establecerSesion(inicial, false);
    }
  }

  /** A partir de aquí cada evento y cada secreto se guardan en el dispositivo. */
  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
    void this.guardarSecretos();
    void this.olvidarSesionEnDisco(almacen);
    this.guardarSesionActiva();
  }

  /**
   * Le dice al store si este equipo puede dar de alta al responsable.
   *
   * Lo llama el arranque en cuanto sabe con qué Hub trabaja la terminal. Va por
   * aquí y no leyendo `sync` desde este archivo para no atar la identidad al
   * enlace de red: quién puede entrar no debería depender de un store que existe
   * para sincronizar comandas.
   */
  marcarTerminalPrincipal(esPrincipal: boolean): void {
    this.terminalPrincipal = esPrincipal;
  }

  /**
   * Escribe la semilla de identidad en el mismo event log que verá el Hub.
   *
   * La proyección local ya parte de esta semilla para poder mostrar el primer
   * acceso, pero el Hub no puede confiar en una constante que solo vive en la
   * interfaz. El propietario se emite primero y firma el resto del lote.
   *
   * **En producción no hay semilla y esto no hace nada**: el primer usuario del
   * restaurante lo escribe el alta del responsable (`crearResponsableInicial`),
   * con el nombre que el local dio y firmado por él mismo.
   */
  async sembrarUsuariosIniciales(almacen: Almacen): Promise<void> {
    if (USUARIOS_SEMILLA.length === 0) return;
    if (this.eventos.some((evento) => evento.tipo === "usuario_creado")) return;

    const propietario = USUARIOS_SEMILLA.find((sembrado) => sembrado.usuario.rol_id === "propietario")
      ?.usuario;
    if (!propietario) throw new Error("La semilla de identidad no tiene propietario");

    const empleadoAnterior = this.fabrica.empleadoActual;
    this.fabrica.actualizarContexto({ empleado_id: propietario.id });
    try {
      const eventos = USUARIOS_SEMILLA.map(({ usuario }) =>
        this.fabrica.crear("usuario_creado", STREAM, {
          usuario_id: usuario.id,
          nombre: usuario.nombre,
          puesto: usuario.puesto,
          rol_id: usuario.rol_id,
          permisos: usuario.permisos.map((permiso) => ({ ...permiso })),
        }),
      );
      await almacen.eventos.anexar(eventos);
      this.eventos = [...this.eventos, ...eventos];
    } finally {
      this.fabrica.actualizarContexto({ empleado_id: empleadoAnterior });
    }
  }

  private async guardarSecretos(): Promise<void> {
    if (!this.almacen) return;
    try {
      await this.almacen.estado.guardar(
        CLAVES.credenciales,
        Object.fromEntries(
          [...this.credenciales].filter(([usuarioId]) => usuarioId !== USUARIO_SOPORTE_ID),
        ),
      );
      await this.almacen.estado.guardar(CLAVES.intentos, this.intentos);
      await this.almacen.estado.guardar(CLAVES.provisionesResponsable, this.provisionesResponsable);
      if (this.rescate) await this.almacen.estado.guardar(CLAVES.rescate, this.rescate);
    } catch (causa) {
      /*
       * ESTE FALLO NO PUEDE SER SILENCIOSO.
       *
       * Era un `console.error` en una aplicación que nadie mira con la consola
       * abierta, y detrás se escondía que el PIN del responsable no se estaba
       * guardando: el restaurante quedaba fuera de su sistema al reiniciar y no
       * había ni un rastro visible. Se sube a la superficie para que la próxima
       * vez se vea en la pantalla y no haga falta un depurador remoto.
       */
      this.errorAlGuardar =
        "No se pudieron guardar las credenciales en este equipo. " +
        "Avise a MOTRAE: el acceso podría perderse al cerrar la aplicación.";
      console.error("No se pudieron guardar las credenciales", causa);
    }
  }

  /** Quién tenía la sesión abierta en esta misma ejecución de la aplicación. */
  private sesionDeEstaEjecucion(): ID | null {
    try {
      return globalThis.sessionStorage?.getItem(LLAVE_SESION) ?? null;
    } catch {
      // Sin sessionStorage no se recuerda nada y se vuelve a pedir el PIN. Es el
      // lado seguro del fallo.
      return null;
    }
  }

  private guardarSesionActiva(): void {
    try {
      const almacenaje = globalThis.sessionStorage;
      if (!almacenaje) return;
      if (this.usuarioActual) {
        almacenaje.setItem(LLAVE_SESION, this.usuarioActual.id);
      } else {
        almacenaje.removeItem(LLAVE_SESION);
      }
    } catch (causa) {
      console.error("No se pudo recordar la sesión de esta ejecución", causa);
    }
  }

  /**
   * Borra la sesión que las versiones anteriores dejaban en el disco.
   *
   * Sin esto, una caja actualizada seguiría teniendo ahí escrito el id del último
   * que entró. Ya nadie lo lee, pero un secreto operativo que sobra en el disco se
   * quita, no se ignora.
   */
  private async olvidarSesionEnDisco(almacen: Almacen): Promise<void> {
    try {
      await almacen.estado.eliminar(CLAVES.sesion);
    } catch {
      // Que no se pueda limpiar no puede impedir que la caja abra.
    }
  }

  // --- Emisión de eventos --------------------------------------------------------

  private emitir<T extends EventoIdentidad["tipo"]>(
    tipo: T,
    datos: Omit<Extract<EventoIdentidad, { tipo: T }>, keyof import("@motrest/dominio").SobreEvento | "tipo">,
  ): void {
    const evento = this.fabrica.crear(tipo, STREAM, datos);
    this.eventos = [...this.eventos, evento];

    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar el evento de identidad", causa);
    });
  }

  private establecerSesion(usuario: Usuario, cambioRapido: boolean): void {
    this.usuarioActual = usuario;
    this.fabrica.actualizarContexto({ empleado_id: usuario.id });
    this.emitir("sesion_iniciada", {
      usuario_id: usuario.id,
      rol_id: usuario.rol_id,
      cambio_rapido: cambioRapido,
    });
    this.guardarSesionActiva();
  }

  /**
   * Alguien acaba de identificarse de verdad: se le abre la sesión Y SE LE
   * CHECA LA ENTRADA.
   *
   * ## Abrir sesión es llegar a trabajar
   *
   * El checador supone una tablet en la puerta, pero en un local pequeño no la
   * hay: la gente llega, abre su usuario en la caja y se pone a comandar. La
   * prenómina del sábado salía en ceros porque nadie iba a marcar su hora en
   * una pantalla aparte. La checada solo se registra la PRIMERA vez de la
   * jornada y nunca si ya está dentro (ver `entradaPorAcceso`), así que ir y
   * venir entre usuarios durante el turno no infla las horas de nadie.
   *
   * ## Por qué aquí y no en `establecerSesion`
   *
   * Porque aquello también se usa al rehidratar en modo demostración, cuando el
   * checador todavía no ha cargado su log ni tiene almacén: la checada se
   * emitiría contra una lista vacía y se perdería al hidratar. Aquí solo se
   * llega por un inicio de sesión real, con la aplicación ya en marcha.
   *
   * El soporte de MOTRAE queda fuera: no es personal del restaurante y su
   * jornada no se le paga a nadie.
   */
  private abrirSesionDe(usuario: Usuario, cambioRapido: boolean): void {
    this.establecerSesion(usuario, cambioRapido);
    if (!esSoporte(usuario)) asistencia.entradaPorAcceso(usuario.id);
  }

  // --- Consultas ------------------------------------------------------------------

  get autenticado(): boolean {
    return this.usuarioActual !== null;
  }

  get debeCambiarCredencial(): boolean {
    return this.usuarioActual?.debe_cambiar_credencial === true;
  }

  // --- El primer arranque del restaurante -------------------------------------------

  /** ¿Hay algún hash guardado para este usuario? */
  private tieneCredencial(id: ID): boolean {
    return (this.credenciales.get(id) ?? []).length > 0;
  }

  /**
   * ¿El software tiene que abrir pidiendo el alta del responsable?
   *
   * Solo cuando las dos cosas se cumplen: que este equipo sea el que puede darla
   * (la caja, o una terminal todavía sin local) y que en el local no haya ni una
   * cuenta usable. Ver `requiereAltaDeResponsable` en el dominio para qué cuenta
   * como usable y por qué la cuenta que MOTRAE preparó y nadie estrenó no lo es.
   */
  get requiereAltaInicial(): boolean {
    if (!this.terminalPrincipal) return false;
    return requiereAltaDeResponsable(
      this.usuariosDelLocal,
      (id) => this.tieneCredencial(id),
      localYaEstrenado(this.eventos),
    );
  }

  /**
   * ¿Este local ya pasó por su puesta en marcha alguna vez?
   *
   * Lo consulta la pantalla de acceso para explicar por qué se pide un PIN que
   * quizá el usuario no eligió: cuando MOTRAE repone el acceso del responsable,
   * el PIN vigente es el que Central entregó, no el que el local recordaba.
   */
  get yaEstrenado(): boolean {
    return localYaEstrenado(this.eventos);
  }

  /** La cuenta de propietario que este local ya tiene, venga de donde venga. */
  private get responsablePrevio(): Usuario | undefined {
    return this.usuariosDelLocal.find((u) => u.rol_id === "propietario" && u.activo);
  }

  /**
   * El responsable que MOTRAE preparó dentro de la licencia y nadie ha estrenado.
   *
   * Si lo hay, el alta **no pide el nombre**: lo enseña y solo pide el PIN, porque
   * el nombre lo manda el perfil firmado y volver a escribirlo aquí solo serviría
   * para que la licencia lo sobrescribiera en el siguiente arranque.
   *
   * Se distingue por tener PROVISIÓN, no por ser propietario. La diferencia
   * importa en una caja que se actualiza desde una versión anterior: ahí puede
   * haber un propietario heredado —el viejo «Gonzalo DJA» sembrado, sin
   * credencial que sirva— y a ese SÍ hay que dejarle poner su nombre real, que es
   * justo lo que esta pantalla viene a arreglar.
   */
  get responsablePendiente(): Usuario | undefined {
    const previo = this.responsablePrevio;
    return previo && this.provisionesResponsable[previo.id] ? previo : undefined;
  }

  /**
   * Da de alta al responsable del restaurante en el primer arranque.
   *
   * ES LA PRIMERA CUENTA DEL LOCAL y la crea el propio restaurante, con el PIN
   * que elija. Por eso no nace con `debe_cambiar_credencial`: nadie más lo
   * conoce, así que no hay nada que cambiar después.
   *
   * CUATRO DECISIONES QUE NO SON DE ESTILO:
   *
   *  1. **Reutiliza la cuenta de propietario si el local ya tenía una.** Un alta
   *     que creara un usuario nuevo dejaría el local con dos propietarios, cada
   *     uno con todos los permisos: el heredado y el de la casa.
   *
   *  2. **El nombre solo lo manda la licencia firmada.** Si el propietario previo
   *     no viene de una provisión de MOTRAE —el «Gonzalo DJA» que sembraban las
   *     versiones anteriores— se renombra con el que escriba el restaurante. Era
   *     media razón de ser de este cambio: que la cuenta del dueño lleve su nombre.
   *
   *  3. **Se firma con el propio responsable.** El alta queda en la bitácora a su
   *     nombre y no a nombre de «sistema»: es él quien está frente a la caja.
   *
   *  4. **Emite `credencial_cambiada`.** Es lo que hace que el alta sea
   *     irreversible al reproyectar el log: al siguiente arranque la cuenta ya
   *     consta como estrenada y esta pantalla no vuelve a salir.
   */
  async crearResponsableInicial(datos: {
    nombre: string;
    puesto?: string;
    pin: string;
  }): Promise<Resultado> {
    if (!this.requiereAltaInicial) {
      return { ok: false, error: "Este restaurante ya tiene usuarios dados de alta" };
    }

    const previo = this.responsablePrevio;
    const nombre = (this.responsablePendiente?.nombre ?? datos.nombre).trim();
    if (nombre.length < 2) return { ok: false, error: "Escribe el nombre del responsable" };

    const problema = validarSecreto(datos.pin, "pin");
    if (problema) return { ok: false, error: problema };

    const id = previo?.id ?? USUARIO_RESPONSABLE_ID;
    // El puesto se hereda solo del perfil firmado. El de un propietario heredado
    // («Dirección General») era una etiqueta de la semilla de MOTRAE, no del local.
    const puesto =
      datos.puesto?.trim() || this.responsablePendiente?.puesto || PUESTO_RESPONSABLE;
    const usuario = usuarioResponsable({ id, nombre, puesto }, SUCURSAL_ID, false);

    this.credenciales.set(id, [await crearCredencial(id, datos.pin, "pin")]);
    /*
     * Se reemplaza POR ID, no por `previo`.
     *
     * `previo` solo ve a los propietarios activos, y un local pudo haber
     * desactivado al suyo: ahí `previo` es `undefined` pero el id sigue ocupado, y
     * añadirlo dejaría dos entradas con el mismo id en la lista de usuarios.
     */
    const existe = this.usuarios.some((u) => u.id === id);
    this.usuarios = existe
      ? this.usuarios.map((u) => (u.id === id ? usuario : u))
      : [...this.usuarios, usuario];

    this.fabrica.actualizarContexto({ empleado_id: id });

    const yaEnElLog = this.eventos.some(
      (evento) => evento.tipo === "usuario_creado" && evento.usuario_id === id,
    );
    if (yaEnElLog) {
      // `activo` va explícito: si la cuenta estaba desactivada, sin esto volvería a
      // estarlo al reproyectar el log y el local quedaría fuera otra vez.
      this.emitir("usuario_actualizado", { usuario_id: id, cambios: { nombre, activo: true } });
    } else {
      this.emitir("usuario_creado", {
        usuario_id: id,
        nombre,
        puesto,
        rol_id: usuario.rol_id,
        permisos: usuario.permisos.map((permiso) => ({ ...permiso })),
      });
    }
    this.emitir("credencial_cambiada", { usuario_id: id, tipo_credencial: "pin" });

    // La provisión de MOTRAE queda como ya aplicada: reemitir la misma licencia
    // por cobro no puede volver a pisar el PIN que el responsable acaba de elegir.
    /*
     * Se anota la provisión de la LICENCIA, no una marca inventada.
     *
     * `local:${id}` era el último recurso y acabó siendo el caso normal: el alta
     * ocurre antes de que la licencia llegue del Hub, así que casi siempre no
     * había provisión que anotar. Esa marca no coincide nunca con la real, y en
     * el siguiente arranque la provisión parecía nueva y pisaba este PIN.
     */
    const provision = this.provisionesResponsable[id];
    this.provisionesResponsable = {
      ...this.provisionesResponsable,
      [id]: {
        provision_id: this.provisionVigente[id] ?? provision?.provision_id ?? `local:${id}`,
        debe_cambiar_credencial: false,
      },
    };

    await this.guardarSecretos();
    this.establecerSesion(usuario, false);
    return { ok: true };
  }

  /**
   * Monta las cuentas que viajan dentro de una licencia verificada.
   *
   * La credencial llega por `/licencia`, que **solo contesta a la propia caja**.
   * En una tablet del salón esta llamada falla y no pasa nada: no hay soporte
   * ahí, que es lo correcto — el hash de la contraseña que abre todos los
   * restaurantes no tiene por qué viajar al teléfono de un mesero.
   *
   * Un fallo aquí NUNCA puede impedir que la caja abra. Si el Hub no contesta,
   * el local opera igual y las cuentas se revisan de nuevo al siguiente arranque.
   */
  private async montarCuentasDeLicencia(): Promise<void> {
    /*
     * Solo en la CAJA. Es el único equipo cuya página sirve el propio Hub, y por
     * eso el único que lleva `__MOTREST_HUB__` — el mismo marcador que usa la
     * impresión para saber que puede hablar con el puerto local.
     */
    if (!esLaCaja()) return;

    try {
      // Mismo origen: la página de la caja la sirve el Hub.
      const respuesta = await fetch("/licencia", { signal: AbortSignal.timeout(2500) });
      if (!respuesta.ok) return;

      const cuerpo = (await respuesta.json()) as { licencia: Licencia | null; verificada: boolean };
      const sucursal = cuerpo.licencia?.sucursal_id ?? SUCURSAL_ID;
      this.montarResponsable(cuerpo.licencia, cuerpo.verificada, sucursal);

      const credencial = credencialDeSoporte(cuerpo.licencia, cuerpo.verificada);
      if (!credencial) return;
      if (!this.usuarios.some((u) => u.id === USUARIO_SOPORTE_ID)) {
        this.usuarios = [...this.usuarios, usuarioSoporte(sucursal)];
      }
      this.credenciales.set(USUARIO_SOPORTE_ID, [credencial]);
    } catch {
      // Sin Hub local, sin soporte. La caja abre igual.
    }
  }

  /**
   * Aplica una sola vez el PIN inicial que Central firmó para el responsable.
   * Reemitir una licencia por cobro no pisa un PIN que el responsable ya cambió.
   */
  private montarResponsable(
    licencia: Licencia | null,
    verificada: boolean,
    sucursal: ID,
  ): void {
    const perfilPrevio = licencia?.responsable;
    const estadoPrevio = perfilPrevio
      ? this.provisionesResponsable[perfilPrevio.id]
      : undefined;
    /*
     * La provisión que trae la licencia AHORA, aplicada o no.
     *
     * Se recuerda aparte del marcador de «ya aplicada» porque el alta que hace
     * el propio restaurante ocurre antes de que la licencia llegue del Hub, y
     * necesita saber qué provisión está consumiendo.
     */
    if (perfilPrevio) this.provisionVigente[perfilPrevio.id] = perfilPrevio.provision_id;

    /*
     * UNA MARCA `local:` SIGNIFICA QUE EL RESTAURANTE YA ELIGIÓ SU PIN.
     *
     * Ese marcador lo escribe el alta inicial cuando todavía no sabía qué
     * provisión traía la licencia. Comparado contra el `provision_id` real nunca
     * coincide, así que la provisión parecía nueva EN CADA ARRANQUE: se volvía a
     * aplicar y pisaba el PIN elegido con el que emitió Central. Medido en la
     * caja de Rodizio, con los dos registros alternándose en el disco.
     *
     * Si este equipo ya tiene credencial para esa cuenta, la provisión pendiente
     * está consumida: se adopta su identificador sin tocar el PIN. Una provisión
     * POSTERIOR y distinta —reponer el acceso desde Central— sigue aplicándose,
     * porque a partir de aquí se comparan identificadores de verdad.
     */
    if (
      perfilPrevio &&
      estadoPrevio?.provision_id?.startsWith("local:") &&
      this.tieneCredencial(perfilPrevio.id)
    ) {
      this.provisionesResponsable = {
        ...this.provisionesResponsable,
        [perfilPrevio.id]: {
          provision_id: perfilPrevio.provision_id,
          debe_cambiar_credencial: false,
        },
      };
      void this.guardarSecretos();
      return;
    }

    const provisionNueva = estadoPrevio?.provision_id !== perfilPrevio?.provision_id;
    const cuenta = cuentaResponsableDeLicencia(
      licencia,
      verificada,
      sucursal,
      provisionNueva || estadoPrevio?.debe_cambiar_credencial === true,
    );
    if (!cuenta) return;

    const aplicadoAntes = !provisionNueva;
    const usuario = cuenta.usuario;
    if (this.usuarios.some((u) => u.id === usuario.id)) {
      this.usuarios = this.usuarios.map((u) => (u.id === usuario.id ? usuario : u));
    } else {
      this.usuarios = [...this.usuarios, usuario];
    }
    if (this.usuarioActual?.id === usuario.id) this.usuarioActual = usuario;

    if (!aplicadoAntes) {
      this.credenciales.set(usuario.id, [cuenta.credencial]);
      this.provisionesResponsable = {
        ...this.provisionesResponsable,
        [usuario.id]: {
          provision_id: cuenta.provision_id,
          debe_cambiar_credencial: true,
        },
      };
    }
  }

  /**
   * Todos los activos, incluido el acceso de soporte de MOTRAE.
   *
   * ES LA LISTA INTERNA, no la de las pantallas. La usan los bucles que buscan
   * quién puede firmar una autorización, y ahí el soporte SÍ debe estar: si
   * MOTRAE entra a resolver algo, tiene que poder autorizar lo que haga falta.
   * Para enseñar personal en pantalla está `usuariosDelLocal`.
   */
  get usuariosActivos(): Usuario[] {
    return this.usuarios.filter((u) => u.activo);
  }

  /**
   * El personal del restaurante: lo que va en TODAS las pantallas.
   *
   * Deja fuera al soporte de MOTRAE. Es el único filtro que hace falta para que
   * no aparezca en el selector de acceso, en el equipo ni en la administración
   * de usuarios — y deliberadamente NO se aplica a la bitácora: lo que hace el
   * soporte se ve con su nombre.
   */
  get usuariosDelLocal(): Usuario[] {
    return usuariosVisibles(this.usuariosActivos);
  }

  /**
   * El personal del local INCLUIDOS los desactivados.
   *
   * Es lo que va en Administración → Usuarios: quien está desactivado tiene que
   * seguir viéndose, porque esa es justo la pantalla donde se le reactiva.
   */
  get usuariosAdministrables(): Usuario[] {
    return usuariosVisibles(this.usuarios);
  }

  usuarioDe(id: ID): Usuario | undefined {
    return this.usuarios.find((u) => u.id === id);
  }

  nombreDe(id: ID): string {
    return this.usuarioDe(id)?.nombre ?? id;
  }

  tipoCredencialDe(id: ID): TipoCredencial {
    return this.credenciales.get(id)?.[0]?.tipo ?? "pin";
  }

  // --- Permisos --------------------------------------------------------------------

  evaluar(accion: Accion, ctx?: ContextoAccion): Veredicto {
    if (!this.usuarioActual) {
      return { resultado: "denegado", razon: "No hay sesión iniciada" };
    }
    return evaluar(this.usuarioActual, accion, ctx);
  }

  puedeVer(accion: Accion): boolean {
    return this.usuarioActual ? puedeVer(this.usuarioActual, accion) : false;
  }

  puedeOperar(accion: Accion, ctx?: ContextoAccion): boolean {
    return this.evaluar(accion, ctx).resultado === "permitido";
  }

  // --- Acceso ------------------------------------------------------------------------

  /** Estado de intentos de un usuario. */
  private estadoIntentos(usuarioId: ID): EstadoIntentos {
    return this.intentos[usuarioId] ?? { fallos: 0, ultimo_fallo_ts: 0 };
  }

  /** ¿La credencial quedó bloqueada por agotar los 7 intentos? */
  estaBloqueado(usuarioId: ID): boolean {
    return this.estadoIntentos(usuarioId).fallos >= MAX_INTENTOS;
  }

  /** Intentos que le quedan al usuario antes del bloqueo definitivo. */
  intentosRestantes(usuarioId: ID): number {
    return Math.max(0, MAX_INTENTOS - this.estadoIntentos(usuarioId).fallos);
  }

  private registrarFallo(usuarioId: ID): number {
    const previo = this.estadoIntentos(usuarioId);
    const fallos = previo.fallos + 1;
    this.intentos = {
      ...this.intentos,
      [usuarioId]: { fallos, ultimo_fallo_ts: Date.now() },
    };
    if (fallos === MAX_INTENTOS) {
      this.emitir("usuario_bloqueado", { usuario_id: usuarioId, intentos: fallos });
    }
    void this.guardarSecretos();
    return fallos;
  }

  /** Inicia sesión con la credencial del usuario indicado. */
  async iniciarSesion(usuarioId: ID, secreto: string): Promise<Resultado> {
    const usuario = this.usuarioDe(usuarioId);
    if (!usuario) return { ok: false, error: "Usuario no encontrado" };

    if (!usuario.activo) {
      this.emitir("acceso_rechazado", { usuario_id: usuarioId, motivo: "usuario_inactivo" });
      return { ok: false, error: "El usuario está desactivado" };
    }

    const politica = politicaIntentos(this.estadoIntentos(usuarioId), Date.now());

    if (politica.bloqueado) {
      this.emitir("acceso_rechazado", { usuario_id: usuarioId, motivo: "bloqueo_por_intentos" });
      return {
        ok: false,
        error: `Cuenta bloqueada tras ${MAX_INTENTOS} intentos. Requiere desbloqueo de un superior.`,
      };
    }

    if (!politica.permitido) {
      this.emitir("acceso_rechazado", { usuario_id: usuarioId, motivo: "bloqueo_por_intentos" });
      const segundos = Math.ceil(politica.espera_ms / 1000);
      return { ok: false, error: `Demasiados intentos. Espera ${segundos} s` };
    }

    const valida = await this.verificarAlguna(usuarioId, secreto);
    if (!valida) {
      const fallos = this.registrarFallo(usuarioId);
      this.emitir("acceso_rechazado", { usuario_id: usuarioId, motivo: "credencial_invalida" });
      const restantes = MAX_INTENTOS - fallos;
      return {
        ok: false,
        error:
          restantes > 0
            ? `Credencial incorrecta. Te ${restantes === 1 ? "queda 1 intento" : `quedan ${restantes} intentos`}.`
            : `Cuenta bloqueada tras ${MAX_INTENTOS} intentos. Requiere desbloqueo de un superior.`,
      };
    }

    const { [usuarioId]: _descartado, ...resto } = this.intentos;
    this.intentos = resto;
    void this.guardarSecretos();
    this.abrirSesionDe(usuario, false);
    return { ok: true };
  }

  /**
   * Comprueba la credencial de alguien SIN abrirle sesión.
   *
   * Es lo que necesita el checador: la tablet de la entrada tiene una sesión
   * abierta todo el turno y no debe cambiarla porque alguien marque su hora.
   * Se apoya en la misma política de 7 intentos que el inicio de sesión, para
   * que este camino no sea una puerta trasera con menos protección.
   */
  async comprobarCredencial(usuarioId: ID, secreto: string): Promise<Resultado> {
    const usuario = this.usuarioDe(usuarioId);
    if (!usuario) return { ok: false, error: "Usuario no encontrado" };
    if (!usuario.activo) return { ok: false, error: "El usuario está desactivado" };

    const politica = politicaIntentos(this.estadoIntentos(usuarioId), Date.now());
    if (politica.bloqueado) {
      return {
        ok: false,
        error: `Cuenta bloqueada tras ${MAX_INTENTOS} intentos. Requiere desbloqueo de un superior.`,
      };
    }
    if (!politica.permitido) {
      const segundos = Math.ceil(politica.espera_ms / 1000);
      return { ok: false, error: `Demasiados intentos. Espera ${segundos} s` };
    }

    if (!(await this.verificarAlguna(usuarioId, secreto))) {
      const fallos = this.registrarFallo(usuarioId);
      this.emitir("acceso_rechazado", { usuario_id: usuarioId, motivo: "credencial_invalida" });
      const restantes = MAX_INTENTOS - fallos;
      return {
        ok: false,
        error:
          restantes > 0
            ? `PIN incorrecto. Te ${restantes === 1 ? "queda 1 intento" : `quedan ${restantes} intentos`}.`
            : `Cuenta bloqueada tras ${MAX_INTENTOS} intentos. Requiere desbloqueo de un superior.`,
      };
    }

    const { [usuarioId]: _descartado, ...resto } = this.intentos;
    this.intentos = resto;
    void this.guardarSecretos();
    return { ok: true };
  }

  /** Reactiva una credencial bloqueada. Solo un rol autorizante puede hacerlo. */
  desbloquear(usuarioId: ID): Resultado {
    const actor = this.usuarioActual;
    const objetivo = this.usuarioDe(usuarioId);
    if (!actor || !objetivo) return { ok: false, error: "Usuario no encontrado" };

    if (!this.puedeOperar("admin.usuario.editar")) {
      return { ok: false, error: "No tienes permiso para desbloquear usuarios" };
    }
    if (!puedeGestionarA(actor, objetivo)) {
      return {
        ok: false,
        error: `No puedes desbloquear a ${objetivo.nombre}: su rol está a tu mismo nivel o por encima del tuyo.`,
      };
    }
    const { [usuarioId]: _descartado, ...resto } = this.intentos;
    this.intentos = resto;
    void this.guardarSecretos();
    this.emitir("usuario_desbloqueado", {
      usuario_id: usuarioId,
      desbloqueado_por: this.usuarioActual?.id ?? "sistema",
    });
    return { ok: true };
  }

  /** Cambio rápido de usuario en el POS: se identifica por su PIN. */
  async cambioRapido(pin: string): Promise<Resultado> {
    const politica = politicaIntentos(this.intentosAutorizacion, Date.now());
    if (politica.bloqueado) {
      return {
        ok: false,
        error: `Se agotaron los ${MAX_INTENTOS} intentos. Inicia sesión desde la pantalla de acceso.`,
      };
    }

    for (const usuario of this.usuariosActivos) {
      if (this.estaBloqueado(usuario.id)) continue;
      for (const credencial of this.credenciales.get(usuario.id) ?? []) {
        if (credencial.tipo !== "pin") continue;
        if (await verificarCredencial(pin, credencial)) {
          this.intentosAutorizacion = { fallos: 0, ultimo_fallo_ts: 0 };
          this.abrirSesionDe(usuario, true);
          return { ok: true };
        }
      }
    }

    this.intentosAutorizacion = {
      fallos: this.intentosAutorizacion.fallos + 1,
      ultimo_fallo_ts: Date.now(),
    };
    this.emitir("acceso_rechazado", { motivo: "credencial_invalida" });
    const restantes = MAX_INTENTOS - this.intentosAutorizacion.fallos;
    return {
      ok: false,
      error: restantes > 0 ? `PIN no reconocido. Quedan ${restantes} intentos.` : "Intentos agotados",
    };
  }

  /** Intentos que quedan en el diálogo de autorización. */
  get restantesAutorizacion(): number {
    return Math.max(0, MAX_INTENTOS - this.intentosAutorizacion.fallos);
  }

  cerrarSesion(): void {
    if (!this.usuarioActual) return;
    this.emitir("sesion_cerrada", { usuario_id: this.usuarioActual.id });
    this.usuarioActual = null;
    this.guardarSesionActiva();
  }

  private async verificarAlguna(usuarioId: ID, secreto: string): Promise<boolean> {
    for (const credencial of this.credenciales.get(usuarioId) ?? []) {
      if (await verificarCredencial(secreto, credencial)) return true;
    }
    return false;
  }

  // --- Autorización de acciones sensibles --------------------------------------------

  /**
   * Un superior firma con su PIN la acción que el usuario actual no puede hacer.
   * Devuelve el id del autorizador si la firma es válida.
   */
  async autorizar(
    accion: Accion,
    pin: string,
    contexto?: string,
  ): Promise<{ ok: boolean; autorizador_id?: ID; error?: string }> {
    const solicitante = this.usuarioActual;
    if (!solicitante) return { ok: false, error: "No hay sesión iniciada" };

    const politica = politicaIntentos(this.intentosAutorizacion, Date.now());
    if (politica.bloqueado) {
      return {
        ok: false,
        error: `Se agotaron los ${MAX_INTENTOS} intentos de autorización. Cierra el diálogo e inténtalo desde la pantalla de acceso.`,
      };
    }
    if (!politica.permitido) {
      const segundos = Math.ceil(politica.espera_ms / 1000);
      return { ok: false, error: `Demasiados intentos. Espera ${segundos} s` };
    }

    for (const usuario of this.usuariosActivos) {
      if (!puedeAutorizar(usuario, accion) || this.estaBloqueado(usuario.id)) continue;
      for (const credencial of this.credenciales.get(usuario.id) ?? []) {
        if (credencial.tipo !== "pin") continue;
        if (await verificarCredencial(pin, credencial)) {
          this.intentosAutorizacion = { fallos: 0, ultimo_fallo_ts: 0 };
          this.emitir("autorizacion_otorgada", {
            accion,
            solicitante_id: solicitante.id,
            autorizador_id: usuario.id,
            contexto,
          });
          return { ok: true, autorizador_id: usuario.id };
        }
      }
    }

    this.intentosAutorizacion = {
      fallos: this.intentosAutorizacion.fallos + 1,
      ultimo_fallo_ts: Date.now(),
    };
    this.emitir("autorizacion_denegada", {
      accion,
      solicitante_id: solicitante.id,
      motivo: "PIN no corresponde a un rol autorizante",
    });

    const restantes = MAX_INTENTOS - this.intentosAutorizacion.fallos;
    return {
      ok: false,
      error:
        restantes > 0
          ? `El PIN no corresponde a alguien que pueda autorizar esto. Quedan ${restantes} intentos.`
          : `Se agotaron los ${MAX_INTENTOS} intentos de autorización.`,
    };
  }

  // --- Gestión de usuarios --------------------------------------------------------------

  // --- Jerarquía (nadie administra a un igual ni a un superior) -----------------

  /** ¿El usuario en sesión puede administrar a este otro? */
  puedeGestionar(objetivo: Usuario): boolean {
    const actor = this.usuarioActual;
    return actor ? puedeGestionarA(actor, objetivo) : false;
  }

  /** Roles que el usuario en sesión puede asignar (solo por debajo del suyo). */
  get rolesAsignables(): RolId[] {
    const actor = this.usuarioActual;
    return actor ? rolesAsignablesPor(actor) : [];
  }

  /** ¿Puede conceder este permiso? Solo se delega lo que uno tiene. */
  puedeOtorgar(permiso: Permiso): boolean {
    const actor = this.usuarioActual;
    return actor ? puedeOtorgar(actor, permiso) : false;
  }

  async crearUsuario(datos: {
    nombre: string;
    puesto: string;
    rol_id: RolId;
    permisos: Permiso[];
    pin: string;
  }): Promise<Resultado> {
    const actor = this.usuarioActual;
    if (!actor || !this.puedeOperar("admin.usuario.crear")) {
      return { ok: false, error: "No tienes permiso para crear usuarios" };
    }
    if (rangoDe(datos.rol_id) >= rangoDe(actor.rol_id)) {
      return {
        ok: false,
        error: `No puedes crear un usuario con el rol ${ROLES[datos.rol_id].nombre}: está a tu mismo nivel o por encima.`,
      };
    }
    const excedidos = permisosNoOtorgables(actor, datos.permisos);
    if (excedidos.length > 0) {
      return {
        ok: false,
        error: `No puedes otorgar permisos que tú no tienes: ${excedidos
          .slice(0, 3)
          .map((p) => etiquetaAccion(p.accion))
          .join(", ")}${excedidos.length > 3 ? "…" : ""}`,
      };
    }
    const nombre = datos.nombre.trim();
    if (nombre.length < 2) return { ok: false, error: "Escribe el nombre del usuario" };

    const problema = validarSecreto(datos.pin, "pin");
    if (problema) return { ok: false, error: problema };

    /*
     * El UUID completo, no un recorte.
     *
     * `slice(0, 8)` se quedaba con los primeros 8 caracteres, que en un UUIDv7
     * son EXACTAMENTE la marca de tiempo en milisegundos y nada más: la parte
     * aleatoria viene después. Dos altas en el mismo milisegundo —que es lo que
     * ocurre al registrar al personal uno tras otro— recibían el mismo id, y el
     * segundo usuario pisaba las credenciales del primero.
     *
     * Un id corto no vale ese riesgo: nadie lo teclea, solo lo lee la máquina.
     */
    const id = `usr-${uuidv7()}`;
    const nuevo: Usuario = {
      id,
      nombre,
      iniciales: nombre.slice(0, 1).toUpperCase(),
      rol_id: datos.rol_id,
      puesto: datos.puesto.trim() || nombre,
      sucursal_id: SUCURSAL_ID,
      permisos: datos.permisos,
      activo: true,
      /*
       * El PIN inicial lo eligió quien dio de alta al usuario, así que hay una
       * persona más que lo conoce. Se pide cambiarlo al entrar por primera vez,
       * y a partir de ahí la cuenta es solo suya — que es lo que hace que la
       * bitácora signifique algo.
       */
      debe_cambiar_credencial: true,
    };

    this.credenciales.set(id, [await crearCredencial(id, datos.pin, "pin")]);
    this.usuarios = [...this.usuarios, nuevo];
    this.emitir("usuario_creado", {
      usuario_id: id,
      nombre: nuevo.nombre,
      puesto: nuevo.puesto,
      rol_id: nuevo.rol_id,
      permisos: nuevo.permisos,
    });
    await this.guardarSecretos();
    return { ok: true };
  }

  actualizarPermisos(usuarioId: ID, permisos: Permiso[]): Resultado {
    const actor = this.usuarioActual;
    const objetivo = this.usuarioDe(usuarioId);
    if (!actor || !objetivo) return { ok: false, error: "Usuario no encontrado" };

    if (!this.puedeOperar("admin.usuario.editar")) {
      return { ok: false, error: "No tienes permiso para editar usuarios" };
    }
    if (!puedeGestionarA(actor, objetivo)) {
      return {
        ok: false,
        error: `No puedes modificar a ${objetivo.nombre}: su rol está a tu mismo nivel o por encima del tuyo.`,
      };
    }
    const excedidos = permisosNoOtorgables(actor, permisos);
    if (excedidos.length > 0) {
      return {
        ok: false,
        error: `No puedes otorgar permisos que tú no tienes: ${excedidos
          .slice(0, 3)
          .map((p) => etiquetaAccion(p.accion))
          .join(", ")}${excedidos.length > 3 ? "…" : ""}`,
      };
    }

    this.usuarios = this.usuarios.map((u) => (u.id === usuarioId ? { ...u, permisos } : u));
    if (this.usuarioActual?.id === usuarioId) {
      this.usuarioActual = { ...this.usuarioActual, permisos };
    }
    this.emitir("usuario_actualizado", { usuario_id: usuarioId, cambios: { permisos } });
    return { ok: true };
  }

  cambiarActivo(usuarioId: ID, activo: boolean): Resultado {
    const actor = this.usuarioActual;
    const objetivo = this.usuarioDe(usuarioId);
    if (!actor || !objetivo) return { ok: false, error: "Usuario no encontrado" };

    if (!this.puedeOperar("admin.usuario.editar")) {
      return { ok: false, error: "No tienes permiso para editar usuarios" };
    }
    if (!puedeGestionarA(actor, objetivo)) {
      return {
        ok: false,
        error: `No puedes ${activo ? "activar" : "desactivar"} a ${objetivo.nombre}: su rol está a tu mismo nivel o por encima del tuyo.`,
      };
    }

    this.usuarios = this.usuarios.map((u) => (u.id === usuarioId ? { ...u, activo } : u));
    this.emitir("usuario_actualizado", { usuario_id: usuarioId, cambios: { activo } });
    return { ok: true };
  }

  /** ¿Puede quien está en sesión borrar a este de la plantilla? */
  puedeEliminar(usuarioId: ID): boolean {
    const actor = this.usuarioActual;
    const objetivo = this.usuarioDe(usuarioId);
    return !!actor && !!objetivo && puedeEliminarA(actor, objetivo);
  }

  /**
   * Borra a alguien de la plantilla **en definitiva**.
   *
   * Solo el rango más alto del restaurante, y nunca a un igual ni a sí mismo:
   * lo comprueba `puedeEliminarA`. Se destruye además su credencial, porque de
   * nada sirve sacarlo de la lista si su PIN sigue abriendo la caja.
   *
   * LO QUE NO SE BORRA es su rastro. La bitácora solo agrega: las mesas que
   * cobró siguen siendo suyas y este mismo borrado queda escrito con el nombre
   * de quien lo firmó. Un sistema donde el dueño puede hacer desaparecer lo que
   * hizo un empleado no sirve para aclarar un faltante de caja.
   */
  eliminarUsuario(usuarioId: ID): Resultado {
    const actor = this.usuarioActual;
    const objetivo = this.usuarioDe(usuarioId);
    if (!actor || !objetivo) return { ok: false, error: "Usuario no encontrado" };

    if (actor.id === usuarioId) {
      return { ok: false, error: "No puedes eliminarte a ti mismo." };
    }
    if (!puedeAutorizar(actor, "admin.usuario.eliminar")) {
      return {
        ok: false,
        error: "Eliminar a alguien en definitiva solo lo puede hacer la dirección del restaurante.",
      };
    }
    if (!puedeGestionarA(actor, objetivo)) {
      return {
        ok: false,
        error: `No puedes eliminar a ${objetivo.nombre}: su rol está a tu mismo nivel o por encima del tuyo.`,
      };
    }

    this.usuarios = this.usuarios.filter((u) => u.id !== usuarioId);
    /*
     * Fuera de la lista Y sin credencial.
     *
     * Si el hash sobreviviera, el PIN de un empleado eliminado seguiría
     * firmando cancelaciones y descuentos desde el diálogo de autorización, que
     * no busca por la lista sino por credencial. Se reescriben los secretos en
     * el acto para que tampoco quede en disco.
     */
    this.credenciales.delete(usuarioId);
    const { [usuarioId]: _fuera, ...intentos } = this.intentos;
    this.intentos = intentos;
    void this.guardarSecretos();

    this.emitir("usuario_eliminado", {
      usuario_id: usuarioId,
      eliminado_por: actor.id,
      nombre: objetivo.nombre,
    });
    return { ok: true };
  }

  /** Cambia la credencial del usuario en sesión (obligatorio en el primer inicio). */
  async cambiarCredencialPropia(secreto: string, tipo: TipoCredencial): Promise<Resultado> {
    const usuario = this.usuarioActual;
    if (!usuario) return { ok: false, error: "No hay sesión iniciada" };

    const problema = validarSecreto(secreto, tipo);
    if (problema) return { ok: false, error: problema };

    const previas = (this.credenciales.get(usuario.id) ?? []).filter((c) => c.tipo !== tipo);
    this.credenciales.set(usuario.id, [
      await crearCredencial(usuario.id, secreto, tipo),
      ...previas,
    ]);

    const actualizado: Usuario = { ...usuario, debe_cambiar_credencial: false };
    this.usuarios = this.usuarios.map((u) => (u.id === usuario.id ? actualizado : u));
    this.usuarioActual = actualizado;
    if (this.provisionesResponsable[usuario.id]) {
      this.provisionesResponsable = {
        ...this.provisionesResponsable,
        [usuario.id]: {
          ...this.provisionesResponsable[usuario.id]!,
          debe_cambiar_credencial: false,
        },
      };
    }

    this.emitir("credencial_cambiada", { usuario_id: usuario.id, tipo_credencial: tipo });
    await this.guardarSecretos();
    return { ok: true };
  }

  /**
   * ¿Alguien puede autorizar que ESTE usuario restablezca su credencial?
   *
   * Sirve para no ofrecer un botón que no lleva a ningún lado: si en el local
   * no hay nadie con rango suficiente, más vale decirlo antes de que alguien
   * pase dos minutos tecleando PIN ajenos.
   */
  hayQuienAutoriceCredencialDe(objetivo: Usuario): boolean {
    // Del LOCAL: la pregunta es si hay alguien aquí que pueda firmarlo. Que
    // MOTRAE pueda hacerlo en remoto no le sirve a quien está frente a la caja.
    return this.usuariosDelLocal.some(
      (u) =>
        puedeGestionarA(u, objetivo) &&
        puedeAutorizar(u, "admin.credencial.autorizar") &&
        !this.estaBloqueado(u.id),
    );
  }

  /**
   * Restablece la credencial de alguien que la olvidó, con la firma de un
   * superior.
   *
   * Es el caso de todos los días: un mesero olvida su PIN a media tarde y no
   * puede cobrar. Sin esto, la única salida es reinstalar o editarlo desde
   * Administración, que exige que alguien deje la caja.
   *
   * DOS CANDADOS, y ninguno sobra:
   *
   *  1. Quien firma necesita el permiso «Autorizar cambio de PIN».
   *  2. Quien firma tiene que ser de rango ESTRICTAMENTE mayor que el afectado.
   *
   * El segundo es el que evita una toma de control: sin él, un gerente podría
   * restablecer la contraseña del dueño y entrar como él. La consecuencia
   * deliberada es que **la credencial del propietario no la restablece nadie**;
   * él la cambia estando dentro, y por eso esa otra ruta también existe.
   */
  async restablecerCredencial(
    objetivoId: ID,
    nuevoSecreto: string,
    tipo: TipoCredencial,
    pinAutorizador: string,
  ): Promise<Resultado> {
    const objetivo = this.usuarios.find((u) => u.id === objetivoId);
    if (!objetivo) return { ok: false, error: "Usuario desconocido" };

    const problema = validarSecreto(nuevoSecreto, tipo);
    if (problema) return { ok: false, error: problema };

    const politica = politicaIntentos(this.intentosAutorizacion, Date.now());
    if (politica.bloqueado) {
      return {
        ok: false,
        error: `Se agotaron los ${MAX_INTENTOS} intentos de autorización.`,
      };
    }
    if (!politica.permitido) {
      const segundos = Math.ceil(politica.espera_ms / 1000);
      return { ok: false, error: `Demasiados intentos. Espera ${segundos} s` };
    }

    for (const autorizador of this.usuariosActivos) {
      if (!puedeGestionarA(autorizador, objetivo)) continue;
      if (!puedeAutorizar(autorizador, "admin.credencial.autorizar")) continue;
      if (this.estaBloqueado(autorizador.id)) continue;

      for (const credencial of this.credenciales.get(autorizador.id) ?? []) {
        if (!(await verificarCredencial(pinAutorizador, credencial))) continue;

        this.intentosAutorizacion = { fallos: 0, ultimo_fallo_ts: 0 };

        const previas = (this.credenciales.get(objetivoId) ?? []).filter((c) => c.tipo !== tipo);
        this.credenciales.set(objetivoId, [
          await crearCredencial(objetivoId, nuevoSecreto, tipo),
          ...previas,
        ]);

        // Restablecer la credencial levanta el bloqueo por intentos fallidos:
        // quien olvidó su PIN suele haberlo agotado intentando recordarlo.
        this.intentos = { ...this.intentos, [objetivoId]: { fallos: 0, ultimo_fallo_ts: 0 } };
        if (this.provisionesResponsable[objetivoId]) {
          this.provisionesResponsable = {
            ...this.provisionesResponsable,
            [objetivoId]: {
              ...this.provisionesResponsable[objetivoId]!,
              debe_cambiar_credencial: false,
            },
          };
        }

        this.emitir("credencial_cambiada", {
          usuario_id: objetivoId,
          tipo_credencial: tipo,
          autorizador_id: autorizador.id,
        });
        await this.guardarSecretos();
        return { ok: true };
      }
    }

    this.intentosAutorizacion = {
      fallos: this.intentosAutorizacion.fallos + 1,
      ultimo_fallo_ts: Date.now(),
    };
    return {
      ok: false,
      error: "Esa clave no corresponde a nadie que pueda autorizar este cambio",
    };
  }


  // --- Código de rescate ---------------------------------------------------------------


  /** ¿Ya hay un código de rescate emitido para este local? */
  get hayCodigoRescate(): boolean {
    return this.rescate !== null;
  }

  /**
   * Emite un código de rescate nuevo y devuelve el texto para enseñarlo UNA vez.
   *
   * Se guarda solo el hash, con las mismas iteraciones que una contraseña. El
   * código en claro vive en memoria hasta que se confirma que fue anotado.
   */
  async emitirCodigoRescate(): Promise<string> {
    const codigo = generarCodigoRescate();
    this.rescate = await crearCredencial(
      RESCATE_ID,
      normalizarCodigo(codigo),
      "contrasena",
    );
    this.codigoRescateNuevo = codigo;
    await this.guardarSecretos();
    return codigo;
  }

  /** El dueño confirmó que lo anotó: se borra de memoria. */
  olvidarCodigoMostrado(): void {
    this.codigoRescateNuevo = null;
  }

  /**
   * Recupera el acceso del propietario con el código de rescate.
   *
   * Es el único camino que NO firma otra persona, así que lleva sus propios
   * candados: la misma política de intentos que todo lo demás, y el código se
   * consume —al usarlo se emite otro—, para que un papel viejo no siga sirviendo.
   *
   * Al terminar, el código nuevo queda en `codigoRescateNuevo` para enseñarlo:
   * quien acaba de recuperar el acceso se queda sin llave de repuesto si no se
   * le entrega otra en ese momento.
   */
  async recuperarAcceso(
    codigo: string,
    nuevaContrasena: string,
  ): Promise<Resultado> {
    const propietario = this.usuarios.find((u) => u.rol_id === "propietario" && u.activo);
    if (!propietario) return { ok: false, error: "No hay un propietario activo en este local" };
    if (!this.rescate) {
      return { ok: false, error: "Este local no tiene código de rescate emitido" };
    }

    const problema = validarSecreto(nuevaContrasena, "contrasena");
    if (problema) return { ok: false, error: problema };

    const politica = politicaIntentos(this.intentosAutorizacion, Date.now());
    if (politica.bloqueado) {
      return { ok: false, error: `Se agotaron los ${MAX_INTENTOS} intentos.` };
    }
    if (!politica.permitido) {
      const segundos = Math.ceil(politica.espera_ms / 1000);
      return { ok: false, error: `Demasiados intentos. Espera ${segundos} s` };
    }

    if (!(await verificarCredencial(normalizarCodigo(codigo), this.rescate))) {
      this.intentosAutorizacion = {
        fallos: this.intentosAutorizacion.fallos + 1,
        ultimo_fallo_ts: Date.now(),
      };
      return { ok: false, error: "Ese código de rescate no es correcto" };
    }

    this.intentosAutorizacion = { fallos: 0, ultimo_fallo_ts: 0 };

    const previas = (this.credenciales.get(propietario.id) ?? []).filter(
      (c) => c.tipo !== "contrasena",
    );
    this.credenciales.set(propietario.id, [
      await crearCredencial(propietario.id, nuevaContrasena, "contrasena"),
      ...previas,
    ]);
    this.intentos = { ...this.intentos, [propietario.id]: { fallos: 0, ultimo_fallo_ts: 0 } };

    // Queda en la bitácora: recuperar el acceso no puede ser silencioso.
    this.emitir("acceso_recuperado", { usuario_id: propietario.id });

    // El código usado se quema y se entrega otro en el acto.
    await this.emitirCodigoRescate();
    return { ok: true };
  }

  /** Plantilla de permisos de un rol, para arrancar el alta de un usuario. */
  plantilla(rolId: RolId): Permiso[] {
    return permisosDePlantilla(rolId);
  }
}

export const sesion = new Sesion();
