/**
 * Store de caja: sesión de turno, movimientos de efectivo y corte sellado (M1).
 *
 * El corte responde una sola pregunta al cerrar: **¿el efectivo del cajón es el
 * que debería?** Se abre con un fondo, se acumulan las ventas en efectivo del
 * turno y los retiros a mano, y al cerrar el cajero declara lo que contó. La
 * diferencia se sella e imprime — un corte sin sello es una hoja que cualquiera
 * puede rehacer con otras cifras.
 *
 * Solo puede haber UN turno abierto a la vez: dos cajones abiertos serían dos
 * verdades sobre el mismo dinero.
 */
import {
  FabricaEventos,
  calcularCorte,
  compararEventos,
  diferenciaArqueo,
  proyectarSesiones,
  sesionAbierta,
  uuidv7,
  type Centavos,
  type CorteCaja,
  type EstadoCaja,
  type EventoCaja,
  type EventoComanda,
  type ID,
  type MotivoMovimientoCaja,
  type ResumenCorte,
} from "@motrest/dominio";
import type { CifrasCorte, DatosCorte } from "@motrest/impresion";
import type { Almacen } from "@motrest/protocolo-sync";
import { impresion } from "./impresion.svelte";
import { pos } from "./pos.svelte";
import { cabecera, SUCURSAL_ID, datosLocal, obtenerDeviceId } from "./presentacion";
import { local } from "./local.svelte";
import { licencia } from "./licencia.svelte";

export interface ResultadoCaja {
  ok: boolean;
  error?: string;
}

class StoreCaja {
  private eventos = $state.raw<EventoCaja[]>([]);
  private almacen: Almacen | null = null;

  private fabrica = new FabricaEventos<EventoCaja>({
    device_id: obtenerDeviceId(),
    empleado_id: "sistema",
    sucursal_id: SUCURSAL_ID,
  });

  sesiones = $derived(proyectarSesiones(this.eventos));
  activa = $derived<EstadoCaja | undefined>(sesionAbierta(this.eventos));

