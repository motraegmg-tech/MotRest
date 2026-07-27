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
  puedeGestionarA,
  puedeOtorgar,
  puedeVer,
  rangoDe,
  rolesAsignablesPor,
  streamIdentidad,
  uuidv7,
  generarCodigoRescate,
  normalizarCodigo,
  validarSecreto,
  verificarCredencial,
  type Accion,
  type ContextoAccion,
  type Credencial,
  type EstadoIntentos,
  type EventoIdentidad,
  type ID,
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
import { SUCURSAL_ID, obtenerDeviceId } from "../presentacion";
import { USUARIOS_SEMILLA, USUARIO_POR_DEFECTO } from "./usuarios";

export interface Resultado {
  ok: boolean;
  error?: string;
}

const STREAM = streamIdentidad(SUCURSAL_ID);

class Sesion {
  usuarios = $state<Usuario[]>(USUARIOS_SEMILLA.map((s) => ({ ...s.usuario })));
  usuarioActual = $state<Usuario | null>(null);

  /** Bitácora de identidad (se fusiona con la operativa en la vista de auditoría). */
  eventos = $state.raw<EventoIdentidad[]>([]);

  /** Credenciales por usuario. No es estado reactivo: no se muestra jamás. */
  private credenciales = new Map<ID, Credencial[]>();
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
    for (const sembrado of USUARIOS_SEMILLA) {
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

    this.rescate = (await almacen.estado.cargar<Credencial>(CLAVES.rescate)) ?? null;
    /*
     * Si este dispositivo todavía no tiene llave de repuesto, se emite ahora y
     * la pantalla la enseña una vez. Es por DISPOSITIVO, igual que las
     * credenciales: cada terminal guarda sus propios hashes, así que el código
     * que sirve para recuperar el acceso aquí es el que se emitió aquí.
     */
    if (!this.rescate) await this.emitirCodigoRescate();

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

    const activa = await almacen.estado.cargar<ID>(CLAVES.sesion);
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
    void this.guardarSesionActiva();
  }

  private async guardarSecretos(): Promise<void> {
    if (!this.almacen) return;
    try {
      await this.almacen.estado.guardar(
        CLAVES.credenciales,
        Object.fromEntries(this.credenciales),
      );
      await this.almacen.estado.guardar(CLAVES.intentos, this.intentos);
      if (this.rescate) await this.almacen.estado.guardar(CLAVES.rescate, this.rescate);
    } catch (causa) {
      console.error("No se pudieron guardar las credenciales", causa);
    }
  }

  private async guardarSesionActiva(): Promise<void> {
    if (!this.almacen) return;
    try {
      if (this.usuarioActual) {
        await this.almacen.estado.guardar(CLAVES.sesion, this.usuarioActual.id);
      } else {
        await this.almacen.estado.eliminar(CLAVES.sesion);
      }
    } catch (causa) {
      console.error("No se pudo guardar la sesión activa", causa);
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
    void this.guardarSesionActiva();
  }

  // --- Consultas ------------------------------------------------------------------

  get autenticado(): boolean {
    return this.usuarioActual !== null;
  }

  get debeCambiarCredencial(): boolean {
    return this.usuarioActual?.debe_cambiar_credencial === true;
  }

  /** Usuarios que aparecen en el selector de acceso rápido. */
  get usuariosActivos(): Usuario[] {
    return this.usuarios.filter((u) => u.activo);
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
    this.establecerSesion(usuario, false);
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
          this.establecerSesion(usuario, true);
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
    void this.guardarSesionActiva();
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
    return this.usuariosActivos.some(
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
