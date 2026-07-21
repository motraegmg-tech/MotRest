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
  puedeAutorizar,
  puedeGestionarA,
  puedeOtorgar,
  puedeVer,
  rangoDe,
  rolesAsignablesPor,
  streamIdentidad,
  uuidv7,
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

  /** Intentos fallidos por usuario. Reactivo: la UI muestra los restantes. */
  private intentos = $state<Record<ID, EstadoIntentos>>({});
  /** Intentos fallidos del diálogo de autorización (no se sabe de quién es el PIN). */
  private intentosAutorizacion = $state<EstadoIntentos>({ fallos: 0, ultimo_fallo_ts: 0 });

  private fabrica = new FabricaEventos<EventoIdentidad>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  constructor() {
    for (const sembrado of USUARIOS_SEMILLA) {
      const lista: Credencial[] = [sembrado.credencial];
      if (sembrado.pin) lista.push(sembrado.pin);
      this.credenciales.set(sembrado.usuario.id, lista);
    }
    // Arranca con una sesión de piso abierta para no bloquear la demo;
    // la pantalla de acceso permite entrar como cualquier usuario.
    const inicial = this.usuarios.find((u) => u.id === USUARIO_POR_DEFECTO);
    if (inicial) this.establecerSesion(inicial, false);
  }

  // --- Emisión de eventos --------------------------------------------------------

  private emitir<T extends EventoIdentidad["tipo"]>(
    tipo: T,
    datos: Omit<Extract<EventoIdentidad, { tipo: T }>, keyof import("@motrest/dominio").SobreEvento | "tipo">,
  ): void {
    const evento = this.fabrica.crear(tipo, STREAM, datos);
    this.eventos = [...this.eventos, evento];
  }

  private establecerSesion(usuario: Usuario, cambioRapido: boolean): void {
    this.usuarioActual = usuario;
    this.fabrica.actualizarContexto({ empleado_id: usuario.id });
    this.emitir("sesion_iniciada", {
      usuario_id: usuario.id,
      rol_id: usuario.rol_id,
      cambio_rapido: cambioRapido,
    });
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
    this.establecerSesion(usuario, false);
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

    const id = `usr-${uuidv7().slice(0, 8)}`;
    const nuevo: Usuario = {
      id,
      nombre,
      iniciales: nombre.slice(0, 1).toUpperCase(),
      rol_id: datos.rol_id,
      puesto: datos.puesto.trim() || nombre,
      sucursal_id: SUCURSAL_ID,
      permisos: datos.permisos,
      activo: true,
    };

    this.credenciales.set(id, [await crearCredencial(id, datos.pin, "pin")]);
    this.usuarios = [...this.usuarios, nuevo];
    this.emitir("usuario_creado", {
      usuario_id: id,
      nombre: nuevo.nombre,
      rol_id: nuevo.rol_id,
      permisos: nuevo.permisos,
    });
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
    return { ok: true };
  }

  /** Plantilla de permisos de un rol, para arrancar el alta de un usuario. */
  plantilla(rolId: RolId): Permiso[] {
    return permisosDePlantilla(rolId);
  }
}

export const sesion = new Sesion();
