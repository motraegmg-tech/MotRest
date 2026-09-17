/**
 * PRODUCTOS QUE SON SU PROPIO INSUMO.
 *
 * Pedido de Gonzalo. Una Coca-Cola no se prepara: la que entra al almacén es
 * exactamente la que sale a la mesa, una por una. Pero para que el sistema lo
 * supiera había que dar cuatro vueltas —alta del insumo en Administración, alta
 * del producto en el Menú, volver al producto a declararle «1 pieza de sí
 * mismo», y cargar la existencia en Inventario—, cuatro pantallas distintas
 * para decir una sola cosa. Con treinta bebidas son ciento veinte vueltas, y el
 * final previsible es que nadie las da: las bebidas se quedan fuera del
 * inventario y el almacén miente justo en lo que más se roba.
 *
 * Aquí vive el gesto completo, una vez, y de él cuelgan las cinco entradas que
 * se pidieron: la casilla del alta (A), convertir lo ya capturado (B), la
 * categoría marcada de reventa (C), el importador de la carta (D) y el alta
 * rápida de embotellados (E).
 *
 * ## Qué significa «vinculado 1:1»
 *
 * El producto tiene una receta con UN ingrediente: su propio insumo, cantidad
 * 1, unidad `pz`. Nada nuevo en el modelo de datos — es exactamente la misma
 * receta que ya sabía descontar existencias al enviar a cocina y devolverlas al
 * cancelar. Lo único que cambia es quién la escribe.
 */
import {
  pesos,
  recetaNueva,
  type BorradorProducto,
  type Centavos,
  type ID,
  type Insumo,
  type ProblemaMenu,
  type Receta,
} from "@motrest/dominio";
import { inventario } from "./inventario.svelte";
import { menu } from "./menu.svelte";
import { sesion } from "./sesion/sesion.svelte";

export interface ResultadoReventa {
  /** Todo salió bien, siembra de existencia incluida. */
  ok: boolean;
  /**
   * EL PRODUCTO Y SU ENLACE CON EL ALMACÉN QUEDARON HECHOS.
   *
   * Existe porque `ok` no basta para decidir qué hacer después, y confundirlos
   * tiene consecuencias: si falla solo la siembra de la existencia, `ok` es
   * `false` pero el producto SÍ está creado. Quien lea únicamente `ok` devolverá
   * ese renglón a la tabla para reintentarlo, y el segundo intento chocará
   * contra «ya existe un producto con ese nombre» — un error que no explica
   * nada y que deja al usuario convencido de que perdió el trabajo.
   *
   * Regla: `creado` decide si hay que reintentar; `problemas` es lo que se le
   * enseña al usuario.
   */
  creado: boolean;
  problemas: ProblemaMenu[];
  productoId?: ID;
  insumoId?: ID;
}

function error(campo: string, mensaje: string): ResultadoReventa {
  return { ok: false, creado: false, problemas: [{ campo, mensaje, gravedad: "error" }] };
}

/**
 * El mínimo con el que nace un insumo de reventa.
 *
 * No es cero a propósito: `validarInsumo` avisa —con razón— de que un insumo sin
 * mínimo nunca aparece en la lista de reposición, y una bebida que se acaba el
 * sábado por la noche es justo lo que hay que ver venir. Seis es una media caja;
 * quien quiera otro número lo cambia en la ficha.
 */
export const MINIMO_POR_DEFECTO = 6;

/** La categoría de despensa donde caen las bebidas si nadie dice otra cosa. */
export const CATEGORIA_INSUMO_POR_DEFECTO = "Bebidas";

/**
 * ¿Este producto es su propio insumo?
 *
 * Se reconoce por la forma de la receta y no por una marca guardada aparte: una
 * marca podría quedarse diciendo que sí después de que alguien le añadiera un
 * segundo ingrediente, y entonces la pantalla prometería algo que el almacén ya
 * no cumple. La receta es la verdad.
 */
