/**
 * Impresoras, ruteo y cola de impresión.
 *
 * Dos decisiones que gobiernan el diseño:
 *
 * 1. **La cola persiste y reintenta.** Una impresora se queda sin papel, se
 *    atasca o alguien la desconecta a media noche de viernes. Si un fallo de
 *    impresión perdiera la comanda, el platillo no se prepararía. El trabajo
 *    espera y se reintenta; lo que nunca se pierde es el evento de venta, que
 *    ya está en el log.
 *
 * 2. **Imprimir NUNCA bloquea la venta.** Encolar es instantáneo. Si no hay
 *    impresora configurada, el POS sigue funcionando y lo dice — un local puede
 *    operar solo con el KDS, sin papel (métrica F1 del PRD §9).
 */
import type { ID } from "@motrest/dominio";
import type { AnchoPapel } from "./plantillas.js";

export type TipoConexion = "red" | "usb" | "bluetooth";

export interface Impresora {
  id: ID;
  nombre: string;
  conexion: TipoConexion;
  /** IP o host, para conexión de red. */
  host?: string;
  /** Puerto 9100 es el estándar de impresión directa. */
  puerto?: number;
  /**
   * Nombre con el que la impresora está dada de alta en el sistema, para
   * conexión USB. Es el que aparece en «Impresoras y escáneres» de Windows, y
   * tiene que coincidir letra por letra: el spooler no adivina.
   */
  dispositivo?: string;
  ancho: AnchoPapel;
  /** Áreas que imprime: "caja", "est-horno", "est-barra"… */
  areas: ID[];
  /** Corta el papel al terminar cada trabajo. */
  corta: boolean;
  /** Puede abrir el cajón de efectivo. */
  cajon: boolean;
  /** Cómo imprime QR: comando nativo o imagen para firmware antiguo. */
  modo_qr?: "nativo" | "imagen";
  activa: boolean;
}

export type TipoDocumento =
  | "comanda"
  | "ticket"
  | "ticket_interno"
  | "precuenta"
  | "corte"
  | "prueba"
  | "factura";

export type EstadoTrabajo = "pendiente" | "imprimiendo" | "impreso" | "fallido";

export interface TrabajoImpresion {
  id: ID;
  impresora_id: ID;
  documento: TipoDocumento;
  /** Bytes ESC/POS ya generados. */
  datos: Uint8Array;
  /** Vista legible, para la bitácora y para reimprimir sin regenerar. */
  vista: string;
  creado_ts: number;
  estado: EstadoTrabajo;
  intentos: number;
  ultimo_error?: string;
  /** Referencia al origen: la orden, el corte. */
  referencia?: ID;
  /**
   * Se «imprimió» sin papel: lo atendió el transporte simulado.
   *
   * Existe para que la pantalla no pueda decir «impreso» de algo que nunca
   * salió. Un trabajo simulado que se mostrara como impreso es la peor versión
   * de este módulo: la cocina no recibe la comanda y nadie se entera.
   */
  simulado?: boolean;
}

/**
 * Reintentos antes de rendirse.
 *
 * Cinco cubre el caso real —cambiar el rollo de papel, reconectar el cable— sin
 * dejar un trabajo intentando toda la noche contra una impresora que ya no
 * existe. Al agotarse queda como fallido y a la vista, para reimprimirlo a mano.
 */
export const MAX_INTENTOS_IMPRESION = 5;

/** Espera creciente entre reintentos, en ms. */
export function esperaReintento(intentos: number): number {
  return Math.min(2_000 * 2 ** intentos, 60_000);
}

/**
 * A qué impresora va un documento.
 *
 * **Cada impresora imprime SOLO las áreas que tiene asignadas.** Si nadie
 * reclama un área, ese documento no se imprime en ningún lado, y así tiene que
 * ser.
 *
 * AQUÍ HUBO UNA CAÍDA A «CAJA» Y HAY QUE DEJAR ESCRITO POR QUÉ SE FUE. El
 * razonamiento era razonable sobre el papel —una comanda impresa en el sitio
 * equivocado se lleva caminando; una que no se imprime no se prepara— pero en el
 * restaurante producía justo lo contrario de lo que el dueño configuró: quitarle
 * a la impresora de cocina el área de cocina no dejaba de imprimir comandas, las
 * mandaba TODAS a la caja. El rollo de la caja se acababa a media noche con
 * comandas que nadie pidió, y la única forma de detenerlo era desactivar la
 * impresora entera —con lo que se perdían también los tickets—.
 *
 * Una configuración que no se puede apagar no es una configuración. Cuando un
 * área queda sin impresora, el KDS sigue mostrando el platillo: la cocina no se
 * queda ciega, solo deja de salir papel donde nadie lo quiso.
 */
export function impresoraPara(
  impresoras: readonly Impresora[],
  area: ID,
): Impresora | undefined {
  return impresoras.find((i) => i.activa && i.areas.includes(area));
}

/** Todas las impresoras que deben recibir copia de un área. */
export function impresorasPara(
  impresoras: readonly Impresora[],
  area: ID,
): Impresora[] {
  return impresoras.filter((i) => i.activa && i.areas.includes(area));
}

export interface ResultadoEnvio {
  ok: boolean;
  error?: string;
  /** El envío no llegó a ninguna impresora de verdad. Lo pone el simulado. */
  simulado?: boolean;
}

