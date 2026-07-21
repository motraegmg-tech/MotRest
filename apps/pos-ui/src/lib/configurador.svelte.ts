/**
 * Configurador genérico de productos.
 *
 * Sirve para CUALQUIER platillo: una pizza mitad y mitad, un rib eye que obliga
 * a elegir término y guarnición, una ensalada con dos aderezos incluidos o un
 * café sin nada que configurar. La pizza dejó de ser el centro: es un caso más.
 */
import {
  costoConfiguracion,
  describirConfiguracion,
  gruposDe,
  margen,
  opcionDe,
  porcionesPorDefecto,
  precioConfiguracion,
  productoDe,
  requiereConfiguracion,
  seleccionPorDefecto,
  unidadesDe,
  validarConfiguracion,
  type Centavos,
  type ConfiguracionRenglon,
  type GrupoModificadores,
  type ID,
  type OpcionModificador,
  type PorcionElegida,
  type Producto,
  type ProblemaSeleccion,
  type SeleccionModificador,
} from "@motrest/dominio";
import { catalogo } from "./catalogo";

class Configurador {
  productoId = $state<ID | null>(null);
  cantidad = $state(1);
  porciones = $state<PorcionElegida[]>([]);
  modificadores = $state<SeleccionModificador[]>([]);
  notas = $state("");

  // --- Estado -------------------------------------------------------------------

  get abierto(): boolean {
    return this.productoId !== null;
  }

  get producto(): Producto | null {
    return this.productoId ? productoDe(catalogo, this.productoId) : null;
  }

  get grupos(): GrupoModificadores[] {
    const p = this.producto;
    return p ? gruposDe(catalogo, p) : [];
  }

  get esquema() {
    return this.producto?.esquema_porciones;
  }

  get config(): ConfiguracionRenglon | null {
    if (!this.productoId) return null;
    return {
      producto_id: this.productoId,
      cantidad: this.cantidad,
      porciones: this.porciones.length > 0 ? this.porciones : undefined,
      modificadores: this.modificadores.length > 0 ? this.modificadores : undefined,
      notas: this.notas.trim() || undefined,
    };
  }

  // --- Cifras en vivo -------------------------------------------------------------

  get precioUnitario(): Centavos {
    const c = this.config;
    return c ? precioConfiguracion(c, catalogo).unitario : (0 as Centavos);
  }

  get precioBase(): Centavos {
    const c = this.config;
    return c ? precioConfiguracion(c, catalogo).base : (0 as Centavos);
  }

  get precioExtras(): Centavos {
    const c = this.config;
    return c ? precioConfiguracion(c, catalogo).modificadores : (0 as Centavos);
  }

  get costoUnitario(): Centavos {
    const c = this.config;
    return c ? costoConfiguracion(c, catalogo).unitario : (0 as Centavos);
  }

  get margen(): number {
    return margen(this.precioUnitario, this.costoUnitario);
  }

  get total(): Centavos {
    return (this.precioUnitario * this.cantidad) as Centavos;
  }

  get descripcion(): string | undefined {
    const c = this.config;
    return c ? describirConfiguracion(c, catalogo) : undefined;
  }

  // --- Validación -------------------------------------------------------------------

  get problemas(): ProblemaSeleccion[] {
    const c = this.config;
    return c ? validarConfiguracion(c, catalogo) : [];
  }

  get listo(): boolean {
    return this.abierto && this.problemas.length === 0;
  }

  // --- Apertura ----------------------------------------------------------------------

  /** ¿Este producto necesita pasar por el configurador, o se agrega directo? */
  necesitaConfigurar(productoId: ID): boolean {
    const producto = productoDe(catalogo, productoId);
    return requiereConfiguracion(
      gruposDe(catalogo, producto),
      !!producto.esquema_porciones,
    );
  }

  abrir(productoId: ID): void {
    const producto = productoDe(catalogo, productoId);
    this.productoId = productoId;
    this.cantidad = 1;
    this.notas = "";
    this.porciones = producto.esquema_porciones
      ? porcionesPorDefecto(producto.esquema_porciones)
      : [];
    this.modificadores = seleccionPorDefecto(gruposDe(catalogo, producto));
  }

  cerrar(): void {
    this.productoId = null;
    this.porciones = [];
    this.modificadores = [];
    this.notas = "";
    this.cantidad = 1;
  }

  // --- Porciones -----------------------------------------------------------------------

  elegirPorcion(ranuraId: ID, productoId: ID): void {
    this.porciones = this.porciones.map((p) =>
      p.ranura_id === ranuraId ? { ...p, producto_id: productoId } : p,
    );
  }

  porcionDe(ranuraId: ID): PorcionElegida | undefined {
    return this.porciones.find((p) => p.ranura_id === ranuraId);
  }

  // --- Modificadores -------------------------------------------------------------------

  seleccionado(opcionId: ID): SeleccionModificador | undefined {
    return this.modificadores.find((s) => s.opcion_id === opcionId);
  }

  private nuevaSeleccion(
    grupo: GrupoModificadores,
    opcion: OpcionModificador,
  ): SeleccionModificador {
    return {
      grupo_id: grupo.id,
      grupo_nombre: grupo.nombre,
      opcion_id: opcion.id,
      opcion_nombre: opcion.nombre,
      precio_delta: opcion.precio_delta,
      costo_delta: opcion.costo_delta,
      cantidad: 1,
    };
  }

  /**
   * Alterna una opción. En grupos de selección única sustituye a la anterior;
   * en los de selección múltiple agrega o quita, respetando el máximo.
   */
  alternar(grupo: GrupoModificadores, opcion: OpcionModificador): void {
    if (!opcion.disponible) return;
    const yaEsta = this.seleccionado(opcion.id);

    if (grupo.seleccion === "uno") {
      const otras = this.modificadores.filter((s) => s.grupo_id !== grupo.id);
      // Si el grupo es obligatorio, volver a tocar la misma opción no la quita.
      if (yaEsta && grupo.min === 0) {
        this.modificadores = otras;
        return;
      }
      this.modificadores = [...otras, this.nuevaSeleccion(grupo, opcion)];
      return;
    }

    if (yaEsta) {
      this.modificadores = this.modificadores.filter((s) => s.opcion_id !== opcion.id);
      return;
    }

    if (grupo.max > 0 && unidadesDe(this.modificadores, grupo.id) >= grupo.max) return;
    this.modificadores = [...this.modificadores, this.nuevaSeleccion(grupo, opcion)];
  }

  /** Sube o baja las repeticiones de una opción ("doble queso"). */
  repetir(grupoId: ID, opcionId: ID, delta: number): void {
    const grupo = catalogo.grupos.get(grupoId);
    const opcion = grupo ? opcionDe(grupo, opcionId) : undefined;
    if (!grupo || !opcion) return;

    this.modificadores = this.modificadores.flatMap((s) => {
      if (s.opcion_id !== opcionId) return [s];
      const cantidad = s.cantidad + delta;
      if (cantidad <= 0) return [];
      if (cantidad > opcion.max_repeticiones) return [s];
      if (grupo.max > 0 && unidadesDe(this.modificadores, grupoId) + delta > grupo.max) {
        return [s];
      }
      return [{ ...s, cantidad }];
    });
  }

  cambiarCantidad(delta: number): void {
    this.cantidad = Math.max(1, Math.min(99, this.cantidad + delta));
  }
}

export const configurador = new Configurador();
