/**
 * El estado de MOTRAE Central.
 *
 * DÓNDE VIVE ESTO. En la máquina de Gonzalo, en el almacenamiento del navegador.
 * No hay servidor todavía y es lo correcto para empezar: montar una base de
 * datos en la nube para llevar cinco restaurantes es gastar antes de saber qué
 * se necesita. Cuando la cartera crezca, esto se cambia por el mismo relay que
 * ya recibe los pulsos.
 *
 * ⚠ LO QUE HAY QUE ENTENDER SOBRE ESTA MÁQUINA. Aquí viven los secretos con los
 * que se FIRMAN las licencias y las actualizaciones de todos los restaurantes.
 * Quien los tenga puede emitir licencias gratis y —mucho peor— publicar una
 * actualización que se instala sola en todas las instalaciones. Esta computadora
 * vale más que cualquier otra de MOTRAE:
 *
 *   - Los secretos NUNCA se escriben en el repositorio. Se capturan aquí.
 *   - Conviene tener una copia en un gestor de contraseñas: si se pierden, no se
 *     puede volver a firmar nada y hay que reinstalar todos los locales.
 *   - Si se sospecha que se filtraron, se cambian y se reemiten las licencias.
 *
 * Por eso `respaldoDeSecretos()` existe y `exportar()` NO los incluye.
 */
import {
  crearCredencial,
  emitirLicencia,
  idDeSucursal,
  pendientesDeHoy,
  resumenDeCartera,
  saludDeCliente,
  siguienteVencimiento,
  situacionDeCliente,
  type Centavos,
  type ClienteMotRest,
  type CredencialSoporte,
  type Licencia,
  type Plan,
  type PulsoCliente,
} from "@motrest/dominio";

const LLAVE_CARTERA = "motrae.central.cartera";
const LLAVE_PULSOS = "motrae.central.pulsos";
const LLAVE_SECRETOS = "motrae.central.secretos";

/** Los secretos con los que MOTRAE firma. Jamás salen de esta máquina. */
export interface Secretos {
  /** Con esto se firman las licencias de cada local. */
  licencias: string;
  /** Con esto se firman los manifiestos de actualización. */
  publicacion: string;
  /** Repositorio de GitHub donde se publican los releases. */
  repositorio: string;
  /** Credencial de "Gonz Motrae" — solo el hash, la elige Gonzalo. */
  soporte?: CredencialSoporte;
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

class StoreCentral {
  clientes = $state<ClienteMotRest[]>(leer(LLAVE_CARTERA, [] as ClienteMotRest[]));
  pulsos = $state<PulsoCliente[]>(leer(LLAVE_PULSOS, [] as PulsoCliente[]));
  secretos = $state<Secretos>(
    leer(LLAVE_SECRETOS, { licencias: "", publicacion: "", repositorio: "" } as Secretos),
  );

  /** Se refresca cada minuto para que "vence en 3 días" no se quede clavado. */
  ahora = $state(Date.now());

  constructor() {
    if (typeof setInterval !== "undefined") {
      setInterval(() => (this.ahora = Date.now()), 60_000);
    }
  }

  // --- Lo que se ve ---------------------------------------------------------------------

  get resumen() {
    return resumenDeCartera(this.clientes, this.pulsos, this.ahora);
  }

  /** La lista con la que abre la mañana, ya ordenada por urgencia. */
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

  /** ¿Está listo para emitir licencias y publicar? */
  get configurado(): boolean {
    return this.secretos.licencias.trim().length > 0;
  }

  // --- Altas y bajas --------------------------------------------------------------------

