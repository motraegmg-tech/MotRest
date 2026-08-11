/**
 * Store del rol de mesas: qué mesero atiende qué mesa, cada día de la semana.
 *
 * Mismo tratamiento que el plano y la carta: instantánea versionada que se
 * replica por LWW (TRD §5.2), no event log. Ver `personal/asignaciones.ts` en el
 * dominio para el porqué de cada decisión.
 */
import {
  alternarMesero,
  asignarMesa,
  copiarDia,
  diaDeLaSemana,
  meserosDeMesa,
  mesasDeMesero,
  rolDeMesasVacio,
  vaciarDia,
  atiendeLaMesa,
  type DiaSemana,
  type ID,
  type RolDeMesas,
} from "@motrest/dominio";
import { catalogoMasNuevo, type Almacen } from "@motrest/protocolo-sync";

export const CLAVE_ASIGNACIONES = "rol_de_mesas";

class StoreAsignaciones {
  private datos = $state.raw<RolDeMesas>(rolDeMesasVacio());
  private almacen: Almacen | null = null;
  private alCambiar: ((rol: RolDeMesas) => void) | null = null;

  /**
   * Día que se está editando en la tabla semanal. Arranca en el de hoy, que es
   * el que el encargado quiere ver el 95 % de las veces que abre la pantalla.
   */
  diaEnEdicion = $state<DiaSemana>(diaDeLaSemana());

  async hidratar(almacen: Almacen): Promise<void> {
    const guardado = await almacen.estado.cargar<RolDeMesas>(CLAVE_ASIGNACIONES);
    if (guardado?.asignaciones) this.datos = guardado;
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  alPublicar(escucha: (rol: RolDeMesas) => void): void {
    this.alCambiar = escucha;
  }

  /** Adopta el rol de otra terminal si es más nuevo. */
  fusionar(entrante: RolDeMesas): boolean {
    if (!catalogoMasNuevo(entrante, this.datos)) return false;
    this.datos = entrante;
    void this.almacen?.estado.guardar(CLAVE_ASIGNACIONES, entrante).catch((causa) => {
      console.error("No se pudo guardar el rol de mesas recibido", causa);
    });
    return true;
  }

  private aplicar(cambio: (rol: RolDeMesas) => RolDeMesas): void {
    const siguiente = cambio(this.datos);
    if (siguiente === this.datos) return;
    this.datos = siguiente;
    void this.almacen?.estado.guardar(CLAVE_ASIGNACIONES, siguiente).catch((causa) => {
      console.error("No se pudo guardar el rol de mesas", causa);
    });
    this.alCambiar?.(siguiente);
  }

  // --- Consultas ---------------------------------------------------------------

  get rol(): RolDeMesas {
    return this.datos;
  }

  /** El día de HOY, para lo que se consulta durante el servicio. */
  get hoy(): DiaSemana {
    return diaDeLaSemana();
  }

  meserosDe(mesaId: ID, dia: DiaSemana = this.hoy): ID[] {
    return meserosDeMesa(this.datos, mesaId, dia);
  }

  mesasDe(meseroId: ID, dia: DiaSemana = this.hoy): ID[] {
    return mesasDeMesero(this.datos, meseroId, dia);
  }

  atiende(mesaId: ID, meseroId: ID, dia: DiaSemana = this.hoy): boolean {
    return atiendeLaMesa(this.datos, mesaId, meseroId, dia);
  }

  /** ¿Hay alguien asignado explícitamente a esta mesa hoy? */
  tieneDueno(mesaId: ID, dia: DiaSemana = this.hoy): boolean {
    return this.meserosDe(mesaId, dia).length > 0;
  }

  // --- Edición -----------------------------------------------------------------

  alternar(mesaId: ID, dia: DiaSemana, meseroId: ID): void {
    this.aplicar((rol) => alternarMesero(rol, mesaId, dia, meseroId));
  }

  asignar(mesaId: ID, dia: DiaSemana, meseros: readonly ID[]): void {
    this.aplicar((rol) => asignarMesa(rol, mesaId, dia, meseros));
  }

  copiar(origen: DiaSemana, destino: DiaSemana): void {
    this.aplicar((rol) => copiarDia(rol, origen, destino));
  }

  /** Replica el día indicado sobre los otros seis. */
  copiarATodos(origen: DiaSemana): void {
    this.aplicar((rol) =>
      ([0, 1, 2, 3, 4, 5, 6] as DiaSemana[])
        .filter((d) => d !== origen)
        .reduce((acc, destino) => copiarDia(acc, origen, destino), rol),
    );
  }

  vaciar(dia: DiaSemana): void {
    this.aplicar((rol) => vaciarDia(rol, dia));
  }
}

export const asignaciones = new StoreAsignaciones();
