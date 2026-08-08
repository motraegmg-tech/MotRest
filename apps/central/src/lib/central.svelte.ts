/**
 * El estado de MOTRAE Central.
 *
 * Las privadas Ed25519 nunca se guardan en localStorage: el backend Tauri las
 * cifra con DPAPI antes de escribirlas en `%LOCALAPPDATA%`. Este archivo solo
 * conserva una vista pública para la interfaz; las privadas quedan en un campo
 * no reactivo y no se renderizan ni se copian por accidente.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  compararVersiones,
  crearCredencial,
  emitirLicencia,
  generarPinSeguro,
  firmarVersion,
  generarPar,
  idDeSucursal,
  pendientesDeHoy,
  resumenDeCartera,
  saludDeCliente,
  siguienteVencimiento,
  situacionDeCliente,
  uuidv7,
  PUESTO_RESPONSABLE,
  USUARIO_RESPONSABLE_ID,
  type Centavos,
  type ClienteMotRest,
  type Credencial,
  type CredencialSoporte,
  type Licencia,
  type ParDeLlaves,
  type Plan,
  type PerfilResponsable,
  type PulsoCliente,
  type VersionDisponible,
} from "@motrest/dominio";

const LLAVE_CARTERA = "motrae.central.cartera";
const LLAVE_PULSOS = "motrae.central.pulsos";
/* Solo se lee para migrar la Central antigua; nunca se vuelve a escribir. */
const LLAVE_SECRETOS_LEGADA = "motrae.central.secretos";

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
}

interface SecretosProtegidos {
  formato: 2;
  licencias?: ParDeLlaves;
  publicacion?: ParDeLlaves;
  repositorio: string;
  soporte?: CredencialSoporte;
  /** PINes de responsables, cifrados con DPAPI y nunca en la cartera. */
  responsables?: Record<string, ResponsableProtegido>;
  /** Impide que un reloj atrasado repita un `publicado_ts`. */
  ultimo_publicado_ts?: number;
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
  /** Solo públicas, repo y hash de soporte: nunca una privada. */
  secretos = $state<Secretos>(vistaDe(vacio()));
  estadoSecretos = $state<EstadoSecretos>("cargando");
  migracionPendiente = $state<MigracionPendiente | null>(null);
  errorSecretos = $state("");

  /** Se refresca cada minuto para que "vence en 3 días" no se quede clavado. */
  ahora = $state(Date.now());

  private protegidos: SecretosProtegidos = vacio();
  private inicializacion: Promise<void> | null = null;
  /** Evita que dos clics firmen el mismo `publicado_ts` antes de persistirlo. */
  private firmandoActualizacion = false;

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

  baja(id: string): void {
    this.actualizar(id, { activo: false });
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

    this.actualizar(id, { licencia: licenciaParaCartera(licencia) });
    return { ok: true, licencia, ...(credencialesResponsable ? { credencialesResponsable } : {}) };
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
      return guardado.ok
        ? { ok: true, manifiesto }
        : { ok: false, error: guardado.error };
    } finally {
      this.firmandoActualizacion = false;
    }
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

  async guardarConfiguracion(cambios: { repositorio: string }): Promise<Resultado> {
    return this.reemplazarProtegidos({
      ...this.protegidos,
      repositorio: cambios.repositorio.trim(),
    });
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
    });
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
        return { ok: false, error: "Ese archivo no es un respaldo DPAPI de MOTRAE Central" };
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
  }

  private guardarCartera(): void {
    escribir(LLAVE_CARTERA, carteraSinCredenciales(this.clientes));
  }

  /** La cartera se puede circular; por diseño no contiene material criptográfico. */
  exportar(): string {
    return JSON.stringify({ clientes: carteraSinCredenciales(this.clientes), pulsos: this.pulsos }, null, 2);
  }

  importar(json: string): Resultado {
    try {
      const datos = JSON.parse(json) as { clientes?: ClienteMotRest[]; pulsos?: PulsoCliente[] };
      if (!Array.isArray(datos.clientes)) return { ok: false, error: "El archivo no trae clientes" };

      this.clientes = carteraSinCredenciales(datos.clientes);
      this.pulsos = datos.pulsos ?? [];
      this.guardarCartera();
      escribir(LLAVE_PULSOS, this.pulsos);
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
