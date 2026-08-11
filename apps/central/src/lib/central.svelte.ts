/**
 * El estado de MotRest Central.
 *
 * Las privadas Ed25519 nunca se guardan en localStorage: el backend Tauri las
 * cifra con DPAPI antes de escribirlas en `%LOCALAPPDATA%`. Este archivo solo
 * conserva una vista pública para la interfaz; las privadas quedan en un campo
 * no reactivo y no se renderizan ni se copian por accidente.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  abrirCofre,
  adopcionDeVersion,
  anotarEnHistorial,
  cerrarCofre,
  cobradoEnPeriodo,
  comisionDeResultado,
  compararVersiones,
  crearCredencial,
  emitirLicencia,
  generarPinSeguro,
  firmarVersion,
  generarPar,
  historiaDelLocal,
  idDeSucursal,
  leTocaElAnillo,
  localesConSoporteViejo,
  mensajeDeCobro,
  pendientesDeHoy,
  posicionEnLaFlota,
  resumenDeCartera,
  saludDeCliente,
  siguienteVencimiento,
  situacionDeCliente,
  totalPagadoPor,
  uuidv7,
  PUESTO_RESPONSABLE,
  USUARIO_RESPONSABLE_ID,
  type Centavos,
  type ClienteMotRest,
  type Credencial,
  type CredencialSoporte,
  type EmisionLicencia,
  type Licencia,
  type MetodoDePago,
  type PagoCliente,
  type ParDeLlaves,
  type Plan,
  type PerfilResponsable,
  type PulsoCliente,
  type ResultadoVerificado,
  type VersionDisponible,
} from "@motrest/dominio";

const LLAVE_CARTERA = "motrae.central.cartera";
const LLAVE_PULSOS = "motrae.central.pulsos";
/** El histórico de partes, aparte de la cartera: crece solo y se puede tirar. */
const LLAVE_HISTORIAL = "motrae.central.historial";
/** Lo último que se publicó, para poder vigilar cómo va bajando. */
const LLAVE_PUBLICACION = "motrae.central.publicacion";
/* Solo se lee para migrar la Central antigua; nunca se vuelve a escribir. */
const LLAVE_SECRETOS_LEGADA = "motrae.central.secretos";

/** Cada cuánto conviene volver a sacar el respaldo de las llaves fuera. */
export const DIAS_ENTRE_RESPALDOS = 30;

/** Lo que se firmó la última vez, para seguirle la pista. */
export interface PublicacionVigilada {
  version: string;
  anillo?: number;
  publicado_ts: number;
  obligatoria?: boolean;
}

/** El parte del propio relay, que hasta ahora nadie miraba. */
export interface SaludRelay {
  restaurantes: number;
  hubs_conectados: number;
  pulsos: number;
  consultado_ts: number;
}

/** La parte de una llave que puede llegar a la interfaz. */
export interface LlavePublica {
  publica: string;
}

/** Vista segura: no contiene ninguna privada. */
export interface Secretos {
  licencias?: LlavePublica;
  publicacion?: LlavePublica;
  repositorio: string;
  soporte?: CredencialSoporte;
  /** Cuándo se fijó la contraseña de soporte vigente. */
  soporte_fijado_ts?: number;
  /** Dónde está el relay. La clave con la que se consulta NO sale de DPAPI. */
  relay_url?: string;
  /** Cuándo se sacó el último respaldo portátil de las llaves. */
  ultimo_respaldo_ts?: number;
}

interface SecretosProtegidos {
  formato: 2;
  licencias?: ParDeLlaves;
  publicacion?: ParDeLlaves;
  repositorio: string;
  soporte?: CredencialSoporte;
  /**
   * Cuándo se fijó la contraseña de soporte actual.
   *
   * Sin este dato no se puede contestar qué locales siguen aceptando la
   * anterior: la contraseña viaja firmada dentro de la licencia, así que solo
   * llega a un restaurante cuando se le emite una nueva.
   */
  soporte_fijado_ts?: number;
  /** El relay de MOTRAE y su clave de administración, para traer los pulsos. */
  relay_url?: string;
  relay_clave_admin?: string;
  /** PINes de responsables, cifrados con DPAPI y nunca en la cartera. */
  responsables?: Record<string, ResponsableProtegido>;
  /** Impide que un reloj atrasado repita un `publicado_ts`. */
  ultimo_publicado_ts?: number;
  /** Cuándo se sacó por última vez un respaldo que abre fuera de esta máquina. */
  ultimo_respaldo_ts?: number;
}

interface ResponsableProtegido {
  provision_id: string;
  credencial: Credencial;
}

interface SecretosLegados {
  licencias?: string;
  publicacion?: string;
  repositorio?: string;
  soporte?: CredencialSoporte;
}

export interface MigracionPendiente {
  habia_licencias: boolean;
  habia_publicacion: boolean;
}

export type EstadoSecretos = "cargando" | "listo" | "desarrollo" | "migracion" | "error";

type Resultado = { ok: true } | { ok: false; error: string };
export interface CredencialesResponsableIniciales {
  /** Solo se entrega al terminar el alta; nunca se persiste en claro. */
  pin: string;
}

type ResultadoAlta =
  | {
      ok: true;
      cliente: ClienteMotRest;
      credencialesResponsable: CredencialesResponsableIniciales;
    }
  | {
      ok: false;
      error: string;
      cliente?: undefined;
      credencialesResponsable?: undefined;
    };
type ResultadoConLicencia =
  | { ok: true; licencia: Licencia; credencialesResponsable?: CredencialesResponsableIniciales }
  | { ok: false; error: string; licencia?: undefined; credencialesResponsable?: undefined };
type ResultadoConManifiesto =
  | { ok: true; manifiesto: VersionDisponible }
  | { ok: false; error: string; manifiesto?: undefined };

let secretosDeDesarrollo: string | null = null;

function vacio(): SecretosProtegidos {
  return { formato: 2, repositorio: "" };
}

function vistaDe(secretos: SecretosProtegidos): Secretos {
  return {
    repositorio: secretos.repositorio,
    ...(secretos.licencias ? { licencias: { publica: secretos.licencias.publica } } : {}),
    ...(secretos.publicacion ? { publicacion: { publica: secretos.publicacion.publica } } : {}),
    ...(secretos.soporte ? { soporte: secretos.soporte } : {}),
    ...(secretos.soporte_fijado_ts ? { soporte_fijado_ts: secretos.soporte_fijado_ts } : {}),
    ...(secretos.relay_url ? { relay_url: secretos.relay_url } : {}),
    ...(secretos.ultimo_respaldo_ts ? { ultimo_respaldo_ts: secretos.ultimo_respaldo_ts } : {}),
  };
}

function leer<T>(llave: string, porDefecto: T): T {
  if (typeof localStorage === "undefined") return porDefecto;
  try {
    const crudo = localStorage.getItem(llave);
    return crudo ? (JSON.parse(crudo) as T) : porDefecto;
  } catch {
    return porDefecto;
  }
}

function escribir(llave: string, valor: unknown): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(llave, JSON.stringify(valor));
}

