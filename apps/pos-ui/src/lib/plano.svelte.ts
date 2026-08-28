/**
 * Store del plano de piso: áreas y mesas.
 *
 * A diferencia de la operación, el plano es CATÁLOGO: se guarda como una
 * instantánea versionada (TRD §5.2), no como event log. Cuando llegue el Hub se
 * replicará con CRUD/LWW comparando `version` y `updated_at`.
 */
import {
  LIMITES_MESA,
  LIMITES_RETICULA,
  areaDe,
  cabeEnArea,
  capacidadDe,
  haySolape,
  idCorto,
  mesaDe,
  mesasDeArea,
  planoPorDefecto,
  primerHuecoLibre,
  validarPlano,
  type Area,
  type FormaMesa,
  type ID,
  type Mesa,
  type PlanoLocal,
  type ProblemaPlano,
} from "@motrest/dominio";
import { catalogoMasNuevo, type Almacen } from "@motrest/protocolo-sync";

export const CLAVE_PLANO = "plano_local";

export interface Resultado {
  ok: boolean;
  error?: string;
}

class StorePlano {
  private datos = $state.raw<PlanoLocal>(planoPorDefecto());
  private almacen: Almacen | null = null;
  private alCambiar: ((plano: PlanoLocal) => void) | null = null;

  /** Área que se está viendo en el POS y en el editor. */
  areaActiva = $state<ID>("area-salon");

  // --- Persistencia --------------------------------------------------------------