/** Quien sabe hablar con una impresora concreta. */
export interface Transporte {
  puede(impresora: Impresora): boolean;
  enviar(impresora: Impresora, datos: Uint8Array): Promise<ResultadoEnvio>;
}

/**
 * Cola de impresión.
 *
 * Vive en el Hub cuando lo hay —así una sola máquina habla con las impresoras—
 * y en el propio dispositivo en modo isla (TRD §8, ADR-08).
 */
export class ColaImpresion {
  private trabajos: TrabajoImpresion[] = [];
  private procesando = false;

  constructor(
    private transportes: readonly Transporte[],
    private alCambiar?: (trabajos: readonly TrabajoImpresion[]) => void,
  ) {}

  get pendientes(): TrabajoImpresion[] {
    return this.trabajos.filter((t) => t.estado === "pendiente" || t.estado === "imprimiendo");
  }

  get fallidos(): TrabajoImpresion[] {
    return this.trabajos.filter((t) => t.estado === "fallido");
  }

  get todos(): readonly TrabajoImpresion[] {
    return this.trabajos;
  }

  private avisar(): void {
    this.alCambiar?.(this.trabajos);
  }

  /** Encola un trabajo. Devuelve de inmediato: imprimir no bloquea la venta. */
  encolar(
    trabajo: Omit<TrabajoImpresion, "estado" | "intentos" | "creado_ts">,
  ): TrabajoImpresion {
    const nuevo: TrabajoImpresion = {
      ...trabajo,
      creado_ts: Date.now(),
      estado: "pendiente",
      intentos: 0,
    };
    this.trabajos = [...this.trabajos, nuevo];
    this.avisar();
    return nuevo;
  }

  /** Reintenta un trabajo que se rindió, después de arreglar la impresora. */
  reintentar(trabajoId: ID): void {
    this.trabajos = this.trabajos.map((t) =>
      t.id === trabajoId ? { ...t, estado: "pendiente", intentos: 0, ultimo_error: undefined } : t,
    );
    this.avisar();
  }

  descartar(trabajoId: ID): void {
    this.trabajos = this.trabajos.filter((t) => t.id !== trabajoId);
    this.avisar();
  }

  /**
   * Procesa la cola en orden de llegada.
   *
   * El orden importa: las comandas de una misma mesa tienen que salir como se
   * capturaron, o la cocina arma los tiempos al revés.
   */
  async procesar(impresoras: readonly Impresora[]): Promise<void> {
    if (this.procesando) return;
    this.procesando = true;

    try {
      for (const trabajo of [...this.trabajos]) {
        if (trabajo.estado !== "pendiente") continue;

        const impresora = impresoras.find((i) => i.id === trabajo.impresora_id);
        if (!impresora) {
          this.marcar(trabajo.id, "fallido", { ultimo_error: "La impresora ya no está configurada" });
          continue;
        }

        const transporte = this.transportes.find((t) => t.puede(impresora));
        if (!transporte) {
          this.marcar(trabajo.id, "fallido", {
            ultimo_error: `Sin soporte para conexión ${impresora.conexion}`,
          });
          continue;
        }

        this.marcar(trabajo.id, "imprimiendo");
        const resultado = await transporte.enviar(impresora, trabajo.datos);

        if (resultado.ok) {
          // `simulado` viaja hasta la pantalla: es la diferencia entre «salió en
          // papel» y «solo se pudo previsualizar», y quien está en la caja
          // necesita saber cuál de las dos ocurrió.
          this.marcar(trabajo.id, "impreso", { simulado: resultado.simulado === true });
          continue;
        }

        const intentos = (this.buscar(trabajo.id)?.intentos ?? 0) + 1;
        this.trabajos = this.trabajos.map((t) =>
          t.id === trabajo.id
            ? {
                ...t,
                intentos,
                ultimo_error: resultado.error,
                estado: intentos >= MAX_INTENTOS_IMPRESION ? "fallido" : "pendiente",
              }
            : t,
        );
        this.avisar();
      }
    } finally {
      this.procesando = false;
    }
  }

  private buscar(trabajoId: ID): TrabajoImpresion | undefined {
    return this.trabajos.find((t) => t.id === trabajoId);
  }

  private marcar(
    trabajoId: ID,
    estado: EstadoTrabajo,
    extra?: Partial<Pick<TrabajoImpresion, "ultimo_error" | "simulado">>,
  ): void {
    this.trabajos = this.trabajos.map((t) =>
      t.id === trabajoId ? { ...t, estado, ...extra } : t,
    );
    this.avisar();
  }

  /** Limpia lo ya impreso, conservando fallidos y pendientes. */
  limpiarImpresos(): void {
    this.trabajos = this.trabajos.filter((t) => t.estado !== "impreso");
    this.avisar();
  }
}

/**
 * Transporte de mentira: registra en vez de imprimir.
 *
 * Es el que usa la demostración y el que permite ver el ticket sin tener una
 * impresora enfrente. También es el que corre en el navegador, donde no hay
 * forma de abrir un socket TCP al puerto 9100.
 */
export class TransporteSimulado implements Transporte {
  impresos: { impresora: ID; datos: Uint8Array }[] = [];

  puede(): boolean {
    return true;
  }

  async enviar(impresora: Impresora, datos: Uint8Array): Promise<ResultadoEnvio> {
    this.impresos.push({ impresora: impresora.id, datos });
    // Se declara simulado para que nadie aguas abajo lo confunda con papel.
    return { ok: true, simulado: true };
  }
}