function borrarLegado(): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(LLAVE_SECRETOS_LEGADA);
}

function leerLegado(): SecretosLegados | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const crudo = localStorage.getItem(LLAVE_SECRETOS_LEGADA);
    if (!crudo) return null;
    const valor = JSON.parse(crudo) as SecretosLegados;
    if (!valor || typeof valor !== "object") return null;
    if (
      (valor.licencias !== undefined && typeof valor.licencias !== "string") ||
      (valor.publicacion !== undefined && typeof valor.publicacion !== "string") ||
      (valor.repositorio !== undefined && typeof valor.repositorio !== "string")
    ) {
      return null;
    }
    return valor;
  } catch {
    return null;
  }
}

function esPar(valor: unknown): valor is ParDeLlaves {
  if (!valor || typeof valor !== "object") return false;
  const par = valor as Record<string, unknown>;
  return typeof par.publica === "string" && typeof par.privada === "string";
}

function esCredencialDeResponsable(valor: unknown): valor is Credencial {
  if (!valor || typeof valor !== "object") return false;
  const credencial = valor as Record<string, unknown>;
  return (
    credencial.tipo === "pin" &&
    credencial.algoritmo === "PBKDF2-SHA256" &&
    typeof credencial.empleado_id === "string" &&
    credencial.empleado_id === USUARIO_RESPONSABLE_ID &&
    typeof credencial.iteraciones === "number" &&
    Number.isInteger(credencial.iteraciones) &&
    credencial.iteraciones > 0 &&
    typeof credencial.sal === "string" &&
    credencial.sal.length > 0 &&
    typeof credencial.hash === "string" &&
    credencial.hash.length > 0 &&
    typeof credencial.creada_ts === "number" &&
    Number.isFinite(credencial.creada_ts)
  );
}

function esResponsablesProtegidos(valor: unknown): valor is Record<string, ResponsableProtegido> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  return Object.values(valor as Record<string, unknown>).every((responsable) => {
    if (!responsable || typeof responsable !== "object") return false;
    const dato = responsable as Record<string, unknown>;
    return (
      typeof dato.provision_id === "string" &&
      dato.provision_id.length > 0 &&
      esCredencialDeResponsable(dato.credencial)
    );
  });
}

function decodificarSecretos(texto: string): SecretosProtegidos | null {
  try {
    const valor = JSON.parse(texto) as Partial<SecretosProtegidos>;
    if (!valor || valor.formato !== 2 || typeof valor.repositorio !== "string") return null;
    if ((valor.licencias !== undefined && !esPar(valor.licencias)) ||
      (valor.publicacion !== undefined && !esPar(valor.publicacion)) ||
      (valor.relay_url !== undefined && typeof valor.relay_url !== "string") ||
      (valor.relay_clave_admin !== undefined && typeof valor.relay_clave_admin !== "string") ||
      (valor.responsables !== undefined && !esResponsablesProtegidos(valor.responsables))) {
      return null;
    }
    return valor as SecretosProtegidos;
  } catch {
    return null;
  }
}

/** La cartera se puede respaldar: los hashes de acceso se quedan en DPAPI. */
function licenciaParaCartera(licencia: Licencia): Licencia {
  const { soporte: _soporte, responsable: _responsable, ...publica } = licencia;
  return publica;
}

function carteraSinCredenciales(clientes: readonly ClienteMotRest[]): ClienteMotRest[] {
  return clientes.map((cliente) => ({
    ...cliente,
    ...(cliente.licencia ? { licencia: licenciaParaCartera(cliente.licencia) } : {}),
  }));
}

async function cargarProtegidos(): Promise<string | null> {
  if (!isTauri()) return secretosDeDesarrollo;
  return invoke<string | null>("cargar_secretos");
}

async function guardarProtegidos(secretos: SecretosProtegidos): Promise<void> {
  const texto = JSON.stringify(secretos);
  if (!isTauri()) {
    /* El navegador de desarrollo es deliberadamente efímero, nunca localStorage. */
    secretosDeDesarrollo = texto;
    return;
  }
  await invoke("guardar_secretos", { secretos: texto });
}

