/**
 * Store de tesorería (M5): el dinero del restaurante, en efectivo y en banco.
 *
 * Este store es dueño de DOS hechos nada más —el traspaso al banco y el ajuste
 * justificado—, porque son los únicos que no existían en ninguna otra parte.
 * Todo lo demás que mueve dinero ya se registraba: los cobros en las comandas,
 * los gastos en su store, los retiros en la sesión de caja.
 *
 * El saldo NO se guarda: se recalcula sumando esos cuatro orígenes cada vez.
 * Es más trabajo para la computadora y la única forma de que la cifra se pueda
 * explicar renglón por renglón. Un saldo almacenado es un número que un día
 * alguien corrige «para que cuadre» y a partir de ahí no significa nada.
 */
import {
  FabricaEventos,
  arquear,
  compararEventos,
  conSaldoArrastrado,
  flujoDeDinero,
  movimientosEn,
  resumenDeFlujo,
  saldosDe,
  uuidv7,
  type Arqueo,
  type Centavos,
  type CuentaTesoreria,
  type ClaseAjuste,
  type EventoTesoreria,
  type ID,
  type MovimientoDinero,
  type Rango,
  type RenglonConSaldo,
  type ResumenFlujo,
  type SaldosTesoreria,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { caja } from "./caja.svelte";
import { egresos } from "./egresos.svelte";
import { pos } from "./pos.svelte";
import { SUCURSAL_ID, obtenerDeviceId } from "./presentacion";

/** Stream al que van los movimientos de tesorería de una sucursal. */
export function streamTesoreria(sucursal: ID): ID {
  return `tesoreria:${sucursal}`;
}

export interface ResultadoTesoreria {
  ok: boolean;
  error?: string;
}

class StoreTesoreria {
  private eventos = $state.raw<EventoTesoreria[]>([]);
  private almacen: Almacen | null = null;

  private fabrica = new FabricaEventos<EventoTesoreria>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  // --- Persistencia -----------------------------------------------------------------

  hidratar(eventos: readonly EventoTesoreria[]): void {
    this.eventos = [...eventos];
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  integrar(eventos: readonly EventoTesoreria[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  private emitir(evento: EventoTesoreria): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar el movimiento de tesorería", causa);
    });
  }

  actuarComo(empleadoId: ID): void {
    this.fabrica.actualizarContexto({ empleado_id: empleadoId });
  }

  /** Los eventos propios, para que el arranque los pueda volcar al Hub. */
  get todosLosEventos(): EventoTesoreria[] {
    return this.eventos;
  }

  // --- Lectura ---------------------------------------------------------------------

  /**
   * De dónde sale el dinero.
   *
   * Se arma aquí y no en cada consulta para que el resto del store —y las
   * pantallas— no tengan que acordarse de los cuatro orígenes. Añadir uno nuevo
   * se hace en un solo sitio.
   */
  private get fuentes() {
    return {
      comandas: pos.todasLasComandas,
      egresos: egresos.registros,
      sesiones: caja.sesiones,
      tesoreria: this.eventos,
    };
  }

  /** Todos los movimientos de dinero del local, del más viejo al más nuevo. */
  get movimientos(): MovimientoDinero[] {
    return flujoDeDinero(this.fuentes);
  }

  /** Lo que debe haber ahora mismo, en cada sitio. */
  get saldos(): SaldosTesoreria {
    return saldosDe(this.movimientos);
  }

  /** El movimiento del dinero en un período, con saldo de entrada y de salida. */
  resumen(rango: Rango): ResumenFlujo {
    return resumenDeFlujo(this.fuentes, rango);
  }

  /** Los renglones de un período con su saldo arrastrado, para el histórico. */
  historico(rango: Rango): RenglonConSaldo[] {
    const todos = this.movimientos;
    const inicial = saldosDe(todos.filter((m) => m.ts < rango.desde));
    return conSaldoArrastrado(movimientosEn(todos, rango), inicial);
  }

  /** Lo contado contra lo que debería haber. No corrige nada: solo compara. */
  comparar(contado: Centavos, cuenta: CuentaTesoreria = "efectivo"): Arqueo {
    const saldos = this.saldos;
    return arquear(cuenta === "efectivo" ? saldos.efectivo : saldos.banco, contado, cuenta);
  }

  /** ¿Ya se declaró con cuánto dinero arrancó el restaurante? */
  get tieneSaldoInicial(): boolean {
    return this.eventos.some(
      (e) => e.tipo === "saldo_ajustado" && e.clase === "saldo_inicial",
    );
  }

  // --- Operaciones -------------------------------------------------------------------

  /**
   * Mueve dinero entre el cajón y el banco.
   *
   * Depositar la venta del fin de semana, o ir por cambio. No cambia cuánto
   * tiene el restaurante: cambia dónde está.
   */
  traspasar(
    desde: CuentaTesoreria,
    monto: Centavos,
    opciones: { referencia?: string; nota?: string; empleadoId?: ID } = {},
  ): ResultadoTesoreria {
    if (!Number.isFinite(monto) || monto <= 0) {
      return { ok: false, error: "Escribe un monto mayor que cero" };
    }

    const hacia: CuentaTesoreria = desde === "efectivo" ? "banco" : "efectivo";

    /*
     * Se avisa —no se impide— cuando el depósito deja el cajón en negativo.
     * Impedirlo sería peor: el saldo puede estar bajo porque falta capturar un
     * cobro, y bloquear el depósito real por un dato pendiente deja al usuario
     * sin poder registrar lo que ya hizo con el dinero en la mano.
     */
    if (opciones.empleadoId) this.actuarComo(opciones.empleadoId);
    this.emitir(
      this.fabrica.crear("traspaso_registrado", streamTesoreria(SUCURSAL_ID), {
        traspaso_id: uuidv7(),
        desde,
        hacia,
        monto,
        referencia: opciones.referencia?.trim() || undefined,
        nota: opciones.nota?.trim() || undefined,
      }),
    );
    return { ok: true };
  }

  /**
   * Corrige el saldo dejando escrito POR QUÉ.
   *
   * La justificación es obligatoria y se exige aquí, no en la pantalla: si la
   * validación viviera en el formulario, cualquier otra ruta hacia este store
   * —una importación, una terminal vieja— podría meter ajustes mudos, y un
   * ajuste sin explicación es indistinguible de tapar un faltante.
   */
  ajustar(
    cuenta: CuentaTesoreria,
    clase: ClaseAjuste,
    delta: Centavos,
    justificacion: string,
    autorizadorId?: ID,
  ): ResultadoTesoreria {
    const porque = justificacion.trim();
    if (porque.length < 5) {
      return { ok: false, error: "Explica el ajuste: queda en el histórico y en la bitácora" };
    }
    if (!Number.isFinite(delta) || delta === 0) {
      return { ok: false, error: "El ajuste tiene que mover algo: escribe un importe" };
    }
    if (clase === "saldo_inicial" && this.tieneSaldoInicial) {
      return {
        ok: false,
        error: "El saldo inicial ya se declaró. Usa «Corrección de captura» para enmendarlo.",
      };
    }

    if (autorizadorId) this.actuarComo(autorizadorId);
    this.emitir(
      this.fabrica.crear("saldo_ajustado", streamTesoreria(SUCURSAL_ID), {
        ajuste_id: uuidv7(),
        cuenta,
        clase,
        delta,
        justificacion: porque,
        autorizador_id: autorizadorId,
      }),
    );
    return { ok: true };
  }

  /**
   * Acepta la diferencia de un arqueo: deja el saldo en lo que de verdad hay.
   *
   * El ajuste es exactamente la diferencia, así que el saldo queda igual a lo
   * contado. Es un atajo de la operación de arriba, y va aquí para que el
   * importe lo calcule el sistema: pedirle a quien cuadra la caja que teclee
   * la diferencia con su signo es pedirle el error.
   */
  aceptarDiferencia(
    cuenta: CuentaTesoreria,
    contado: Centavos,
    justificacion: string,
    autorizadorId?: ID,
  ): ResultadoTesoreria {
    const { diferencia } = this.comparar(contado, cuenta);
    if (diferencia === 0) return { ok: false, error: "No hay diferencia que aceptar" };
    return this.ajustar(cuenta, "diferencia_aceptada", diferencia, justificacion, autorizadorId);
  }
}

export const tesoreria = new StoreTesoreria();
