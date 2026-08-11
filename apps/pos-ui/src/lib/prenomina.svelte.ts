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
  sueldoSemanal,
  sueldosVigentes,
  tarifasVigentes,
  ventasPorMesero,
  type Centavos,
  type DiaSemana,
  type EventoPrenomina,
  type ID,
  type JornadaTrabajador,
  type ModoPropina,
  type ModoSueldo,
  type Prenomina,
  type Rango,
  type SueldoSemanal,
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
  /** Cómo paga el sueldo base: por hora del checador, o sueldo diario pactado. */
  modoSueldo = $state<ModoSueldo>("por_hora");

  tarifas = $derived(tarifasVigentes(this.eventos));
  sueldos = $derived(sueldosVigentes(this.eventos));

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

  /** Lo que gana esta persona cada día de la semana. */
  sueldoDe(trabajadorId: ID): SueldoSemanal {
    return this.sueldos.get(trabajadorId) ?? {};
  }

  /**
   * Fija la semana completa de sueldos de alguien.
   *
   * Va entera y no día por día porque así es como se decide: el dueño revisa el
   * renglón de esa persona y lo deja como quiere. Los días en cero se retiran —
   * un día sin sueldo es su descanso, y guardarlo como cero lo convertiría en un
   * día programado por el que se le podría descontar una falta.
   */
  asignarSueldoDiario(
    trabajadorId: ID,
    sueldoPorDia: SueldoSemanal,
    nota?: string,
  ): ResultadoPrenomina {
    const limpio: SueldoSemanal = {};
    for (const [dia, monto] of Object.entries(sueldoPorDia)) {
      if (!Number.isFinite(monto) || monto === undefined) continue;
      if (monto < 0) return { ok: false, error: "Un sueldo no puede ser negativo" };
      if (monto > 0) limpio[Number(dia) as DiaSemana] = monto;
    }
    if (sueldoSemanal(limpio) <= 0) {
      return { ok: false, error: "Captura al menos un día con sueldo" };
    }

    this.emitir(
      this.fabrica.crear("sueldo_diario_asignado", streamPrenomina(SUCURSAL_ID), {
        trabajador_id: trabajadorId,
        sueldo_por_dia: limpio,
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
        dias_asistidos: asistencia.diasTrabajados(u.id, rango, ahora),
      };
    });

    /*
     * Quién entra en la raya.
     *
     * Con sueldo por hora, solo quien trabajó o generó propina: listar a todo el
     * catálogo con ceros vuelve ilegible la raya en un local con rotación.
     *
     * Con sueldo diario NO se puede filtrar así, y esa es la diferencia que
     * importa: **quien faltó toda la semana tiene que aparecer**, precisamente
     * para que se vea su falta. Si se le quitara de la lista, un empleado que no
     * vino se volvería invisible el día de pagar.
     */
    const activos =
      this.modoSueldo === "por_dia"
        ? jornadas.filter(
            (j) =>
              j.minutos > 0 ||
              j.propinasPropias > 0 ||
              sueldoSemanal(this.sueldoDe(j.trabajador_id)) > 0,
          )
        : jornadas.filter((j) => j.minutos > 0 || j.propinasPropias > 0);

    return calcularPrenomina(activos, this.tarifas, {
      modoPropina: this.modoPropina,
      modoSueldo: this.modoSueldo,
      sueldos: this.sueldos,
      diasTranscurridos: diasTranscurridosDe(rango, ahora),
    });
  }
}

/**
 * Qué días de la semana ya ocurrieron dentro del periodo.
 *
 * Sin esto, abrir la prenómina un martes contaría como faltas el miércoles, el
 * jueves y el viernes que todavía no llegan — y ese es exactamente el número que
 * alguien acabaría pagando de menos por no mirarlo dos veces.
 */
function diasTranscurridosDe(rango: Rango, ahora: number): DiaSemana[] {
  const dias: DiaSemana[] = [];
  const fin = Math.min(ahora, rango.hasta - 1);
  for (let t = rango.desde; t <= fin; t += 86_400_000) {
    dias.push(new Date(t).getDay() as DiaSemana);
  }
  return dias;
}

export const prenomina = new StorePrenomina();
