/**
 * Store del menú: el catálogo que el propio restaurante da de alta.
 *
 * Hasta la etapa 8 el menú vivía escrito en `catalogo.ts`. Ahora esos datos son
 * solo la SIEMBRA de demostración: en cuanto alguien edita algo, manda lo que
 * está guardado en el dispositivo.
 *
 * Como el plano de piso, el menú es catálogo y no operación: instantánea
 * versionada (TRD §5.2), no event log.
 *
 * La visibilidad de costos NO se resuelve aquí con condicionales de pantalla: se
 * pide al dominio una vista ya filtrada, de modo que el dato que no corresponde
 * ver ni siquiera llega al componente.
 */
import {
  agregarCategoria,
  agregarEstacion,
  agregarInsumo,
  agregarProducto,
  bloquean,
  cambiarDisponibilidad,
  editarEstacion,
  editarInsumo,
  editarProducto,
  eliminarCategoria,
  eliminarEstacion,
  eliminarInsumo,
  eliminarProducto,
  guardarReceta,
  indexar,
  menuPorCategoria,
  productosEnCategoria,
  productosEnEstacion,
  recetasConInsumo,
  resumenMenu,
  validarCategoria,
  validarEstacion,
  validarInsumo,
  validarProducto,
  vistaProducto,
  type BorradorEstacion,
  type BorradorInsumo,
  type BorradorProducto,
  type CatalogoIndex,
  type CategoriaConProductos,
  type EstacionKds,
  type ID,
  type Insumo,
  type MenuLocal,
  type PermisosMenu,
  type ProblemaMenu,
  type ProductoVisible,
  type Receta,
  type ResumenMenu,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { sesion } from "./sesion/sesion.svelte";

export const CLAVE_MENU = "menu_local";

export interface ResultadoMenu {
  ok: boolean;
  problemas: ProblemaMenu[];
}

const SIN_PROBLEMAS: ResultadoMenu = { ok: true, problemas: [] };

class StoreMenu {
  private datos = $state.raw<MenuLocal | null>(null);
  private almacen: Almacen | null = null;

  // --- Persistencia ------------------------------------------------------------------

  /**
   * Carga el menú guardado. Si no hay ninguno, se queda con la siembra que le
   * pasa el arranque: así un local nuevo abre con algo usable y uno que ya
   * configuró su carta la conserva.
   */
  async hidratar(almacen: Almacen, siembra: MenuLocal): Promise<void> {
    const guardado = await almacen.estado.cargar<MenuLocal>(CLAVE_MENU);
    this.datos =
      guardado && guardado.productos.length > 0 ? guardado : siembra;
  }

  /** Siembra sin almacén, para pruebas y para el arranque en memoria. */
  sembrar(siembra: MenuLocal): void {
    this.datos ??= siembra;
  }

  conectarAlmacen(almacen: Almacen): void {
    this.almacen = almacen;
  }

  private aplicar(cambio: (menu: MenuLocal) => MenuLocal): void {
    const actual = this.datos;
    if (!actual) return;
    this.datos = cambio(actual);
    void this.almacen?.estado.guardar(CLAVE_MENU, this.datos).catch((causa) => {
      console.error("No se pudo guardar el menú", causa);
    });
  }

  // --- Lectura -------------------------------------------------------------------------

  get menu(): MenuLocal | null {
    return this.datos;
  }

  /** Índice para el POS, el configurador y el inventario. */
  get index(): CatalogoIndex {
    const m = this.datos;
    return indexar(
      m ?? { productos: [], categorias: [], recetas: [], impuestos: [], grupos: [] },
    );
  }

  /**
   * Lo que el usuario en turno puede ver y hacer sobre el menú.
   *
   * Se deriva de la matriz de permisos, no de una lista de roles: si mañana se
   * le da `fin.costo.ver` a alguien más, los costos aparecen sin tocar código.
   */
  get permisos(): PermisosMenu {
    return {
      verCostos: sesion.puedeVer("fin.costo.ver"),
      verRecetas: sesion.puedeVer("cocina.receta.ver"),
      editarProductos: sesion.puedeOperar("cat.producto.editar"),
      editarPrecios: sesion.puedeOperar("cat.precio.editar"),
      editarRecetas: sesion.puedeOperar("cocina.receta.editar"),
    };
  }

  get porCategoria(): CategoriaConProductos[] {
    return menuPorCategoria(this.index, this.permisos);
  }

  get resumen(): ResumenMenu {
    return resumenMenu(this.index, this.permisos);
  }

  get categorias() {
    return [...(this.datos?.categorias ?? [])].sort((a, b) => a.orden - b.orden);
  }

  get impuestos() {
    return this.datos?.impuestos ?? [];
  }

  /** Vista de un producto, ya filtrada por lo que este perfil puede ver. */
  producto(productoId: ID): ProductoVisible | null {
    const p = this.datos?.productos.find((x) => x.id === productoId);
    return p ? vistaProducto(p, this.index, this.permisos) : null;
  }

  /** La receta cruda, para editarla. Solo con permiso de edición. */
  recetaDe(productoId: ID): Receta | null {
    if (!this.permisos.editarRecetas) return null;
    const p = this.datos?.productos.find((x) => x.id === productoId);
    if (!p?.receta_id) return null;
    return this.datos?.recetas.find((r) => r.id === p.receta_id) ?? null;
  }

  cuantosEnCategoria(categoriaId: ID): number {
    return this.datos ? productosEnCategoria(this.datos, categoriaId) : 0;
  }

  // --- Edición ---------------------------------------------------------------------------

  /**
   * Valida sin guardar, para el aviso en vivo del formulario.
   * Devuelve también las advertencias, que se muestran pero no impiden guardar.
   */
  revisar(borrador: BorradorProducto, productoId?: ID): ProblemaMenu[] {
    return this.datos ? validarProducto(borrador, this.datos, productoId) : [];
  }

  crearProducto(borrador: BorradorProducto): ResultadoMenu {
    if (!this.datos) return { ok: false, problemas: [] };
    if (!this.permisos.editarProductos) {
      return {
        ok: false,
        problemas: [
          { campo: "permiso", mensaje: "Tu perfil no puede editar el menú", gravedad: "error" },
        ],
      };
    }

    const problemas = validarProducto(borrador, this.datos);
    if (bloquean(problemas)) return { ok: false, problemas };

    this.aplicar((m) => agregarProducto(m, borrador));
    return { ok: true, problemas };
  }

  actualizarProducto(productoId: ID, borrador: BorradorProducto): ResultadoMenu {
    if (!this.datos) return { ok: false, problemas: [] };

    const previo = this.datos.productos.find((p) => p.id === productoId);
    if (!previo) return { ok: false, problemas: [] };

    // Cambiar el precio de carta es una acción aparte: se puede tener permiso
    // de corregir la ficha de un platillo sin poder retocar lo que se cobra.
    const cambiaPrecio = previo.precio !== borrador.precio;
    if (!this.permisos.editarProductos || (cambiaPrecio && !this.permisos.editarPrecios)) {
      return {
        ok: false,
        problemas: [
          {
            campo: "permiso",
            mensaje: cambiaPrecio
              ? "Tu perfil no puede cambiar precios de carta"
              : "Tu perfil no puede editar el menú",
            gravedad: "error",
          },
        ],
      };
    }

    const problemas = validarProducto(borrador, this.datos, productoId);
    if (bloquean(problemas)) return { ok: false, problemas };

    this.aplicar((m) => editarProducto(m, productoId, borrador));
    return { ok: true, problemas };
  }

  borrarProducto(productoId: ID): ResultadoMenu {
    if (!this.permisos.editarProductos) return { ok: false, problemas: [] };
    this.aplicar((m) => eliminarProducto(m, productoId));
    return SIN_PROBLEMAS;
  }

  alternarDisponibilidad(productoId: ID): ResultadoMenu {
    if (!this.permisos.editarProductos) return { ok: false, problemas: [] };
    const actual = this.datos?.productos.find((p) => p.id === productoId);
    if (!actual) return { ok: false, problemas: [] };
    this.aplicar((m) => cambiarDisponibilidad(m, productoId, !actual.disponible));
    return SIN_PROBLEMAS;
  }

  crearCategoria(nombre: string): ResultadoMenu {
    if (!this.datos || !this.permisos.editarProductos) return { ok: false, problemas: [] };
    const problemas = validarCategoria(nombre, this.datos);
    if (bloquean(problemas)) return { ok: false, problemas };
    this.aplicar((m) => agregarCategoria(m, nombre));
    return SIN_PROBLEMAS;
  }

  borrarCategoria(categoriaId: ID): ResultadoMenu {
    if (!this.datos || !this.permisos.editarProductos) return { ok: false, problemas: [] };
    if (productosEnCategoria(this.datos, categoriaId) > 0) {
      return {
        ok: false,
        problemas: [
          {
            campo: "categoria",
            mensaje: "Mueve o elimina primero sus platillos",
            gravedad: "error",
          },
        ],
      };
    }
    this.aplicar((m) => eliminarCategoria(m, categoriaId));
    return SIN_PROBLEMAS;
  }

  // --- Insumos y estaciones (M9) --------------------------------------------------------

  get insumos(): Insumo[] {
    return this.datos?.insumos ?? [];
  }

  get estaciones(): EstacionKds[] {
    return [...(this.datos?.estaciones ?? [])].sort((a, b) => a.orden - b.orden);
  }

  /** Recetas que se romperían al borrar un insumo. */
  recetasQueUsan(insumoId: ID): Receta[] {
    return this.datos ? recetasConInsumo(this.datos, insumoId) : [];
  }

  cuantosEnEstacion(estacionId: ID): number {
    return this.datos ? productosEnEstacion(this.datos, estacionId) : 0;
  }

  private soloAdmin(): ResultadoMenu | null {
    if (this.permisos.editarProductos) return null;
    return {
      ok: false,
      problemas: [
        { campo: "permiso", mensaje: "Tu perfil no puede editar el catálogo", gravedad: "error" },
      ],
    };
  }

  crearInsumo(borrador: BorradorInsumo): ResultadoMenu {
    const veto = this.soloAdmin();
    if (veto || !this.datos) return veto ?? { ok: false, problemas: [] };

    const problemas = validarInsumo(borrador, this.datos);
    if (bloquean(problemas)) return { ok: false, problemas };
    this.aplicar((m) => agregarInsumo(m, borrador));
    return { ok: true, problemas };
  }

  actualizarInsumo(insumoId: ID, borrador: BorradorInsumo): ResultadoMenu {
    const veto = this.soloAdmin();
    if (veto || !this.datos) return veto ?? { ok: false, problemas: [] };

    const problemas = validarInsumo(borrador, this.datos, insumoId);
    if (bloquean(problemas)) return { ok: false, problemas };
    this.aplicar((m) => editarInsumo(m, insumoId, borrador));
    return { ok: true, problemas };
  }

  borrarInsumo(insumoId: ID): ResultadoMenu {
    const veto = this.soloAdmin();
    if (veto || !this.datos) return veto ?? { ok: false, problemas: [] };

    const enUso = recetasConInsumo(this.datos, insumoId);
    if (enUso.length > 0) {
      return {
        ok: false,
        problemas: [
          {
            campo: "insumo",
            mensaje: `Lo usan ${enUso.length} receta(s): ${enUso.map((r) => r.nombre).join(", ")}`,
            gravedad: "error",
          },
        ],
      };
    }
    this.aplicar((m) => eliminarInsumo(m, insumoId));
    return SIN_PROBLEMAS;
  }

  crearEstacion(borrador: BorradorEstacion): ResultadoMenu {
    const veto = this.soloAdmin();
    if (veto || !this.datos) return veto ?? { ok: false, problemas: [] };

    const problemas = validarEstacion(borrador, this.datos);
    if (bloquean(problemas)) return { ok: false, problemas };
    this.aplicar((m) => agregarEstacion(m, borrador));
    return { ok: true, problemas };
  }

  actualizarEstacion(estacionId: ID, borrador: BorradorEstacion): ResultadoMenu {
    const veto = this.soloAdmin();
    if (veto || !this.datos) return veto ?? { ok: false, problemas: [] };

    const problemas = validarEstacion(borrador, this.datos, estacionId);
    if (bloquean(problemas)) return { ok: false, problemas };
    this.aplicar((m) => editarEstacion(m, estacionId, borrador));
    return { ok: true, problemas };
  }

  borrarEstacion(estacionId: ID): ResultadoMenu {
    const veto = this.soloAdmin();
    if (veto) return veto;
    this.aplicar((m) => eliminarEstacion(m, estacionId));
    return SIN_PROBLEMAS;
  }

  guardarRecetaDe(productoId: ID, receta: Receta): ResultadoMenu {
    if (!this.permisos.editarRecetas) {
      return {
        ok: false,
        problemas: [
          { campo: "permiso", mensaje: "Tu perfil no puede editar recetas", gravedad: "error" },
        ],
      };
    }
    // Los ingredientes en blanco se descartan: son renglones que se agregaron y
    // no se llenaron, no una intención de guardar un insumo sin nombre.
    const limpia: Receta = {
      ...receta,
      ingredientes: receta.ingredientes.filter((i) => i.nombre.trim().length > 0),
    };
    this.aplicar((m) => guardarReceta(m, productoId, limpia));
    return SIN_PROBLEMAS;
  }
}

export const menu = new StoreMenu();
