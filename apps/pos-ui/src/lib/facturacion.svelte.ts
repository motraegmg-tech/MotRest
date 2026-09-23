/**
 * Cómo factura este restaurante: quién decide la factura global del mes.
 *
 * EL PORQUÉ (1.5.6, decisión de Gonzalo)
 *
 * En la 1.5.5 el Hub emitía la global solo, con TODO lo que nadie había pedido
 * a su nombre. Funciona, pero deja al restaurantero fuera de una decisión que
 * es suya: «el restaurantero elige y es dueño de su tipo de facturación». Así
 * que ahora hay dos modos y el local escoge:
 *
 *  - **manual** (por defecto): nadie emite nada sin que una persona lo revise
 *    y lo autorice, desde Finanzas → Facturación → Factura global.
 *  - **automática**: la de la 1.5.5, para quien prefiera no acordarse.
 *
 * SE REPLICA COMO UN CATÁLOGO, igual que la configuración de correo: se cambia
 * en cualquier terminal, viaja al Hub —que es quien emite— y vuelve a las
 * demás. Gana el más nuevo por versión y fecha, que es la regla de toda la
 * sincronización del producto (ADR-17).
 *
 * DESDE LA 1.5.6 LLEVA TAMBIÉN LOS DATOS FISCALES DEL RESTAURANTE. Antes vivían
 * solo en cada tableta y el Hub no los tenía; ahora el Hub emite por su cuenta
 * (las autofacturas del portal) y los necesita, y de paso una tableta nueva ya
 * no tiene que volver a capturarlos.
 */
import {
  MAXIMO_CORREOS_FACTURA,
  correoDeFacturaValido,
  leerConfiguracionFacturacion,
  type ConfiguracionFacturacion,
  type DatosEmisor,
  type PeriodicidadGlobal,
} from "@motrest/dominio";
import { catalogoMasNuevo, type Almacen } from "@motrest/protocolo-sync";

export const CLAVE_FACTURACION = "facturacion_config";

export type ModoGlobal = "manual" | "automatica";

export type { ConfiguracionFacturacion };

/**
 * MANUAL POR DEFECTO, y no es un detalle de gusto: una global se emite ante el
 * SAT a nombre del restaurante. Que la primera salga sola, sin que nadie del
 * local haya dicho nada, es exactamente lo que Gonzalo pidió evitar.
 */
export const FACTURACION_INICIAL: ConfiguracionFacturacion = {
  modo_global: "manual",
  version: 0,
  updated_at: 0,
};

/** La misma lectura que hace el Hub: lo que no tiene forma no se adopta. */
function normalizar(entrante: unknown): ConfiguracionFacturacion {
  return leerConfiguracionFacturacion(entrante);
}

/** ¿Son los mismos datos fiscales? Para no publicar una versión que no cambia nada. */
function mismoEmisor(a: DatosEmisor | undefined, b: DatosEmisor | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.rfc === b.rfc &&
    a.nombre === b.nombre &&
    a.regimen_fiscal === b.regimen_fiscal &&
    a.codigo_postal === b.codigo_postal &&
    (a.nombre_comercial ?? "") === (b.nombre_comercial ?? "")
  );
}

class StoreFacturacion {
  datos = $state<ConfiguracionFacturacion>({ ...FACTURACION_INICIAL });
  private almacen: Almacen | null = null;
  private alCambiar: ((config: ConfiguracionFacturacion) => void) | null = null;
  private alLlegarEmisor: ((emisor: DatosEmisor) => void) | null = null;

  /** Los datos fiscales del restaurante que comparten todas las terminales. */
  get emisor(): DatosEmisor | undefined {
    return this.datos.emisor;
  }

  get modoGlobal(): ModoGlobal {
    return this.datos.modo_global;
  }

  get esAutomatica(): boolean {
    return this.datos.modo_global === "automatica";
  }

  get periodicidad(): PeriodicidadGlobal {
    return this.datos.periodicidad_global ?? "mensual";
  }