  /**
   * Da de alta un restaurante.
   *
   * NO emite la licencia todavía: primero hay que instalar y ver el
   * `sucursal_id` que generó el Hub. Emitirla aquí a ciegas produce licencias
   * que no verifican en el local, que es el error más frustrante del alta
   * porque no se descubre hasta que ya se está ahí.
   */
  alta(datos: {
    nombre: string;
    sufijo?: string;
    contacto: string;
    telefono?: string;
    correo?: string;
    plan: Plan;
    cuota: Centavos;
    id?: string;
  }): { ok: boolean; error?: string; cliente?: ClienteMotRest } {
    const id = datos.id?.trim() || idDeSucursal(datos.nombre, datos.sufijo);

    if (!datos.nombre.trim()) return { ok: false, error: "Falta el nombre del restaurante" };
    if (this.clientes.some((c) => c.id === id)) {
      return { ok: false, error: `Ya existe un local con el identificador ${id}` };
    }

    const cliente: ClienteMotRest = {
      id,
      nombre: datos.nombre.trim(),
      contacto: datos.contacto.trim(),
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
    return { ok: true, cliente };
  }

  actualizar(id: string, cambios: Partial<ClienteMotRest>): void {
    this.clientes = this.clientes.map((c) => (c.id === id ? { ...c, ...cambios } : c));
    this.guardarCartera();
  }

  /**
   * Da de baja un local. NO lo borra.
   *
   * Un cliente que se fue sigue siendo historia del negocio, y volver a darlo de
   * alta el día que regrese vale más que la línea que ahorra borrarlo.
   */
  baja(id: string): void {
    this.actualizar(id, { activo: false });
  }

  // --- Licencias ------------------------------------------------------------------------

  /**
   * Emite o renueva la licencia de un local.
   *
   * Lleva dentro la credencial de soporte, que es lo que hace que "Gonz Motrae"
   * exista en ese MotRest. Sin secreto de firma no se emite nada: una licencia
   * sin firmar no la acepta ningún Hub, y dejarla generar solo produce archivos
   * inútiles que alguien va a intentar instalar.
   */
  async emitir(
    id: string,
    opciones: { meses?: number; bloqueo_inmediato?: boolean } = {},
  ): Promise<{ ok: boolean; error?: string; licencia?: Licencia }> {
    if (!this.secretos.licencias.trim()) {
      return { ok: false, error: "Falta el secreto de firma de licencias (ver Llaves)" };
    }

    const cliente = this.clientes.find((c) => c.id === id);
    if (!cliente) return { ok: false, error: "No existe ese local" };

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
        ...(this.secretos.soporte ? { soporte: this.secretos.soporte } : {}),
        ...(opciones.bloqueo_inmediato ? { bloqueo_inmediato: true } : {}),
      },
      this.secretos.licencias,
    );

    this.actualizar(id, { licencia });
    return { ok: true, licencia };
  }

  // --- Secretos -------------------------------------------------------------------------

  guardarSecretos(cambios: Partial<Secretos>): void {
    this.secretos = { ...this.secretos, ...cambios };
    escribir(LLAVE_SECRETOS, this.secretos);
  }

  /**
   * Fija la contraseña de "Gonz Motrae". La elige Gonzalo, aquí y en ningún
   * otro sitio.
   *
   * Se guarda SOLO el hash PBKDF2. De un hash no se recupera la contraseña, así
   * que ni siquiera esta máquina la tiene: si se olvida, se pone otra y se
   * reemiten las licencias.
   *
   * Ese hash viaja dentro de la licencia firmada de cada local, y por ir firmado
   * ningún restaurante puede sustituirlo por uno propio para entrar como MOTRAE.
   */
  async fijarContrasenaSoporte(
    contrasena: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (contrasena.length < 12) {
      return {
        ok: false,
        error:
          "Mínimo 12 caracteres: esta contraseña abre TODOS los restaurantes, " +
          "no es un PIN de caja",
      };
    }

    const credencial = await crearCredencial("usr-motrae-soporte", contrasena, "contrasena");
    this.guardarSecretos({
      soporte: {
        sal: credencial.sal,
        hash: credencial.hash,
        iteraciones: credencial.iteraciones,
      },
    });
    return { ok: true };
  }

  // --- Pulsos ---------------------------------------------------------------------------

  /** Lo que reporta cada Hub. Entra por el relay. */
  recibirPulso(pulso: PulsoCliente): void {
    // Solo el último de cada local: guardar el historial completo llenaría el
    // almacenamiento del navegador sin que nadie lo mire nunca.
    this.pulsos = [...this.pulsos.filter((p) => p.sucursal_id !== pulso.sucursal_id), pulso];
    escribir(LLAVE_PULSOS, this.pulsos);
  }

  private guardarCartera(): void {
    escribir(LLAVE_CARTERA, this.clientes);
  }

  // --- Respaldos ------------------------------------------------------------------------

  /**
   * La cartera, SIN secretos. Para respaldar o llevarse a otra máquina.
   *
   * Los secretos van aparte (`respaldoDeSecretos`) porque este archivo se manda
   * por correo sin pensarlo, y no debe llevar dentro la llave que firma las
   * actualizaciones de todos los restaurantes.
   */
  exportar(): string {
    return JSON.stringify({ clientes: this.clientes, pulsos: this.pulsos }, null, 2);
  }

  importar(json: string): { ok: boolean; error?: string } {
    try {
      const datos = JSON.parse(json) as { clientes?: ClienteMotRest[]; pulsos?: PulsoCliente[] };
      if (!Array.isArray(datos.clientes)) return { ok: false, error: "El archivo no trae clientes" };

      this.clientes = datos.clientes;
      this.pulsos = datos.pulsos ?? [];
      this.guardarCartera();
      escribir(LLAVE_PULSOS, this.pulsos);
      return { ok: true };
    } catch {
      return { ok: false, error: "No se pudo leer el archivo" };
    }
  }
}

export const central = new StoreCentral();