function esUrlGitHubSegura(texto: string): boolean {
  try {
    const url = new URL(texto);
    return (
      url.protocol === "https:" &&
      [
        "github.com",
        "api.github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "github-releases.githubusercontent.com",
      ].includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export class StoreCentral {
  clientes = $state<ClienteMotRest[]>(
    carteraSinCredenciales(leer(LLAVE_CARTERA, [] as ClienteMotRest[])),
  );
  pulsos = $state<PulsoCliente[]>(leer(LLAVE_PULSOS, [] as PulsoCliente[]));
  /** Los últimos partes de cada local. Contesta «¿desde cuándo va mal?». */
  historial = $state<Record<string, PulsoCliente[]>>(
    leer(LLAVE_HISTORIAL, {} as Record<string, PulsoCliente[]>),
  );
  /** Lo último que se firmó, para vigilar cómo lo va bajando la flota. */
  ultimaPublicacion = $state<PublicacionVigilada | null>(
    leer(LLAVE_PUBLICACION, null as PublicacionVigilada | null),
  );
  /** El parte del propio relay. `null` = todavía no se le ha preguntado. */
  saludRelay = $state<SaludRelay | null>(null);
  /** Solo públicas, repo y hash de soporte: nunca una privada. */
  secretos = $state<Secretos>(vistaDe(vacio()));
  estadoSecretos = $state<EstadoSecretos>("cargando");
  migracionPendiente = $state<MigracionPendiente | null>(null);
  errorSecretos = $state("");

  /** Se refresca cada minuto para que "vence en 3 días" no se quede clavado. */
  ahora = $state(Date.now());

  /** Cuándo se habló por última vez con el relay, y cómo fue. */
  consultandoPulsos = $state(false);
  ultimaConsultaPulsos = $state<number | null>(null);
  errorPulsos = $state("");

  private protegidos: SecretosProtegidos = vacio();
  private inicializacion: Promise<void> | null = null;
  /** Evita que dos clics firmen el mismo `publicado_ts` antes de persistirlo. */
  private firmandoActualizacion = false;
  private sondeo: ReturnType<typeof setInterval> | null = null;

  constructor(activarReloj = true) {
    if (activarReloj && typeof setInterval !== "undefined") {
      setInterval(() => (this.ahora = Date.now()), 60_000);
    }
  }

  private refrescarVista(): void {
    this.secretos = vistaDe(this.protegidos);
  }

  private estadoListo(): EstadoSecretos {
    return isTauri() ? "listo" : "desarrollo";
  }

  /** Carga DPAPI una vez al abrir Central. */
  async inicializarSecretos(): Promise<void> {
    if (this.inicializacion) return this.inicializacion;
    this.inicializacion = this.cargarSecretos();
    return this.inicializacion;
  }

  private async cargarSecretos(): Promise<void> {
    this.estadoSecretos = "cargando";
    this.errorSecretos = "";
    try {
      const texto = await cargarProtegidos();
      if (texto) {
        const secretos = decodificarSecretos(texto);
        if (!secretos) throw new Error("El almacén protegido no tiene el formato Ed25519 esperado");
        this.protegidos = secretos;
        this.refrescarVista();
        /* Si un guardado anterior alcanzó DPAPI pero no a borrar HMAC, remátalo ahora. */
        borrarLegado();
        this.estadoSecretos = this.estadoListo();
        return;
      }

      const legado = leerLegado();
      if (legado) {
        /* Un secreto HMAC no se convierte en una llave Ed25519: se reemplaza. */
        this.protegidos = {
          formato: 2,
          repositorio: legado.repositorio ?? "",
          ...(legado.soporte ? { soporte: legado.soporte } : {}),
        };
        this.refrescarVista();
        this.migracionPendiente = {
          habia_licencias: Boolean(legado.licencias?.trim()),
          habia_publicacion: Boolean(legado.publicacion?.trim()),
        };
        this.estadoSecretos = "migracion";
        return;
      }

      this.protegidos = vacio();
      this.refrescarVista();
      this.estadoSecretos = this.estadoListo();
    } catch (causa) {
      this.estadoSecretos = "error";
      this.errorSecretos = String(causa);
    }
  }

  private async reemplazarProtegidos(siguiente: SecretosProtegidos): Promise<Resultado> {
    const bloqueo = this.bloqueoDeEscritura();
    if (bloqueo) return { ok: false, error: bloqueo };

    const anterior = this.protegidos;
    this.protegidos = siguiente;
    this.refrescarVista();
    try {
      await guardarProtegidos(siguiente);
      return { ok: true };
    } catch (causa) {
      this.protegidos = anterior;
      this.refrescarVista();
      this.estadoSecretos = "error";
      this.errorSecretos = String(causa);
      return { ok: false, error: `No se pudieron guardar las llaves con DPAPI: ${String(causa)}` };
    }
  }

  /** No sobrescribas un almacén que todavía se está leyendo, ni uno que falló al abrir. */
  private bloqueoDeEscritura(): string | null {
    if (this.estadoSecretos === "cargando") {
      return "Central todavía está abriendo el almacén DPAPI; espere un momento";
    }
    if (this.estadoSecretos === "error") {
      return "Central no pudo abrir el almacén DPAPI; restaure un respaldo o resuelva el error antes de cambiar llaves";
    }
    return null;
  }

  /** ¿Está listo para emitir licencias? */
  get configurado(): boolean {
    return Boolean(this.protegidos.licencias?.privada);
  }

  get puedePublicar(): boolean {
    return Boolean(this.protegidos.publicacion?.privada);
  }

  // --- Altas y bajas --------------------------------------------------------------------

  async alta(datos: {
    nombre: string;
    sufijo?: string;
    contacto: string;
    telefono?: string;
    correo?: string;
    plan: Plan;
    cuota: Centavos;
    id?: string;
  }): Promise<ResultadoAlta> {
    const id = datos.id?.trim() || idDeSucursal(datos.nombre, datos.sufijo);
    const responsable = datos.contacto.trim();

    if (!datos.nombre.trim()) return { ok: false, error: "Falta el nombre del restaurante" };
    if (responsable.length < 2) {
      return { ok: false, error: "Falta el nombre del responsable del restaurante" };
    }
    if (this.clientes.some((c) => c.id === id)) {
      return { ok: false, error: `Ya existe un local con el identificador ${id}` };
    }

    const preparado = await this.prepararResponsable(id, responsable);
    if (!preparado.ok) return preparado;

    const cliente: ClienteMotRest = {
      id,
      nombre: datos.nombre.trim(),
      contacto: responsable,
      responsable: preparado.responsable,
      telefono: datos.telefono?.trim() || undefined,
      correo: datos.correo?.trim() || undefined,
      plan: datos.plan,
      cuota: datos.cuota,
      alta_ts: Date.now(),
      licencia: null,
      activo: true,
    };

    this.clientes = [...this.clientes, cliente];
    this.guardarCartera();
    return {
      ok: true,
      cliente,
      credencialesResponsable: preparado.credencialesResponsable,
    };
  }

  actualizar(id: string, cambios: Partial<ClienteMotRest>): void {
    this.clientes = this.clientes.map((c) => (c.id === id ? { ...c, ...cambios } : c));
    this.guardarCartera();
  }

  /**
   * Corrige la ficha de un local ya dado de alta.
   *
   * EL IDENTIFICADOR NO ESTÁ AQUÍ, y es a propósito: el `sucursal_id` va dentro
   * de la licencia firmada y el Hub del local comprueba que coincida con el
   * suyo. Cambiarlo desde una pantalla de edición no renombraría al restaurante,
   * lo dejaría sin licencia válida y sin ninguna pista de por qué.
   *
   * Lo demás sí se corrige: un teléfono se equivoca al teclearlo, un responsable
   * se va, y una cuota se renegocia. Lo que cambia aquí surte efecto en la
   * SIGUIENTE licencia que se emita — la que ya está en el local lleva dentro,
   * firmados, el nombre y el plan del día en que se emitió.
   */
  editar(
    id: string,
    cambios: {
      nombre?: string;
      contacto?: string;
      telefono?: string;
      correo?: string;
      plan?: Plan;
      cuota?: Centavos;
      notas?: string;
    },
  ): { ok: true; avisos: string[] } | { ok: false; error: string } {
    const cliente = this.clientes.find((c) => c.id === id);
    if (!cliente) return { ok: false, error: "No existe ese local" };

    const nombre = cambios.nombre?.trim() ?? cliente.nombre;
    const contacto = cambios.contacto?.trim() ?? cliente.contacto;
    const cuota = cambios.cuota ?? cliente.cuota;
    const plan = cambios.plan ?? cliente.plan;

    if (!nombre) return { ok: false, error: "El restaurante necesita un nombre" };
    if (contacto.length < 2) {
      return { ok: false, error: "Falta el nombre del responsable del restaurante" };
    }
    if (!Number.isInteger(cuota) || cuota < 0) {
      return { ok: false, error: "La cuota tiene que ser una cantidad de cero para arriba" };
    }

    /*
     * El nombre del responsable vive en dos sitios y los dos tienen que moverse:
     * `contacto` es a quién se le llama, y `responsable.nombre` es cómo se llama
     * la cuenta de Propietario dentro del restaurante. Dejar uno de los dos sin
     * cambiar es cómo se acaba llamando por teléfono a alguien que ya no trabaja
     * ahí mientras el POS sigue saludando con su nombre.
     *
     * Lo que NO se toca es su `provision_id` ni su PIN: renombrar al responsable
     * no es cambiar de responsable. Para eso está restablecer el acceso.
     */
    const responsable = cliente.responsable
      ? { ...cliente.responsable, nombre: contacto }
      : undefined;

    const avisos: string[] = [];
    if (cliente.licencia) {
      if (contacto !== cliente.contacto) {
        avisos.push(
          "El nombre del responsable llega al restaurante con la próxima licencia que emita.",
        );
      }
      if (plan !== cliente.plan || cuota !== cliente.cuota) {
        avisos.push("El plan nuevo se aplica al renovar; la licencia actual mantiene su vencimiento.");
      }
    }

    this.actualizar(id, {
      nombre,
      contacto,
      plan,
      cuota,
      ...(responsable ? { responsable } : {}),
      /* Vacío quiere decir «bórralo», no «déjalo como estaba». */
      telefono: (cambios.telefono ?? cliente.telefono ?? "").trim() || undefined,
      correo: (cambios.correo ?? cliente.correo ?? "").trim() || undefined,
      notas: (cambios.notas ?? cliente.notas ?? "").trim() || undefined,
    });

    return { ok: true, avisos };
  }

  baja(id: string): void {
    this.actualizar(id, { activo: false });
  }

  // --- El dinero que entró de verdad ------------------------------------------------------

  /**
   * Anota un cobro que ya se recibió.
   *
   * EMITIR NO ES COBRAR, y confundirlos era el agujero más caro del panel. Antes
   * la única huella de un cobro era el vencimiento de la licencia: si se renovaba
   * de confianza mientras el restaurantero pagaba «la semana que entra», Central
   * lo enseñaba al corriente y ese dinero no lo reclamaba nadie nunca.
   */
  registrarPago(
    id: string,
    datos: { monto: Centavos; metodo: MetodoDePago; nota?: string; resultado_id?: string },
    ahora = Date.now(),
  ): { ok: true; pago: PagoCliente } | { ok: false; error: string } {
    const cliente = this.clientes.find((c) => c.id === id);
    if (!cliente) return { ok: false, error: "No existe ese local" };
    if (!Number.isInteger(datos.monto) || datos.monto <= 0) {
      return { ok: false, error: "El cobro tiene que ser una cantidad mayor que cero" };
    }

    const pago: PagoCliente = {
      id: uuidv7(),
      ts: ahora,
      monto: datos.monto,
      metodo: datos.metodo,
      /* Deja constancia de hasta cuándo quedó cubierto, según la licencia vigente. */
      ...(cliente.licencia ? { cubre_hasta_ts: cliente.licencia.vence_ts } : {}),
      ...(datos.resultado_id ? { resultado_id: datos.resultado_id } : {}),
      ...(datos.nota?.trim() ? { nota: datos.nota.trim() } : {}),
    };

    this.actualizar(id, { pagos: [...(cliente.pagos ?? []), pago] });
    return { ok: true, pago };
  }

  /** Un cobro mal anotado se borra; lo que no se puede es editarlo en silencio. */
  borrarPago(id: string, pagoId: string): void {
    const cliente = this.clientes.find((c) => c.id === id);
    if (!cliente) return;
    this.actualizar(id, { pagos: (cliente.pagos ?? []).filter((p) => p.id !== pagoId) });
  }

  // --- El cobro por resultado ---------------------------------------------------------------

  /**
   * Anota un ahorro medido en el restaurante y la parte que le toca a MOTRAE.
   *
   * Es el modelo comercial de la empresa —suscripción **más** cobro por
   * resultado—, y hasta ahora no tenía dónde vivir. Sin un sitio donde anotar el
   * ahorro verificado, la parte variable no se factura y lo que queda es cobrar
   * por licencia a secas, que es justo lo que el principio MOTRAE descarta.
   */
  registrarResultado(
    id: string,
    datos: { concepto: string; ahorro: Centavos; comision_pct: number; verificado?: boolean },
    ahora = Date.now(),
  ): { ok: true; resultado: ResultadoVerificado } | { ok: false; error: string } {
    const cliente = this.clientes.find((c) => c.id === id);
    if (!cliente) return { ok: false, error: "No existe ese local" };

    const concepto = datos.concepto.trim();
    if (concepto.length < 3) {
      return { ok: false, error: "Diga qué se midió: «merma de masa», «horas de más»…" };
    }
    if (!Number.isInteger(datos.ahorro) || datos.ahorro <= 0) {
      return { ok: false, error: "El ahorro tiene que ser una cantidad mayor que cero" };
    }
    if (!(datos.comision_pct > 0 && datos.comision_pct <= 100)) {
      return { ok: false, error: "La comisión va de 1 a 100 por ciento" };
    }

    const resultado: ResultadoVerificado = {
      id: uuidv7(),
      ts: ahora,
      concepto,
      ahorro: datos.ahorro,
      comision_pct: datos.comision_pct,
      verificado: datos.verificado ?? false,
      cobrado: false,
    };

    this.actualizar(id, { resultados: [...(cliente.resultados ?? []), resultado] });
    return { ok: true, resultado };
  }

  /** Marca como verificado un ahorro que el restaurantero ya reconoció. */
  verificarResultado(id: string, resultadoId: string, verificado = true): void {
    const cliente = this.clientes.find((c) => c.id === id);
    if (!cliente) return;
    this.actualizar(id, {
      resultados: (cliente.resultados ?? []).map((r) =>
        r.id === resultadoId ? { ...r, verificado } : r,
      ),
    });
  }

  /**
   * Cobra la comisión de un resultado: la marca cobrada y anota el pago.
   *
   * Las dos cosas van juntas a propósito. Marcarlo cobrado sin registrar el pago
   * dejaría la comisión fuera de «lo que entró este mes», que es exactamente la
   * cifra que este trabajo existe para mover.
   */
  cobrarResultado(
    id: string,
    resultadoId: string,
    metodo: MetodoDePago = "transferencia",
    ahora = Date.now(),
  ): { ok: true; pago: PagoCliente } | { ok: false; error: string } {
    const cliente = this.clientes.find((c) => c.id === id);
    const resultado = cliente?.resultados?.find((r) => r.id === resultadoId);
    if (!cliente || !resultado) return { ok: false, error: "No existe ese resultado" };
    if (!resultado.verificado) {
      return { ok: false, error: "Un ahorro sin verificar no se cobra: primero acuérdelo con el local" };
    }
    if (resultado.cobrado) return { ok: false, error: "Esa comisión ya se cobró" };

    const anotado = this.registrarPago(
      id,
      {
        monto: comisionDeResultado(resultado),
        metodo,
        resultado_id: resultado.id,
        nota: `Cobro por resultado — ${resultado.concepto}`,
      },
      ahora,
    );
    if (!anotado.ok) return anotado;

    const despues = this.clientes.find((c) => c.id === id);
    this.actualizar(id, {
      resultados: (despues?.resultados ?? []).map((r) =>
        r.id === resultadoId ? { ...r, cobrado: true } : r,
      ),
    });
    return anotado;
  }

  /** El texto que se le manda al restaurantero para cobrarle. */
  mensajeDeCobroDe(cliente: ClienteMotRest, dinero: (c: Centavos) => string): string {
    return mensajeDeCobro(cliente, this.situacionDe(cliente), dinero);
  }

  totalPagadoPor(cliente: ClienteMotRest): Centavos {
    return totalPagadoPor(cliente);
  }

  /**
   * Crea o restablece el PIN de un responsable. La parte persistida se queda
   * en el almacén DPAPI de Central; el PIN en claro solo vive hasta que la UI lo
   * muestra una vez a quien lo va a entregar.
   */
  private async prepararResponsable(
    sucursalId: string,
    nombre: string,
  ): Promise<
    | {
        ok: true;
        responsable: PerfilResponsable;
        credencialesResponsable: CredencialesResponsableIniciales;
      }
    | { ok: false; error: string }
  > {
    const limpio = nombre.trim();
    if (limpio.length < 2) {
      return { ok: false, error: "Falta el nombre del responsable del restaurante" };
    }

    const pin = generarPinSeguro(8);
    const credencial = await crearCredencial(USUARIO_RESPONSABLE_ID, pin, "pin");
    const provision_id = uuidv7();
    const guardado = await this.reemplazarProtegidos({
      ...this.protegidos,
      responsables: {
        ...this.protegidos.responsables,
        [sucursalId]: { provision_id, credencial },
      },
    });
    if (!guardado.ok) return guardado;

    return {
      ok: true,
      responsable: {
        id: USUARIO_RESPONSABLE_ID,
        nombre: limpio,
        puesto: PUESTO_RESPONSABLE,
        provision_id,
      },
      credencialesResponsable: { pin },
    };
  }

  // --- Licencias y publicaciones --------------------------------------------------------

  async emitir(
    id: string,
    opciones: { meses?: number; bloqueo_inmediato?: boolean } = {},
  ): Promise<ResultadoConLicencia> {
    const privada = this.protegidos.licencias?.privada;
    if (!privada) {
      return { ok: false, error: "Falta la llave privada Ed25519 de licencias (ver Llaves)" };
    }

    let cliente = this.clientes.find((c) => c.id === id);
    if (!cliente) return { ok: false, error: "No existe ese local" };

    let responsable = cliente.responsable;
    let protegido = this.protegidos.responsables?.[id];
    let credencialesResponsable: CredencialesResponsableIniciales | undefined;

    /*
     * Los locales dados de alta antes de esta versión no traen responsable.
     * Al reemitir su primera licencia se prepara usando el contacto ya capturado
     * y se devuelve el PIN una sola vez, para que Rodizio y los demás migren sin
     * borrar su historial ni registrar un restaurante duplicado.
     */
    if (!responsable || !protegido || protegido.provision_id !== responsable.provision_id) {
      const preparado = await this.prepararResponsable(id, responsable?.nombre || cliente.contacto);
      if (!preparado.ok) return preparado;
      responsable = preparado.responsable;
      protegido = this.protegidos.responsables?.[id];
      credencialesResponsable = preparado.credencialesResponsable;
      cliente = { ...cliente, responsable };
      this.actualizar(id, { responsable });
    }
    if (!protegido) {
      return { ok: false, error: "No se pudo preparar el acceso del responsable" };
    }

    const vence_ts = siguienteVencimiento(
      cliente.licencia?.vence_ts ?? null,
      cliente.plan,
      Date.now(),
    );

    const licencia = await emitirLicencia(
      {
        sucursal_id: cliente.id,
        nombre: cliente.nombre,
        plan: cliente.plan,
        vence_ts,
        gracia_dias: 3,
        emitida_ts: Date.now(),
        ...(this.protegidos.soporte ? { soporte: this.protegidos.soporte } : {}),
        responsable: { ...responsable, credencial: protegido.credencial },
        ...(opciones.bloqueo_inmediato ? { bloqueo_inmediato: true } : {}),
      },
      privada,
    );

    /*
     * Se guarda TAMBIÉN en el historial, no solo como «la última».
     *
     * Cuando un restaurantero discute qué se le emitió y cuándo, o cuando hay que
     * reconstruir por qué un local se quedó bloqueado un viernes, la última
     * licencia no contesta nada: es justo la que borró la respuesta.
     */
    const emision: EmisionLicencia = {
      ts: licencia.emitida_ts,
      plan: cliente.plan,
      vence_ts,
      cuota: cliente.cuota,
      ...(opciones.bloqueo_inmediato ? { bloqueo_inmediato: true } : {}),
    };

    this.actualizar(id, {
      licencia: licenciaParaCartera(licencia),
      emisiones: [...(cliente.emisiones ?? []), emision],
    });
    return { ok: true, licencia, ...(credencialesResponsable ? { credencialesResponsable } : {}) };
  }

  /**
   * Corta el servicio de un local AHORA, sin esperar a que venza.
   *
   * Esto ya se podía firmar —`emitir` acepta `bloqueo_inmediato` desde siempre—
   * pero no había ningún botón que lo pidiera, así que en la práctica no existía:
   * la única forma de cortarle a alguien era esperar semanas a que la licencia
   * venciera sola.
   *
   * Devuelve la licencia igual que una renovación: para que surta efecto hay que
   * pegarla en el local, exactamente como cualquier otra. No es un interruptor
   * remoto, y es importante no venderlo como tal.
   */
  async cortarServicio(id: string): Promise<ResultadoConLicencia> {
    return this.emitir(id, { bloqueo_inmediato: true });
  }

  async firmarActualizacion(
    datos: Omit<VersionDisponible, "firma" | "publicado_ts">,
    ahora = Date.now(),
  ): Promise<ResultadoConManifiesto> {
    const bloqueo = this.bloqueoDeEscritura();
    if (bloqueo) return { ok: false, error: bloqueo };

    const privada = this.protegidos.publicacion?.privada;
    if (!privada) {
      return { ok: false, error: "Falta la llave privada Ed25519 de publicación (ver Llaves)" };
    }
    if (!esUrlGitHubSegura(datos.url)) {
      return { ok: false, error: "El instalador debe usar HTTPS en un host permitido de GitHub" };
    }
    if (!/^[0-9a-f]{64}$/i.test(datos.sha256.trim())) {
      return { ok: false, error: "La huella SHA-256 debe tener 64 caracteres hexadecimales" };
    }
    if (
      datos.version_minima_soportada &&
      compararVersiones(datos.version, datos.version_minima_soportada) < 0
    ) {
      return { ok: false, error: "La versión mínima no puede ser posterior a la versión publicada" };
    }
    /*
     * Un anillo mal escrito no se puede corregir después: el manifiesto va
     * firmado y los Hubs que ya lo vieron lo tienen. Un `0` dejaría la versión
     * publicada y sin llegar a nadie, en silencio.
     */
    if (
      datos.anillo !== undefined &&
      (!Number.isInteger(datos.anillo) || datos.anillo < 1 || datos.anillo > 100)
    ) {
      return { ok: false, error: "El anillo es un porcentaje entero de 1 a 100" };
    }

    if (this.firmandoActualizacion) {
      return { ok: false, error: "Ya hay un manifiesto en proceso de firma; espere a que termine" };
    }
    this.firmandoActualizacion = true;

    try {
      const publicado_ts = Math.max(ahora, (this.protegidos.ultimo_publicado_ts ?? 0) + 1);
      const manifiesto = await firmarVersion(
        { ...datos, sha256: datos.sha256.trim().toLowerCase(), publicado_ts },
        privada,
      );
      const guardado = await this.reemplazarProtegidos({
        ...this.protegidos,
        ultimo_publicado_ts: publicado_ts,
      });
      if (!guardado.ok) return { ok: false, error: guardado.error };

      /*
       * Se anota qué se publicó para poder VIGILARLO después.
       *
       * Antes de firmar se veía perfectamente a quién le iba a tocar; después de
       * firmar, nada. Un despliegue por anillos que nadie mira es el mismo
       * «publicar y rezar» de siempre, solo que más despacio: si el canario se
       * rompe y no se mira, la avería llega igual al resto al subir el porcentaje.
       */
      this.ultimaPublicacion = {
        version: manifiesto.version,
        publicado_ts,
        ...(datos.anillo !== undefined ? { anillo: datos.anillo } : {}),
        ...(datos.obligatoria ? { obligatoria: true } : {}),
      };
      escribir(LLAVE_PUBLICACION, this.ultimaPublicacion);

      return { ok: true, manifiesto };
    } finally {
      this.firmandoActualizacion = false;
    }
  }

  /**
   * Cómo va bajando la última versión publicada.
   *
   * `null` mientras no se haya publicado nada desde esta Central: no hay nada
   * honesto que enseñar sobre un despliegue del que no se sabe ni la versión.
   */
  get adopcion() {
    const publicacion = this.ultimaPublicacion;
    if (!publicacion) return null;
    return adopcionDeVersion(
      this.clientes,
      this.pulsos,
      publicacion.version,
      publicacion.anillo,
      leTocaElAnillo,
    );
  }

  // --- Llaves ---------------------------------------------------------------------------

  /** Genera los DOS pares, separados por propósito, con WebCrypto nativo. */
  async generarPares(): Promise<Resultado> {
    const bloqueo = this.bloqueoDeEscritura();
    if (bloqueo) return { ok: false, error: bloqueo };

    let licencias: ParDeLlaves;
    let publicacion: ParDeLlaves;
    try {
      [licencias, publicacion] = await Promise.all([generarPar(), generarPar()]);
    } catch (causa) {
      return { ok: false, error: `Este equipo no puede generar Ed25519: ${String(causa)}` };
    }

    const resultado = await this.reemplazarProtegidos({
      ...this.protegidos,
      formato: 2,
      licencias,
      publicacion,
    });
    if (resultado.ok) {
      /* Solo se borra HMAC después de que DPAPI confirmó las nuevas privadas. */
      borrarLegado();
      this.migracionPendiente = null;
      this.estadoSecretos = this.estadoListo();
    }
    return resultado;
  }

  async guardarConfiguracion(cambios: {
    repositorio: string;
    relay_url?: string;
    relay_clave_admin?: string;
  }): Promise<Resultado> {
    const url = cambios.relay_url?.trim() ?? this.protegidos.relay_url ?? "";
    /*
     * Solo `https://`. Por aquí viaja la clave de administración del relay —la
     * que abre el estado de toda la cartera— y en claro se la lleva cualquier
     * salto del camino. Un `http://` en la configuración es siempre una prueba
     * que se quedó puesta.
     */
    if (url && !/^https:\/\//i.test(url)) {
      return { ok: false, error: "La dirección del relay tiene que ser https://" };
    }

    return this.reemplazarProtegidos({
      ...this.protegidos,
      repositorio: cambios.repositorio.trim(),
      ...(cambios.relay_url !== undefined ? { relay_url: url } : {}),
      ...(cambios.relay_clave_admin !== undefined
        ? { relay_clave_admin: cambios.relay_clave_admin.trim() }
        : {}),
    });
  }

  /** ¿Se puede preguntar al relay cómo están los locales? */
  get puedeConsultarRelay(): boolean {
    return Boolean(this.protegidos.relay_url && this.protegidos.relay_clave_admin);
  }

  /**
   * Trae de una vez el último parte de todos los restaurantes.
   *
   * Es lo que quita la ceguera antes de publicar: qué versión corre cada local y
   * cuándo dio señales. Sustituye por completo lo que hubiera de cada sucursal —
   * el pulso es un estado actual, no un historial.
   *
   * Lo que no llegue se queda como estaba. Un relay caído no puede convertir a
   * toda la cartera en «nunca reportó», que se leería como una avería masiva.
   */
  async traerPulsos(): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
    const url = this.protegidos.relay_url;
    const clave = this.protegidos.relay_clave_admin;
    if (!url || !clave) {
      return { ok: false, error: "Falta la dirección del relay o su clave de administración" };
    }
    /* Dos consultas a la vez solo duplican el gasto: la segunda trae lo mismo. */
    if (this.consultandoPulsos) return { ok: false, error: "Ya se está consultando el relay" };
    this.consultandoPulsos = true;

    try {
      const respuesta = await fetch(new URL("/pulsos", url), {
        headers: { authorization: `Bearer ${clave}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (respuesta.status === 401) {
        return this.falloDePulsos("El relay rechazó la clave de administración");
      }
      if (!respuesta.ok) {
        return this.falloDePulsos(`El relay respondió ${respuesta.status}`);
      }

      const datos = (await respuesta.json()) as { pulsos?: PulsoCliente[] };
      if (!Array.isArray(datos.pulsos)) {
        return this.falloDePulsos("El relay contestó algo que no son pulsos");
      }

      for (const pulso of datos.pulsos) {
        if (pulso?.sucursal_id && typeof pulso.version === "string") this.recibirPulso(pulso);
      }
      this.ultimaConsultaPulsos = Date.now();
      this.errorPulsos = "";
      return { ok: true, total: datos.pulsos.length };
    } catch (causa) {
      return this.falloDePulsos(`No se pudo hablar con el relay: ${String(causa)}`);
    } finally {
      this.consultandoPulsos = false;
    }
  }

  private falloDePulsos(error: string): { ok: false; error: string } {
    this.errorPulsos = error;
    return { ok: false, error };
  }

  /**
   * Cada cuánto Central le vuelve a preguntar al relay cómo está la cartera.
   *
   * Diez minutos y no uno: el Hub reporta una vez al día, así que preguntar más
   * seguido no adelanta nada y solo hace ruido contra el relay. Y diez y no una
   * hora porque el momento en que esto importa es justo después de publicar una
   * actualización, mirando la pantalla a ver si el canario ya subió de versión.
   */
  static readonly SONDEO_PULSOS_MS = 10 * 60 * 1000;

  /**
   * Mantiene sola la versión instalada de cada local.
   *
   * Antes había que acordarse de pulsar el botón de refrescar, y una cifra que
   * hay que acordarse de refrescar es una cifra en la que no se puede confiar:
   * «Rodizio tiene la 1.2.0» podía ser de hace tres semanas y parecía de hoy.
   */
  arrancarSondeoDePulsos(): void {
    if (this.sondeo || typeof setInterval === "undefined") return;
    void this.sondearSiSePuede();
    this.sondeo = setInterval(() => void this.sondearSiSePuede(), StoreCentral.SONDEO_PULSOS_MS);
  }

  private async sondearSiSePuede(): Promise<void> {
    if (!this.puedeConsultarRelay || this.consultandoPulsos) return;
    await this.traerPulsos();
    await this.traerSaludRelay();
  }

  /**
   * Cómo está el propio relay.
   *
   * Es la única pieza de MOTRAE conectada a internet y hasta ahora Central no la
   * miraba: si el relay se caía, lo que se veía aquí era «todos los locales
   * llevan horas sin reportar», que se lee como una avería masiva en los
   * restaurantes cuando en realidad todos están vendiendo tan tranquilos. Saber
   * que el caído es el relay cambia por completo a quién hay que llamar.
   */
  async traerSaludRelay(): Promise<{ ok: true } | { ok: false; error: string }> {
    const url = this.protegidos.relay_url;
    const clave = this.protegidos.relay_clave_admin;
    if (!url || !clave) {
      return { ok: false, error: "Falta la dirección del relay o su clave de administración" };
    }

    try {
      const respuesta = await fetch(new URL("/salud/detalle", url), {
        headers: { authorization: `Bearer ${clave}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!respuesta.ok) {
        this.saludRelay = null;
        return { ok: false, error: `El relay respondió ${respuesta.status}` };
      }

      const datos = (await respuesta.json()) as Partial<SaludRelay> & { ts?: number };
      this.saludRelay = {
        restaurantes: datos.restaurantes ?? 0,
        hubs_conectados: datos.hubs_conectados ?? 0,
        pulsos: datos.pulsos ?? 0,
        consultado_ts: Date.now(),
      };
      return { ok: true };
    } catch (causa) {
      this.saludRelay = null;
      return { ok: false, error: `No se pudo hablar con el relay: ${String(causa)}` };
    }
  }

  detenerSondeoDePulsos(): void {
    if (this.sondeo) clearInterval(this.sondeo);
    this.sondeo = null;
  }

  async fijarContrasenaSoporte(contrasena: string): Promise<Resultado> {
    if (contrasena.length < 12) {
      return {
        ok: false,
        error:
          "Mínimo 12 caracteres: esta contraseña abre TODOS los restaurantes, no es un PIN de caja",
      };
    }

    const credencial = await crearCredencial("usr-motrae-soporte", contrasena, "contrasena");
    return this.reemplazarProtegidos({
      ...this.protegidos,
      soporte: {
        sal: credencial.sal,
        hash: credencial.hash,
        iteraciones: credencial.iteraciones,
      },
      /* La fecha es lo que permite saber después a qué locales ya les llegó. */
      soporte_fijado_ts: credencial.creada_ts,
    });
  }

  /**
   * Los locales que siguen aceptando la contraseña de soporte ANTERIOR.
   *
   * La contraseña va firmada dentro de la licencia, así que cambiarla aquí no
   * cambia nada en ningún restaurante hasta reemitir. El día que haya que
   * rotarla de urgencia —se filtró, o se fue alguien que la sabía— ésta es la
   * única pregunta que importa, y antes había que reemitir a ciegas y confiar.
   */
  get localesConSoportePendiente(): ClienteMotRest[] {
    return localesConSoporteViejo(this.clientes, this.protegidos.soporte_fijado_ts);
  }

  /**
   * El respaldo que SÍ sobrevive a que muera esta computadora.
   *
   * El respaldo DPAPI de abajo solo se puede restaurar en este mismo perfil de
   * Windows. Es lo correcto mientras la máquina exista, y es también el mayor
   * riesgo abierto del producto: si el equipo se pierde, se quema o Windows se
   * reinstala, ese archivo no abre en ninguna parte y con él se va la llave con
   * la que se firman las licencias y las actualizaciones de TODOS los
   * restaurantes. No se puede regenerar: habría que reinstalar cada local a mano
   * con un Hub nuevo compilado contra otra pública.
   *
   * Éste se cifra con una contraseña que Gonzalo se sabe, así que se puede
   * guardar fuera —otra máquina, una caja fuerte, un gestor de contraseñas— y
   * abrir en otro equipo. El archivo y la contraseña viajan por separado o no se
   * ha respaldado nada.
   */
  async respaldoPortatil(
    contrasena: string,
  ): Promise<{ ok: true; respaldo: string } | { ok: false; error: string }> {
    if (!this.protegidos.licencias?.privada && !this.protegidos.publicacion?.privada) {
      return { ok: false, error: "Todavía no hay llaves que respaldar" };
    }

    let respaldo: string;
    try {
      const cofre = await cerrarCofre(JSON.stringify(this.protegidos), contrasena);
      respaldo = JSON.stringify(cofre, null, 2);
    } catch (causa) {
      return { ok: false, error: String(causa instanceof Error ? causa.message : causa) };
    }

    /*
     * La fecha se guarda solo si el cofre se cerró bien. Anotarla antes haría que
     * Central dijera «respaldado hoy» después de un intento fallido, que es la
     * peor forma posible de perder unas llaves.
     */
    const guardado = await this.reemplazarProtegidos({
      ...this.protegidos,
      ultimo_respaldo_ts: Date.now(),
    });
    if (!guardado.ok) return { ok: false, error: guardado.error };

    return { ok: true, respaldo };
  }

  /** Restaura un cofre en ESTA máquina, que puede no ser la de origen. */
  async restaurarPortatil(respaldo: string, contrasena: string): Promise<Resultado> {
    let cofre: unknown;
    try {
      cofre = JSON.parse(respaldo);
    } catch {
      return { ok: false, error: "Ese archivo no es un respaldo de MotRest Central" };
    }

    const claro = await abrirCofre(cofre, contrasena);
    if (claro === null) {
      return {
        ok: false,
        error: "La contraseña no abre ese respaldo, o el archivo está alterado",
      };
    }

    const protegidos = decodificarSecretos(claro);
    if (!protegidos) {
      return { ok: false, error: "El respaldo se abrió pero no contiene llaves Ed25519 válidas" };
    }

    const guardado = await this.reemplazarProtegidos(protegidos);
    if (!guardado.ok) return guardado;

    this.estadoSecretos = this.estadoListo();
    this.migracionPendiente = null;
    borrarLegado();
    return { ok: true };
  }

  /** ¿Hace demasiado que no se saca un respaldo que abra fuera de aquí? */
  get respaldoAlDia(): boolean {
    if (!this.configurado && !this.puedePublicar) return true;
    const ultimo = this.protegidos.ultimo_respaldo_ts;
    if (!ultimo) return false;
    return this.ahora - ultimo < DIAS_ENTRE_RESPALDOS * 86_400_000;
  }

  /** Respaldo DPAPI: cifrado, sin privadas en claro y útil en el mismo perfil Windows. */
  async respaldoDeSecretos(): Promise<{ ok: true; respaldo: string } | { ok: false; error: string }> {
    if (!isTauri()) {
      return { ok: false, error: "El respaldo de llaves requiere la app de escritorio de Central" };
    }
    try {
      const datos = await invoke<number[] | null>("respaldo_de_secretos");
      if (!datos) return { ok: false, error: "Todavía no hay llaves que respaldar" };
      return {
        ok: true,
        respaldo: JSON.stringify(
          { formato: "motrae-central-dpapi-v1", datos },
          null,
          2,
        ),
      };
    } catch (causa) {
      return { ok: false, error: `No se pudo respaldar el almacén DPAPI: ${String(causa)}` };
    }
  }

  async restaurarSecretos(respaldo: string): Promise<Resultado> {
    if (!isTauri()) {
      return { ok: false, error: "La restauración de llaves requiere la app de escritorio de Central" };
    }
    try {
      const objeto = JSON.parse(respaldo) as { formato?: string; datos?: unknown };
      if (
        objeto.formato !== "motrae-central-dpapi-v1" ||
        !Array.isArray(objeto.datos) ||
        !objeto.datos.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
      ) {
        return { ok: false, error: "Ese archivo no es un respaldo DPAPI de MotRest Central" };
      }
      await invoke("restaurar_secretos", { respaldo: objeto.datos });
      const texto = await cargarProtegidos();
      const protegidos = texto ? decodificarSecretos(texto) : null;
      if (!protegidos) return { ok: false, error: "Windows restauró un almacén con formato inválido" };
      this.protegidos = protegidos;
      this.refrescarVista();
      this.estadoSecretos = "listo";
      this.migracionPendiente = null;
      borrarLegado();
      return { ok: true };
    } catch (causa) {
      return { ok: false, error: `No se pudieron restaurar las llaves: ${String(causa)}` };
    }
  }

  // --- Anillos de despliegue -------------------------------------------------------------

  /**
   * La cartera ordenada por su turno en los despliegues.
   *
   * Es la misma cuenta que hace cada Hub sobre sí mismo (`posicionEnLaFlota`),
   * hecha aquí sobre toda la cartera. Sirve para lo que el manifiesto no puede:
   * **ver quién entra antes de firmar**. El manifiesto es público en GitHub y no
   * puede llevar la lista de clientes de MOTRAE, así que lleva un porcentaje; el
   * porcentaje solo es utilizable si desde aquí se ve a quién corresponde.
   *
   * El primero de esta lista es el canario natural: le toca en cuanto el anillo
   * llega a su posición, y le tocará siempre el primero mientras exista.
   */
  get ordenDeDespliegue(): { cliente: ClienteMotRest; posicion: number }[] {
    return this.activos
      .map((cliente) => ({ cliente, posicion: posicionEnLaFlota(cliente.id) }))
      .sort((a, b) => a.posicion - b.posicion || a.cliente.nombre.localeCompare(b.cliente.nombre));
  }

  /** A qué locales de la cartera les llegaría una versión con este anillo. */
  localesEnElAnillo(anillo?: number): ClienteMotRest[] {
    return this.activos.filter((cliente) => leTocaElAnillo(cliente.id, anillo));
  }

  // --- Lo que se ve ---------------------------------------------------------------------

  get resumen() {
    return resumenDeCartera(this.clientes, this.pulsos, this.ahora);
  }

  get pendientes() {
    return pendientesDeHoy(this.clientes, this.pulsos, this.ahora);
  }

  get activos(): ClienteMotRest[] {
    return this.clientes.filter((c) => c.activo);
  }

  pulsoDe(sucursal_id: string): PulsoCliente | null {
    let ultimo: PulsoCliente | null = null;
    for (const p of this.pulsos) {
      if (p.sucursal_id !== sucursal_id) continue;
      if (!ultimo || p.ts > ultimo.ts) ultimo = p;
    }
    return ultimo;
  }

  situacionDe(cliente: ClienteMotRest) {
    return situacionDeCliente(cliente, this.ahora);
  }

  saludDe(cliente: ClienteMotRest) {
    return saludDeCliente(cliente, this.pulsoDe(cliente.id), this.ahora);
  }

  // --- Pulsos, cartera y respaldo no secreto -------------------------------------------

  recibirPulso(pulso: PulsoCliente): void {
    this.pulsos = [...this.pulsos.filter((p) => p.sucursal_id !== pulso.sucursal_id), pulso];
    escribir(LLAVE_PULSOS, this.pulsos);

    /*
     * El pulso es el estado de hoy; el historial es lo que permite contestar
     * «¿desde cuándo?». Se guarda aparte porque son dos cosas distintas: uno se
     * sustituye entero en cada consulta y el otro solo crece.
     */
    const anterior = this.historial[pulso.sucursal_id] ?? [];
    const siguiente = anotarEnHistorial(anterior, pulso);
    if (siguiente.length !== anterior.length) {
      this.historial = { ...this.historial, [pulso.sucursal_id]: siguiente };
      escribir(LLAVE_HISTORIAL, this.historial);
    }
  }

  /** Lo que se sabe de este local a lo largo del tiempo. */
  historiaDe(sucursal_id: string) {
    return historiaDelLocal(this.historial[sucursal_id] ?? [], this.ahora);
  }

  private guardarCartera(): void {
    escribir(LLAVE_CARTERA, carteraSinCredenciales(this.clientes));
  }

  /** Lo cobrado entre dos fechas, para cerrar un mes o comparar contra el anterior. */
  cobradoEntre(desde: number, hasta: number): Centavos {
    return cobradoEnPeriodo(this.clientes, desde, hasta);
  }

  /** La cartera se puede circular; por diseño no contiene material criptográfico. */
  exportar(): string {
    return JSON.stringify(
      {
        clientes: carteraSinCredenciales(this.clientes),
        pulsos: this.pulsos,
        /* Va dentro porque es el historial del negocio, no telemetría desechable. */
        historial: this.historial,
        ...(this.ultimaPublicacion ? { publicacion: this.ultimaPublicacion } : {}),
      },
      null,
      2,
    );
  }

  importar(json: string): Resultado {
    try {
      const datos = JSON.parse(json) as {
        clientes?: ClienteMotRest[];
        pulsos?: PulsoCliente[];
        historial?: Record<string, PulsoCliente[]>;
        publicacion?: PublicacionVigilada;
      };
      if (!Array.isArray(datos.clientes)) return { ok: false, error: "El archivo no trae clientes" };

      this.clientes = carteraSinCredenciales(datos.clientes);
      this.pulsos = datos.pulsos ?? [];
      this.historial = datos.historial ?? {};
      this.ultimaPublicacion = datos.publicacion ?? null;
      this.guardarCartera();
      escribir(LLAVE_PULSOS, this.pulsos);
      escribir(LLAVE_HISTORIAL, this.historial);
      escribir(LLAVE_PUBLICACION, this.ultimaPublicacion);
      return { ok: true };
    } catch {
      return { ok: false, error: "No se pudo leer el archivo" };
    }
  }
}

/** Evita que las pruebas compartan estado criptográfico o temporizadores. */
export function crearCentralParaPruebas(): StoreCentral {
  const store = new StoreCentral(false);
  // Las pruebas no montan Tauri: su almacén efímero ya está listo.
  store.estadoSecretos = "desarrollo";
  return store;
}

export const central = new StoreCentral();
