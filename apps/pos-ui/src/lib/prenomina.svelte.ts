/**
 * Store de prenómina (M6).
 *
 * Junta lo que ya está registrado —checadas del checador y propinas del POS— y
 * lo convierte en la cuenta del periodo. La tarifa por hora vive aquí, en su
 * propio flujo de eventos, y NO en el usuario: el objeto de usuario viaja a
 * todas las terminales para evaluar permisos, y ahí el sueldo de todos quedaría
 * a la vista de cualquiera.
 */
import {
  FabricaEventos,
  calcularPrenomina,
  compararEventos,
  cuentasCerradasEn,
  streamPrenomina,
  tarifasVigentes,
  ventasPorMesero,
  type Centavos,
  type EventoPrenomina,
  type ID,
  type JornadaTrabajador,
  type ModoPropina,
  type Prenomina,
  type Rango,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { asistencia } from "./asistencia.svelte";
import { pos } from "./pos.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

export interface ResultadoPrenomina {
  ok: boolean;
  error?: string;
}

class StorePrenomina {
  private eventos = $state.raw<EventoPrenomina[]>([]);
  private almacen: Almacen | null = null;

  private fabrica = new FabricaEventos<EventoPrenomina>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  /** Cómo reparte las propinas este restaurante. Lo elige quien administra. */
  modoPropina = $state<ModoPropina>("directo");

  tarifas = $derived(tarifasVigentes(this.eventos));

  hidratar(eventos: readonly EventoPrenomina[]): void {
    this.eventos = [...eventos];
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  integrar(eventos: readonly EventoPrenomina[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  actuarComo(empleadoId: ID): void {
    this.fabrica.actualizarContexto({ empleado_id: empleadoId });
  }

  private emitir(evento: EventoPrenomina): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar el evento de prenómina", causa);
    });
  }

  tarifaDe(trabajadorId: ID): Centavos | undefined {
    return this.tarifas.get(trabajadorId);
  }

  /** Fija la tarifa por hora. Queda en la bitácora: cuándo y quién la cambió. */
  asignarTarifa(trabajadorId: ID, tarifaHora: Centavos, nota?: string): ResultadoPrenomina {
    if (!Number.isFinite(tarifaHora) || tarifaHora <= 0) {
      return { ok: false, error: "La tarifa por hora debe ser mayor que cero" };
    }
    this.emitir(
      this.fabrica.crear("tarifa_asignada", streamPrenomina(SUCURSAL_ID), {
        trabajador_id: trabajadorId,
        tarifa_hora: tarifaHora,
        nota: nota?.trim() || undefined,
      }),
    );
    return { ok: true };
  }

  /**
   * Calcula la prenómina del periodo para el equipo indicado.
   *
   * Las horas salen del checador acotado al rango; las propinas, de las cuentas
   * cerradas en ese mismo rango. Ambas cosas ya estaban registradas: aquí solo
   * se cruzan.
   */
  calcular(
    equipo: readonly { id: ID; nombre: string }[],
    rango: Rango,
    ahora = Date.now(),
  ): Prenomina {
    const porMesero = new Map(
      ventasPorMesero(cuentasCerradasEn(pos.todasLasComandas, rango)).map((v) => [
        v.mesero_id,
        v.propinas,
      ]),
    );

    const jornadas: JornadaTrabajador[] = equipo.map((u) => {
      const r = asistencia.resumenEn(u.id, rango, ahora);
      return {
        trabajador_id: u.id,
        nombre: u.nombre,
        minutos: r.minutos,
        turnoAbierto: r.turnoAbierto,
        propinasPropias: porMesero.get(u.id) ?? (0 as Centavos),
      };
    });

    // Solo entra quien trabajó o quien generó propina: listar a todo el catálogo
    // con ceros vuelve ilegible la raya en un local con rotación.
    const activos = jornadas.filter((j) => j.minutos > 0 || j.propinasPropias > 0);

    return calcularPrenomina(activos, this.tarifas, { modoPropina: this.modoPropina });
  }
}

export const prenomina = new StorePrenomina();