export function insumoEspejoDe(productoId: ID): Insumo | undefined {
  const receta = menu.recetaDe(productoId);
  if (!receta || receta.ingredientes.length !== 1) return undefined;

  const unico = receta.ingredientes[0];
  if (!unico?.insumo_id || unico.cantidad !== 1 || unico.unidad !== "pz") return undefined;
  return inventario.insumo(unico.insumo_id);
}

export function esDeReventa(productoId: ID): boolean {
  return insumoEspejoDe(productoId) !== undefined;
}

/**
 * ¿Este insumo ya se vende, vinculado 1:1 a un producto de la carta?
 *
 * Es la inversa de `insumoEspejoDe`, y NO es su calco. Aquella va del producto
 * al insumo pasando por `menu.recetaDe`, que exige permiso de editar recetas;
 * esta mira las recetas que USAN el insumo, que se consultan siempre. La
 * diferencia importa: si dependiera del permiso, a quien no lo tiene le saldría
 * «Ponerlo en la carta» en TODOS los insumos, incluidos los que ya están en ella.
 */
export function estaEnLaCarta(insumoId: ID): boolean {
  return menu.recetasQueUsan(insumoId).some((receta) => {
    const unico = receta.ingredientes[0];
    return (
      receta.ingredientes.length === 1 &&
      unico?.insumo_id === insumoId &&
      unico.cantidad === 1 &&
      unico.unidad === "pz"
    );
  });
}

/** ¿Está marcada de reventa la categoría en la que cae este producto? */
export function categoriaEsDeReventa(categoriaId: ID): boolean {
  return menu.categorias.find((c) => c.id === categoriaId)?.reventa === true;
}

/** La receta de un producto que se vende tal cual: un renglón, una pieza. */
export function recetaEspejo(nombreProducto: string, insumo: Insumo, previa?: Receta): Receta {
  const base = previa ?? recetaNueva(nombreProducto);
  return {
    ...base,
    nombre: nombreProducto || base.nombre,
    ingredientes: [
      {
        id: base.ingredientes[0]?.id ?? `ing-${insumo.id}`,
        nombre: insumo.nombre,
        costo: insumo.costo_unitario,
        insumo_id: insumo.id,
        cantidad: 1,
        unidad: "pz",
      },
    ],
  };
}

/**
 * Da de alta el insumo espejo de un producto que se vende tal cual.
 *
 * Si ya existe uno con ese nombre NO se crea otro: se reutiliza. Dos insumos
 * «Coca-Cola 600 ml» son dos existencias que se llevan por separado, y el
 * inventario de las bebidas deja de significar nada. Es además lo que hace que
 * convertir un producto ya capturado (propuesta B) no duplique la despensa de
 * quien ya había dado de alta sus refrescos a mano.
 */
export function insumoEspejoParaNombre(
  nombre: string,
  costo: Centavos,
  categoriaInsumo = CATEGORIA_INSUMO_POR_DEFECTO,
  stockMinimo = MINIMO_POR_DEFECTO,
): { insumo?: Insumo; problemas: ProblemaMenu[] } {
  const limpio = nombre.trim();
  const normaliza = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim()
      .toLowerCase();

  const existente = menu.insumos.find((i) => normaliza(i.nombre) === normaliza(limpio));
  if (existente) return { insumo: existente, problemas: [] };

  const r = menu.crearInsumo({
    nombre: limpio,
    unidad_base: "pz",
    costo_unitario: costo,
    stock_minimo: stockMinimo,
    categoria: categoriaInsumo.trim() || undefined,
  });
  if (!r.ok || !r.id) return { problemas: r.problemas };

  return { insumo: menu.insumos.find((i) => i.id === r.id), problemas: r.problemas };
}

/**
 * Siembra la existencia inicial de un insumo recién creado.
 *
 * Va como **ajuste por conteo** y no como recepción de compra: nadie está
 * registrando una entrada de proveedor, se está diciendo cuántas hay ahorita en
 * el refrigerador. Meterlo como recepción inflaría las compras del día en el
 * resultado, y ese número decide precios.
 */