  async hidratar(almacen: Almacen): Promise<void> {
    const guardado = await almacen.estado.cargar<PlanoLocal>(CLAVE_PLANO);
    if (guardado && guardado.areas.length > 0) {
      this.datos = guardado;
    }
    const primera = this.areas[0];
    if (primera && !areaDe(this.datos, this.areaActiva)) {
      this.areaActiva = primera.id;
    }
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  /** Reemplaza el plano subiendo la versión y lo guarda. */
  private aplicar(cambio: (plano: PlanoLocal) => PlanoLocal): void {
    const siguiente = cambio(this.datos);
    this.datos = {
      ...siguiente,
      version: this.datos.version + 1,
      updated_at: Date.now(),
    };
    void this.almacen?.estado.guardar(CLAVE_PLANO, this.datos).catch((causa) => {
      console.error("No se pudo guardar el plano", causa);
    });
    this.alCambiar?.(this.datos);
  }

  /** Avisa cuando el plano cambia, para replicarlo al resto del local. */
  alPublicar(escucha: (plano: PlanoLocal) => void): void {
    this.alCambiar = escucha;
  }

  /**
   * Adopta el plano de otra terminal si es más nuevo.
   *
   * Importa que se replique: las comandas se agrupan por mesa, y una terminal
   * con un plano viejo no encontraría la mesa que otra acaba de crear.
   */
  fusionar(entrante: PlanoLocal): boolean {
    if (!catalogoMasNuevo(entrante, this.datos)) return false;
    this.datos = entrante;
    if (!areaDe(this.datos, this.areaActiva)) {
      this.areaActiva = this.areas[0]?.id ?? "";
    }
    void this.almacen?.estado.guardar(CLAVE_PLANO, entrante).catch((causa) => {
      console.error("No se pudo guardar el plano recibido", causa);
    });
    return true;
  }

  // --- Consultas ------------------------------------------------------------------

  get plano(): PlanoLocal {
    return this.datos;
  }

  get areas(): Area[] {
    return [...this.datos.areas].sort((a, b) => a.orden - b.orden);
  }

  get area(): Area | undefined {
    return areaDe(this.datos, this.areaActiva);
  }

  /** Mesas del área activa, ordenadas por posición. */
  get mesas(): Mesa[] {
    return mesasDeArea(this.datos, this.areaActiva);
  }

  /** Todas las mesas del local, de todas las áreas. */
  get todasLasMesas(): Mesa[] {
    return this.datos.mesas;
  }

  mesa(mesaId: ID): Mesa | undefined {
    return mesaDe(this.datos, mesaId);
  }

  nombreMesa(mesaId: ID): string {
    return this.mesa(mesaId)?.nombre ?? "—";
  }

  /**
   * Cómo se llama una cuenta que ocupa varias mesas: "3 + 4".
   *
   * Va por aquí y no concatenado en cada pantalla para que el ticket, la
   * cocina, el encabezado y el corte digan exactamente lo mismo. Una cuenta que
   * en la pantalla es «3 + 4» y en el papel es «3» es una discusión con el
   * comensal esperando a ocurrir.
   */
  etiquetaMesas(mesaIds: readonly ID[]): string {
    if (mesaIds.length === 0) return "—";
    return mesaIds.map((id) => this.nombreMesa(id)).join(" + ");
  }

  /** Cuántos comensales caben, con la fórmula única del dominio. */
  capacidadMesa(mesaId: ID): number {
    const mesa = this.mesa(mesaId);
    return mesa ? capacidadDe(mesa) : 0;
  }

  areaDeMesa(mesaId: ID): Area | undefined {
    const mesa = this.mesa(mesaId);
    return mesa ? areaDe(this.datos, mesa.area_id) : undefined;
  }

  get problemas(): ProblemaPlano[] {
    return validarPlano(this.datos);
  }

  // --- Áreas ------------------------------------------------------------------------

  crearArea(nombre: string): Resultado {
    const limpio = nombre.trim();
    if (limpio.length < 2) return { ok: false, error: "Escribe el nombre del área" };
    if (this.datos.areas.some((a) => a.nombre.trim().toLowerCase() === limpio.toLowerCase())) {
      return { ok: false, error: `Ya existe un área llamada "${limpio}"` };
    }

    const nueva: Area = {
      id: idCorto("area"),
      nombre: limpio,
      orden: this.datos.areas.length + 1,
      columnas: 10,
      filas: 7,
    };
    this.aplicar((p) => ({ ...p, areas: [...p.areas, nueva] }));
    this.areaActiva = nueva.id;
    return { ok: true };
  }

  renombrarArea(areaId: ID, nombre: string): Resultado {
    const limpio = nombre.trim();
    if (limpio.length < 2) return { ok: false, error: "El nombre no puede quedar vacío" };
    this.aplicar((p) => ({
      ...p,
      areas: p.areas.map((a) => (a.id === areaId ? { ...a, nombre: limpio } : a)),
    }));
    return { ok: true };
  }

  redimensionarArea(areaId: ID, columnas: number, filas: number): Resultado {
    const cols = Math.min(
      Math.max(Math.round(columnas), LIMITES_RETICULA.columnasMin),
      LIMITES_RETICULA.columnasMax,
    );
    const fils = Math.min(
      Math.max(Math.round(filas), LIMITES_RETICULA.filasMin),
      LIMITES_RETICULA.filasMax,
    );

    const area = areaDe(this.datos, areaId);
    if (!area) return { ok: false, error: "Área no encontrada" };

    const nueva: Area = { ...area, columnas: cols, filas: fils };
    const fuera = mesasDeArea(this.datos, areaId).filter((m) => !cabeEnArea(m, nueva));
    if (fuera.length > 0) {
      return {
        ok: false,
        error: `No se puede achicar: ${fuera.length} mesa(s) quedarían fuera (${fuera
          .map((m) => m.nombre)
          .join(", ")})`,
      };
    }

    this.aplicar((p) => ({
      ...p,
      areas: p.areas.map((a) => (a.id === areaId ? nueva : a)),
    }));
    return { ok: true };
  }

  eliminarArea(areaId: ID): Resultado {
    if (this.datos.areas.length <= 1) {
      return { ok: false, error: "El local necesita al menos un área" };
    }
    const conMesas = mesasDeArea(this.datos, areaId).length;
    if (conMesas > 0) {
      return {
        ok: false,
        error: `Quita primero las ${conMesas} mesa(s) del área`,
      };
    }

    this.aplicar((p) => ({ ...p, areas: p.areas.filter((a) => a.id !== areaId) }));
    if (this.areaActiva === areaId) {
      this.areaActiva = this.areas[0]?.id ?? "";
    }
    return { ok: true };
  }

  // --- Mesas --------------------------------------------------------------------------

  /** Siguiente nombre libre, para que el alta sea de un clic. */
  private siguienteNombre(): string {
    const numeros = this.datos.mesas
      .map((m) => Number(m.nombre))
      .filter((n) => Number.isFinite(n));
    const maximo = numeros.length > 0 ? Math.max(...numeros) : 0;
    return String(maximo + 1);
  }

  agregarMesa(areaId: ID, forma: FormaMesa = "cuadrada"): Resultado {
    const ancho = forma === "rectangular" ? 3 : 2;
    const alto = 2;
    const hueco = primerHuecoLibre(this.datos, areaId, ancho, alto);
    if (!hueco) return { ok: false, error: "No queda espacio libre en esta área" };

    const nueva: Mesa = {
      id: idCorto("mesa"),
      nombre: this.siguienteNombre(),
      area_id: areaId,
      columna: hueco.columna,
      fila: hueco.fila,
      ancho,
      alto,
      forma,
      activa: true,
    };
    this.aplicar((p) => ({ ...p, mesas: [...p.mesas, nueva] }));
    return { ok: true };
  }

  /** Mueve una mesa a una celda. Rechaza salirse de la retícula o encimarse. */
  moverMesa(mesaId: ID, columna: number, fila: number): Resultado {
    const mesa = mesaDe(this.datos, mesaId);
    if (!mesa) return { ok: false, error: "Mesa no encontrada" };
    const area = areaDe(this.datos, mesa.area_id);
    if (!area) return { ok: false, error: "Área no encontrada" };

    const movida: Mesa = { ...mesa, columna, fila };
    if (!cabeEnArea(movida, area)) return { ok: false, error: "La mesa se sale del área" };
    if (haySolape(movida, this.datos.mesas)) {
      return { ok: false, error: "Ahí ya hay otra mesa" };
    }

    this.aplicar((p) => ({
      ...p,
      mesas: p.mesas.map((m) => (m.id === mesaId ? movida : m)),
    }));
    return { ok: true };
  }

  redimensionarMesa(mesaId: ID, ancho: number, alto: number): Resultado {
    const mesa = mesaDe(this.datos, mesaId);
    if (!mesa) return { ok: false, error: "Mesa no encontrada" };
    const area = areaDe(this.datos, mesa.area_id);
    if (!area) return { ok: false, error: "Área no encontrada" };

    const nueva: Mesa = {
      ...mesa,
      ancho: Math.max(1, Math.min(ancho, area.columnas)),
      alto: Math.max(1, Math.min(alto, area.filas)),
    };
    if (!cabeEnArea(nueva, area)) return { ok: false, error: "No cabe en el área" };
    if (haySolape(nueva, this.datos.mesas)) return { ok: false, error: "Chocaría con otra mesa" };

    this.aplicar((p) => ({
      ...p,
      mesas: p.mesas.map((m) => (m.id === mesaId ? nueva : m)),
    }));
    return { ok: true };
  }

  /**
   * Fija cuántos comensales caben en una mesa.
   *
   * Se guarda el número tal cual lo dice el restaurante, acotado a los límites
   * del dominio. Pasar `null` borra el dato y devuelve la mesa a la estimación
   * por tamaño, que es lo correcto cuando alguien se arrepiente: dejar un número
   * viejo «pegado» sería peor que no tenerlo.
   */
  cambiarCapacidad(mesaId: ID, capacidad: number | null): Resultado {
    const mesa = mesaDe(this.datos, mesaId);
    if (!mesa) return { ok: false, error: "Mesa no encontrada" };

    let valor: number | undefined;
    if (capacidad !== null) {
      const entero = Math.round(capacidad);
      if (!Number.isFinite(entero)) return { ok: false, error: "Escribe un número" };
      if (entero < LIMITES_MESA.capacidadMin || entero > LIMITES_MESA.capacidadMax) {
        return {
          ok: false,
          error: `La capacidad va de ${LIMITES_MESA.capacidadMin} a ${LIMITES_MESA.capacidadMax} comensales`,
        };
      }
      valor = entero;
    }

    this.aplicar((p) => ({
      ...p,
      mesas: p.mesas.map((m) => (m.id === mesaId ? { ...m, capacidad: valor } : m)),
    }));
    return { ok: true };
  }

  cambiarForma(mesaId: ID, forma: FormaMesa): Resultado {
    this.aplicar((p) => ({
      ...p,
      mesas: p.mesas.map((m) => (m.id === mesaId ? { ...m, forma } : m)),
    }));
    return { ok: true };
  }

  renombrarMesa(mesaId: ID, nombre: string): Resultado {
    const limpio = nombre.trim();
    if (limpio.length === 0) return { ok: false, error: "La mesa necesita un identificador" };
    const repetido = this.datos.mesas.some(
      (m) => m.id !== mesaId && m.nombre.trim().toLowerCase() === limpio.toLowerCase(),
    );
    if (repetido) return { ok: false, error: `Ya hay una mesa "${limpio}"` };

    this.aplicar((p) => ({
      ...p,
      mesas: p.mesas.map((m) => (m.id === mesaId ? { ...m, nombre: limpio } : m)),
    }));
    return { ok: true };
  }

  eliminarMesa(mesaId: ID): Resultado {
    this.aplicar((p) => ({ ...p, mesas: p.mesas.filter((m) => m.id !== mesaId) }));
    return { ok: true };
  }

  /** Vuelve al plano de fábrica. */
  restablecer(): void {
    this.aplicar(() => planoPorDefecto());
    this.areaActiva = this.areas[0]?.id ?? "area-salon";
  }
}

export const plano = new StorePlano();
