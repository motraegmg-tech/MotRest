/**
 * Store de la voz del cliente (C4).
 *
 * La opinión se captura al cobrar —donde ya hay una conversación con la mesa— y
 * su valor está en cruzarla con lo que el sistema ya sabe de esa cuenta: cuánto
 * esperó y quién la atendió.
 */
import {
  FabricaEventos,
  compararEventos,
  efectoDeLaEspera,
  esperasDeCuentas,
  opinionesPorMesero,
  proyectarOpiniones,
  resumirOpiniones,
  streamOpiniones,
  uuidv7,
  type Calificacion,
  type EventoOpinion,
  type ID,
  type MotivoOpinion,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { pos } from "./pos.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

class StoreOpiniones {
  private eventos = $state.raw<EventoOpinion[]>([]);
  private almacen: Almacen | null = null;

  private fabrica = new FabricaEventos<EventoOpinion>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  opiniones = $derived(proyectarOpiniones(this.eventos));
  resumen = $derived(resumirOpiniones(this.opiniones));

  hidratar(eventos: readonly EventoOpinion[]): void {
    this.eventos = [...eventos];
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  integrar(eventos: readonly EventoOpinion[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  actuarComo(empleadoId: ID): void {
    this.fabrica.actualizarContexto({ empleado_id: empleadoId });
  }

  /** ¿Esta cuenta ya tiene opinión? Preguntar dos veces molesta al comensal. */
  yaOpinada(ordenId: ID): boolean {
    return this.opiniones.some((o) => o.orden_id === ordenId);
  }

  registrar(datos: {
    ordenId: ID;
    calificacion: Calificacion;
    motivos?: MotivoOpinion[];
    comentario?: string;
    clienteId?: ID;
  }): { ok: boolean; error?: string } {
    if (this.yaOpinada(datos.ordenId)) {
      return { ok: false, error: "Esta cuenta ya tiene una opinión registrada" };
    }

    const evento = this.fabrica.crear("opinion_registrada", streamOpiniones(SUCURSAL_ID), {
      opinion_id: uuidv7(),
      orden_id: datos.ordenId,
      calificacion: datos.calificacion,
      // Una calificación buena no arrastra motivos de queja.
      motivos: datos.calificacion === "bien" ? [] : (datos.motivos ?? []),
      comentario: datos.comentario?.trim() || undefined,
      cliente_id: datos.clienteId,
    });

    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar la opinión", causa);
    });
    return { ok: true };
  }

  /**
   * ¿La espera está costando satisfacción?
   *
   * Los tiempos salen de los sellos que el KDS ya registra: no hay nada extra
   * que capturar.
   */
  efectoEspera(umbralMin = 25) {
    const esperas = esperasDeCuentas(
      pos.todasLasComandas.map((c) => ({ orden_id: c.orden_id, renglones: c.renglones })),
    );
    return efectoDeLaEspera(this.opiniones, esperas, umbralMin);
  }

  porMesero() {
    const meseros = new Map(pos.todasLasComandas.map((c) => [c.orden_id, c.mesero_id]));
    return opinionesPorMesero(this.opiniones, (id) => meseros.get(id));
  }
}

export const opiniones = new StoreOpiniones();