export function sembrarExistencia(insumoId: ID, cantidad: number): ProblemaMenu[] {
  if (!Number.isFinite(cantidad) || cantidad <= 0) return [];
  const r = inventario.registrar(
    insumoId,
    cantidad,
    "ajuste_conteo",
    "Existencia inicial al dar de alta",
    sesion.usuarioActual?.id,
  );
  return r.ok
    ? []
    : [{ campo: "existencia", mensaje: r.error ?? "No se pudo cargar la existencia", gravedad: "error" }];
}

/**
 * Convierte un producto YA capturado en uno que se vende tal cual.
 *
 * Es la propuesta B, y es la que sirve hoy: Rodizio tiene la carta cargada desde
 * hace meses, así que una casilla en el alta no le resuelve ni una bebida.
 */
export function convertirEnReventa(
  productoId: ID,
  opciones: { costo?: Centavos; categoriaInsumo?: string; existencia?: number } = {},
): ResultadoReventa {
  const producto = menu.producto(productoId);
  if (!producto) return error("producto", "No se encontró el producto");

  const yaTiene = insumoEspejoDe(productoId);
  if (yaTiene) {
    /*
     * Ya estaba vinculado: lo único que puede haber cambiado es el costo, y ahí
     * sí hay que seguirlo. El sentido de todo esto es que el producto y su
     * insumo sean UNA cosa; si al subir el precio de compra en la ficha del
     * refresco el almacén se quedara con el del año pasado, el valor del
     * inventario y el food cost volverían a divergir en silencio, que es
     * exactamente lo que se venía a resolver.
     */
    const costoNuevo = opciones.costo ?? producto.costo;
    if (costoNuevo !== undefined && costoNuevo !== yaTiene.costo_unitario) {
      menu.actualizarInsumo(yaTiene.id, {
        nombre: yaTiene.nombre,
        unidad_base: yaTiene.unidad_base,
        costo_unitario: costoNuevo,
        stock_minimo: yaTiene.stock_minimo,
        categoria: yaTiene.categoria,
      });
    }
    const deLaSiembra = sembrarExistencia(yaTiene.id, opciones.existencia ?? 0);
    return {
      ok: deLaSiembra.length === 0,
      creado: true,
      problemas: deLaSiembra,
      productoId,
      insumoId: yaTiene.id,
    };
  }

  const receta = menu.recetaDe(productoId);
  if (receta && receta.ingredientes.length > 0) {
    return error(
      "receta",
      "Este producto ya tiene receta. Un producto que se vende tal cual lleva un solo renglón: él mismo.",
    );
  }

  /*
   * El costo sale de la ficha del producto si nadie da otro. Es el que el
   * administrador ya capturó como «lo que me cuesta», que para algo que se
   * compra hecho es literalmente lo que se le paga al proveedor.
   */
  const costo = opciones.costo ?? producto.costo ?? pesos(0);

  const { insumo, problemas } = insumoEspejoParaNombre(
    producto.nombre,
    costo,
    opciones.categoriaInsumo,
  );
  if (!insumo) return { ok: false, creado: false, problemas };

  const guardada = menu.guardarRecetaDe(
    productoId,
    recetaEspejo(producto.nombre, insumo, receta ?? undefined),
  );
  if (!guardada.ok) return { ok: false, creado: false, problemas: guardada.problemas };

  const deLaSiembra = sembrarExistencia(insumo.id, opciones.existencia ?? 0);
  return {
    ok: deLaSiembra.length === 0,
    creado: true,
    problemas: [...problemas, ...deLaSiembra],
    productoId,
    insumoId: insumo.id,
  };
}

/**
 * Pone en la carta un insumo que ya estaba en el almacén — el camino inverso.
 *
 * Quien cargó sus refrescos como insumos para poder contarlos se encuentra con
 * que no se pueden vender, y volver a teclear los mismos treinta nombres en el
 * Menú es el momento en que se abandona la tarea.
 */