  hidratar(eventos: readonly EventoCaja[]): void {
    this.eventos = [...eventos];
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  integrar(eventos: readonly EventoCaja[]): void {
    const conocidos = new Set(this.eventos.map((e) => e.id));
    const nuevos = eventos.filter((e) => !conocidos.has(e.id));
    if (nuevos.length === 0) return;
    this.eventos = [...this.eventos, ...nuevos].sort(compararEventos);
  }

  actuarComo(empleadoId: ID): void {
    this.fabrica.actualizarContexto({ empleado_id: empleadoId });
  }

  private emitir(evento: EventoCaja): void {
    this.eventos = [...this.eventos, evento];
    void this.almacen?.eventos.anexar([evento]).catch((causa) => {
      console.error("No se pudo guardar el evento de caja", causa);
    });
  }

  // --- Ventas del turno -----------------------------------------------------------------

  /**
   * Los eventos de comanda del turno abierto.
   *
   * Un pago pertenece al turno si se registró entre la apertura y ahora. Sin la
   * ventana, el corte sumaría las ventas de turnos anteriores que siguen en el
   * log.
   */
  private eventosDelTurno(sesion: EstadoCaja): EventoComanda[] {
    const hasta = sesion.cerrada_ts ?? Date.now();
    return pos.todosLosEventos.filter((e) => e.ts >= sesion.abierta_ts && e.ts <= hasta);
  }

  /** El corte en vivo del turno abierto, para verlo antes de cerrar. */
  get corteEnVivo(): CorteCaja | null {
    const sesion = this.activa;
    if (!sesion) return null;
    return calcularCorte(sesion, this.eventosDelTurno(sesion));
  }

  // --- Operaciones ----------------------------------------------------------------------

  abrir(cajeroId: ID, fondoInicial: Centavos): ResultadoCaja {
    if (this.activa) return { ok: false, error: "Ya hay un turno de caja abierto" };
    if (!Number.isFinite(fondoInicial) || fondoInicial < 0) {
      return { ok: false, error: "El fondo inicial no puede ser negativo" };
    }

    const sesion_id = uuidv7();
    this.actuarComo(cajeroId);
    this.emitir(
      this.fabrica.crear("caja_abierta", sesion_id, {
        sesion_id,
        cajero_id: cajeroId,
        fondo_inicial: fondoInicial,
      }),
    );
    return { ok: true };
  }

  /**
   * Registra un movimiento de efectivo ajeno a las ventas.
   *
   * Un retiro sale del cajón (se guarda en negativo); un ingreso entra. Es el
   * único mecanismo para que el corte cuadre cuando el cajón se mueve por fuera
   * de las ventas: sacar para pagar de contado, meter cambio del banco.
   */
  movimiento(
    motivo: MotivoMovimientoCaja,
    monto: Centavos,
    concepto: string,
    empleadoId?: ID,
  ): ResultadoCaja {
    const sesion = this.activa;
    if (!sesion) return { ok: false, error: "No hay un turno abierto" };
    if (!Number.isFinite(monto) || monto <= 0) {
      return { ok: false, error: "Escribe un monto mayor que cero" };
    }
    if (concepto.trim().length < 2) return { ok: false, error: "Escribe el concepto del movimiento" };

    if (empleadoId) this.actuarComo(empleadoId);
    // El signo lo pone el motivo, no quien teclea: un retiro sale del cajón.
    const conSigno = (motivo === "retiro" ? -monto : monto) as Centavos;
    this.emitir(
      this.fabrica.crear("movimiento_efectivo", sesion.sesion_id, {
        sesion_id: sesion.sesion_id,
        motivo,
        monto: conSigno,
        concepto: concepto.trim(),
        autorizador_id: empleadoId,
      }),
    );
    return { ok: true };
  }

  /**
   * Cierra el turno: declara el efectivo contado, sella el corte y lo imprime.
   *
   * El orden importa. Primero el arqueo —lo que el cajero contó— y luego el
   * cierre con su sello: si se sellara antes de declarar, el sello no incluiría
   * la cifra que más se revisa.
   */
  async cerrar(declarado: Centavos, cajeroNombre: string): Promise<ResultadoCaja> {
    const sesion = this.activa;
    if (!sesion) return { ok: false, error: "No hay un turno abierto" };
    if (!Number.isFinite(declarado) || declarado < 0) {
      return { ok: false, error: "El efectivo contado no puede ser negativo" };
    }

    const corte = calcularCorte(sesion, this.eventosDelTurno(sesion));
    const cerrada_ts = Date.now();
    const diferencia = diferenciaArqueo(corte, declarado);

    const resumen: ResumenCorte = {
      sesion_id: sesion.sesion_id,
      cajero_id: sesion.cajero_id,
      abierta_ts: sesion.abierta_ts,
      cerrada_ts,
      fondo_inicial: sesion.fondo_inicial,
      total_vendido: corte.totalVendido,
      efectivo_esperado: corte.efectivoEsperado,
      declarado,
      diferencia,
      propinas: corte.propinas,
      cuentas_cerradas: corte.cuentasCerradas,
    };

    // El arqueo y el cierre son eventos aparte: uno es lo que se contó, otro es
    // el acto de cerrar. Separarlos deja la constancia de ambos.
    this.emitir(
      this.fabrica.crear("arqueo_registrado", sesion.sesion_id, {
        sesion_id: sesion.sesion_id,
        declarado,
      }),
    );

    // Sella e imprime. El sello que devuelve es el mismo que queda en el evento:
    // el papel y el registro comparten huella.
    const cifras: CifrasCorte = resumen;
    const datos: Omit<DatosCorte, "sello"> = {
      folio: sesion.sesion_id.slice(0, 8).toUpperCase(),
      // El nombre real del local: su ficha, o el de la licencia firmada.
      local: local.fichaParaTicket(licencia.licencia?.nombre ?? cabecera.sucursal).nombre,
      cajero: cajeroNombre,
      abierta_ts: sesion.abierta_ts,
      cerrada_ts,
      fondo_inicial: sesion.fondo_inicial,
      ventas: this.ventasImpresas(corte),
      total_vendido: corte.totalVendido,
      efectivo_ventas: corte.efectivoVentas,
      movimientos: corte.movimientos,
      efectivo_esperado: corte.efectivoEsperado,
      declarado,
      diferencia,
      propinas: corte.propinas,
      cuentas_cerradas: corte.cuentasCerradas,
    };
    const sello = await impresion.corte(cifras, datos);

    this.emitir(
      this.fabrica.crear("caja_cerrada", sesion.sesion_id, {
        sesion_id: sesion.sesion_id,
        diferencia,
        resumen,
        sello,
      }),
    );
    return { ok: true };
  }

  /**
   * Lo cobrado por forma de pago, con su etiqueta legible, para el papel.
   *
   * Va el BRUTO —propina incluida— porque es lo que de verdad entró por cada
   * canal y es contra lo que se cuadra el cajón. La separación entre venta y
   * propina viene en los renglones de abajo del ticket.
   */
  private ventasImpresas(corte: CorteCaja): DatosCorte["ventas"] {
    return Object.entries(corte.cobrado)
      .filter(([, monto]) => (monto ?? 0) > 0)
      .map(([forma, monto]) => ({ forma: this.etiquetaForma(forma), monto: monto as Centavos }));
  }

  private etiquetaForma(forma: string): string {
    switch (forma) {
      case "efectivo": return "Efectivo";
      case "tarjeta_debito": return "Débito";
      case "tarjeta_credito": return "Crédito";
      case "transferencia": return "Transferencia";
      case "vale": return "Vale";
      default: return forma;
    }
  }
}

export const caja = new StoreCaja();