  get correosGuardados(): string[] {
    return this.datos.correos_factura ?? [];
  }

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardada = await almacen.estado.cargar<ConfiguracionFacturacion>(CLAVE_FACTURACION);
    if (guardada) this.datos = normalizar(guardada);
  }

  /** Lo que llega del Hub o de otra terminal. Solo se adopta si es más nuevo. */
  fusionar(entrante: ConfiguracionFacturacion): boolean {
    const normalizada = normalizar(entrante);
    if (!catalogoMasNuevo(normalizada, this.datos)) return false;
    const antes = this.datos.emisor;
    this.datos = normalizada;
    this.guardar();
    if (normalizada.emisor && !mismoEmisor(antes, normalizada.emisor)) {
      this.alLlegarEmisor?.({ ...normalizada.emisor });
    }
    return true;
  }

  /** Quién se entera cuando otra terminal cambia los datos fiscales. */
  alCambiarEmisor(escucha: (emisor: DatosEmisor) => void): void {
    this.alLlegarEmisor = escucha;
  }

  alPublicar(escucha: (config: ConfiguracionFacturacion) => void): void {
    this.alCambiar = escucha;
  }

  /*
   * `$state.snapshot` y no `{ ...this.datos }`: el emisor va ANIDADO, y dentro
   * de un $state es un proxy. Guardarlo así en IndexedDB lanza DataCloneError
   * —fue lo que hacía perder el PIN (ver la memoria de proxies)—.
   */
  get paraPublicar(): ConfiguracionFacturacion {
    return $state.snapshot(this.datos) as ConfiguracionFacturacion;
  }

  /**
   * Cambia el modo: sube la versión, lo guarda y lo manda al Hub.
   *
   * Un solo camino, como en la configuración de correo: tener el guardado
   * repartido es lo que permitía cambiar algo sin publicarlo, y entonces el Hub
   * —que es quien emite— seguía en el modo viejo sin que nadie lo notara.
   */
  fijarModo(modo: ModoGlobal): void {
    if (modo === this.datos.modo_global) return;
    this.datos = {
      ...this.paraPublicar,
      modo_global: modo,
      version: (this.datos.version ?? 0) + 1,
      updated_at: Date.now(),
    };
    this.guardar();
    this.alCambiar?.(this.paraPublicar);
  }

  /**
   * Publica los datos fiscales del restaurante para las demás terminales y el
   * Hub. Si no cambió nada no sube la versión: publicar la misma carta otra vez
   * solo la haría viajar por la red.
   */
  /** Mensual o diaria (1.5.7). Se anota desde cuándo: el barrido automático lo necesita. */
  fijarPeriodicidad(periodicidad: PeriodicidadGlobal): void {
    if (periodicidad === this.periodicidad) return;
    const { periodicidad_global: _antes, ...resto } = this.paraPublicar;
    this.datos = {
      ...resto,
      ...(periodicidad === "diaria" ? { periodicidad_global: "diaria" as const } : {}),
      periodicidad_desde: Date.now(),
      version: (this.datos.version ?? 0) + 1,
      updated_at: Date.now(),
    };
    this.guardar();
    this.alCambiar?.(this.paraPublicar);
  }

  /**
   * Guarda un correo para ofrecerlo la próxima vez. Devuelve el motivo si no se
   * pudo: sin forma de correo, o la lista llena.
   */
  guardarCorreo(correo: string): { ok: true } | { ok: false; error: string } {
    const limpio = correo.trim().toLowerCase();
    if (!correoDeFacturaValido(limpio)) return { ok: false, error: "Ese correo no tiene forma de correo." };
    const actuales = this.correosGuardados;
    if (actuales.includes(limpio)) return { ok: true };
    if (actuales.length >= MAXIMO_CORREOS_FACTURA) {
      return { ok: false, error: `Ya hay ${MAXIMO_CORREOS_FACTURA} correos guardados. Quita uno para guardar otro.` };
    }
    this.fijarCorreos([...actuales, limpio]);
    return { ok: true };
  }

  quitarCorreo(correo: string): void {
    this.fijarCorreos(this.correosGuardados.filter((c) => c !== correo));
  }

  private fijarCorreos(correos: string[]): void {
    const { correos_factura: _antes, ...resto } = this.paraPublicar;
    this.datos = {
      ...resto,
      ...(correos.length > 0 ? { correos_factura: correos } : {}),
      version: (this.datos.version ?? 0) + 1,
      updated_at: Date.now(),
    };
    this.guardar();
    this.alCambiar?.(this.paraPublicar);
  }

  fijarEmisor(emisor: DatosEmisor): void {
    if (mismoEmisor(this.datos.emisor, emisor)) return;
    this.datos = {
      ...this.paraPublicar,
      emisor: { ...emisor },
      version: (this.datos.version ?? 0) + 1,
      updated_at: Date.now(),
    };
    this.guardar();
    this.alCambiar?.(this.paraPublicar);
  }

  private guardar(): void {
    void this.almacen?.estado.guardar(CLAVE_FACTURACION, this.paraPublicar).catch((causa) => {
      console.error("No se pudo guardar cómo factura el local", causa);
    });
  }
}

export const facturacion = new StoreFacturacion();