export function ponerEnLaCarta(
  insumoId: ID,
  datos: { categoria_id: ID; precio: Centavos; impuesto_id: ID },
): ResultadoReventa {
  const insumo = inventario.insumo(insumoId);
  if (!insumo) return error("insumo", "No se encontró el insumo");
  if (insumo.unidad_base !== "pz") {
    return error(
      "insumo",
      `«${insumo.nombre}» se lleva en ${insumo.unidad_base}. Solo lo que se cuenta por piezas se vende tal cual.`,
    );
  }

  return altaDeReventa({
    nombre: insumo.nombre,
    categoria_id: datos.categoria_id,
    costo: insumo.costo_unitario,
    precio: datos.precio,
    impuesto_id: datos.impuesto_id,
    categoriaInsumo: insumo.categoria,
  });
}

export interface AltaDeReventa {
  nombre: string;
  categoria_id: ID;
  /** A cómo se compra UNA pieza. */
  costo: Centavos;
  /** A cómo se vende, con el impuesto dentro. */
  precio: Centavos;
  impuesto_id: ID;
  /** Cuántas hay ahorita. Cero o ausente = no se siembra nada. */
  existencia?: number;
  /** En qué categoría de la DESPENSA se guarda el insumo. */
  categoriaInsumo?: string;
  stockMinimo?: number;
  estacion_id?: ID;
}

/**
 * El gesto completo, de una sola vez: insumo + producto + receta 1:1 +
 * existencia inicial. Es lo que usan el alta rápida (E) y el importador (D).
 *
 * El orden importa. Primero el insumo, porque la receta lo necesita; después el
 * producto, porque su id no existe hasta que está creado; la receta al final. Si
 * algo falla a medias se devuelve el problema con lo que sí quedó: dejar el
 * insumo creado y el producto no es recuperable a mano —se ve en Insumos— y en
 * cambio deshacerlo silenciosamente borraría existencias si el insumo ya existía
 * de antes.
 */
export function altaDeReventa(datos: AltaDeReventa): ResultadoReventa {
  const { insumo, problemas } = insumoEspejoParaNombre(
    datos.nombre,
    datos.costo,
    datos.categoriaInsumo,
    datos.stockMinimo,
  );
  if (!insumo) return { ok: false, creado: false, problemas };

  const borrador: BorradorProducto = {
    nombre: datos.nombre.trim(),
    categoria_id: datos.categoria_id,
    costo: datos.costo,
    precio: datos.precio,
    impuesto_id: datos.impuesto_id,
    // El precio tecleado es el DE LA CARTA, con impuesto dentro: es lo que el
    // restaurantero tiene en la cabeza y en la pared.
    precio_incluye_impuesto: true,
    disponible: true,
    estacion_id: datos.estacion_id,
  };

  const producto = menu.crearProducto(borrador);
  if (!producto.ok || !producto.id) {
    return {
      ok: false,
      creado: false,
      problemas: [...problemas, ...producto.problemas],
      insumoId: insumo.id,
    };
  }

  /*
   * La receta se guarda contra el id DEFINITIVO, que no existe hasta que el
   * producto está creado. Si falla, el producto queda en la carta sin enlace
   * con el almacén: `creado` va en false para que quien llame lo reintente, y
   * `productoId` viaja igual para que se pueda ver cuál quedó a medias.
   */
  const guardada = menu.guardarRecetaDe(producto.id, recetaEspejo(borrador.nombre, insumo));
  if (!guardada.ok) {
    return {
      ok: false,
      creado: false,
      problemas: [...problemas, ...guardada.problemas],
      productoId: producto.id,
      insumoId: insumo.id,
    };
  }

  const deLaSiembra = sembrarExistencia(insumo.id, datos.existencia ?? 0);
  return {
    ok: deLaSiembra.length === 0,
    creado: true,
    problemas: [...problemas, ...producto.problemas, ...deLaSiembra],
    productoId: producto.id,
    insumoId: insumo.id,
  };
}
