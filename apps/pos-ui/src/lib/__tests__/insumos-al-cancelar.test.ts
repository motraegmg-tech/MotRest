/**
 * Lo que el platillo se lleva del almacén, y lo que devuelve.
 *
 * El descuento por receta ya existía: al mandar a cocina salen los gramos que
 * declara cada platillo. Lo que faltaba era la vuelta. Un platillo cancelado
 * seguía descontado para siempre, así que el almacén iba diciendo que quedaba
 * menos masa de la que había en el refrigerador, y la comparación de ideal
 * contra real acusaba una fuga que nunca ocurrió.
 *
 * Se prueba con el POS entero —no solo con el dominio— porque el error vivía
 * justo en la costura: el evento de cancelación se emitía bien y el almacén se
 * quedaba sin enterarse.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { porcionesPorDefecto, type ConfiguracionRenglon } from "@motrest/dominio";
import { catalogo } from "../catalogo";
import { insumosDeProducto } from "@motrest/dominio";
import { inventario } from "../inventario.svelte";
import { arranque } from "../persistencia/arranque.svelte";
import { plano } from "../plano.svelte";
import { pos } from "../pos.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

/**
 * Un platillo de la carta cargada que SÍ descuenta del almacén.
 *
 * Se busca en vez de fijarlo: la carta de demostración cambia, y una prueba que
 * apunte a "prod-pizza-mediana" dejaría de probar nada el día que ese id se
 * renombre — pasaría en verde sin ejercitar el descuento.
 */
function platilloQueConsume(): ConfiguracionRenglon {
  for (const producto of catalogo.productos.values()) {
    if (!producto.disponible) continue;
    const porciones = producto.esquema_porciones
      ? porcionesPorDefecto(producto.esquema_porciones)
      : undefined;
    if (insumosDeProducto(producto.id, catalogo, porciones).length > 0) {
      return { producto_id: producto.id, cantidad: 1, porciones };
    }
  }
  throw new Error("La carta de pruebas no tiene ningún platillo vinculado al almacén");
}

/** Foto de las existencias de todo el almacén, para comparar antes y después. */
function existencias(): Record<string, number> {
  return Object.fromEntries(inventario.insumos.map((i) => [i.id, inventario.cantidad(i.id)]));
}

/** Qué insumos cambiaron entre dos fotos. */
function movidos(antes: Record<string, number>, despues: Record<string, number>): string[] {
  return Object.keys(antes).filter((id) => antes[id] !== despues[id]);
}

let mesaLibre = 0;
/** Cada prueba se lleva su propia mesa: dos cuentas abiertas no se estorban. */
function siguienteMesa(): string {
  const mesa = plano.todasLasMesas[mesaLibre++];
  if (!mesa) throw new Error("Se acabaron las mesas del salón de pruebas");
  return mesa.id;
}

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", credencialesDeDemostracion().contrasena);
});

describe("el almacén sigue a la comanda", () => {
  it("mandar a cocina descuenta los insumos de la receta", async () => {
    const mesa = siguienteMesa();
    pos.seleccionarMesa(mesa);
    pos.abrirMesa(mesa);
    await pos.agregar(platilloQueConsume());

    const antes = existencias();
    await pos.enviarACocina();
    const despues = existencias();

    const cambiados = movidos(antes, despues);
    expect(cambiados.length).toBeGreaterThan(0);
    // Todo lo que se movió, se movió hacia abajo: el platillo se lo llevó.
    for (const id of cambiados) expect(despues[id]!).toBeLessThan(antes[id]!);
  });

  it("cancelar un platillo ya enviado devuelve exactamente lo que se llevó", async () => {
    const mesa = siguienteMesa();
    pos.seleccionarMesa(mesa);
    pos.abrirMesa(mesa);
    await pos.agregar(platilloQueConsume());

    const antesDeTodo = existencias();
    await pos.enviarACocina();
    expect(movidos(antesDeTodo, existencias()).length).toBeGreaterThan(0);

    const renglon = pos.renglones[0]!;
    await pos.cancelar(renglon.id);

    // Ni un gramo de más ni de menos: el almacén queda como estaba.
    expect(existencias()).toEqual(antesDeTodo);
  });

  it("la devolución se anota como movimiento nuevo, no borrando el descuento", () => {
    const reversos = inventario.movimientos.filter(
      (m) => m.tipo === "movimiento_inventario" && m.motivo === "reverso_receta",
    );
    const consumos = inventario.movimientos.filter(
      (m) => m.tipo === "movimiento_inventario" && m.motivo === "consumo_receta",
    );

    expect(reversos.length).toBeGreaterThan(0);
    expect(consumos.length).toBeGreaterThan(0);
    // El histórico conserva las dos caras: salió y volvió.
    for (const r of reversos) expect(r.tipo === "movimiento_inventario" && r.delta > 0).toBe(true);
  });

  /*
   * El renglón cancelado ya no está en la comanda, así que el POS no puede
   * devolverlo dos veces por esa vía. Se pide la devolución a mano —como haría
   * un reintento del propio sistema— para comprobar que el candado está en el
   * almacén y no en la pantalla.
   */
  it("un platillo no devuelve dos veces, aunque se pida dos veces", async () => {
    const mesa = siguienteMesa();
    pos.seleccionarMesa(mesa);
    pos.abrirMesa(mesa);
    await pos.agregar(platilloQueConsume());
    await pos.enviarACocina();

    const renglon = pos.renglones[0]!;
    await pos.cancelar(renglon.id);

    const yaDevuelto = existencias();
    expect(inventario.devolverPorCancelacion([renglon], "reintento")).toBe(0);
    expect(existencias()).toEqual(yaDevuelto);
  });

  it("cancelar ANTES de mandar a cocina no mueve el almacén", async () => {
    const mesa = siguienteMesa();
    pos.seleccionarMesa(mesa);
    pos.abrirMesa(mesa);
    await pos.agregar(platilloQueConsume());

    const antes = existencias();
    await pos.cancelar(pos.renglones[0]!.id);

    // Nunca salió nada, así que no hay nada que regresar.
    expect(existencias()).toEqual(antes);
  });

  it("mandar a cocina dos veces no descuenta dos veces", async () => {
    const mesa = siguienteMesa();
    pos.seleccionarMesa(mesa);
    pos.abrirMesa(mesa);
    await pos.agregar(platilloQueConsume());
    await pos.enviarACocina();

    const yaDescontado = existencias();
    // Reenviar los mismos renglones —un reintento de sincronización, por ejemplo—
    // no puede volver a vaciar el almacén.
    expect(inventario.consumirPorReceta(pos.renglones, "reintento")).toBe(0);
    expect(existencias()).toEqual(yaDescontado);
  });
});

describe("cancelar una venta ya cobrada", () => {
  it("regresa al almacén todo lo que esa cuenta se llevó", async () => {
    const mesa = siguienteMesa();
    pos.seleccionarMesa(mesa);
    const ordenId = pos.abrirMesa(mesa);

    const antesDeTodo = existencias();
    await pos.agregar(platilloQueConsume());
    await pos.enviarACocina();
    expect(movidos(antesDeTodo, existencias()).length).toBeGreaterThan(0);

    await pos.cobrarTodo("efectivo");
    expect(await pos.cancelarVenta(ordenId, "Se cobró la mesa equivocada")).toBe(true);

    expect(existencias()).toEqual(antesDeTodo);
    expect(pos.estadoMesa(mesa)).toBe("libre");
  });
});

describe("la utilización que se captura a mano", () => {
  it("resta del almacén, como cualquier otra salida", () => {
    const insumo = inventario.insumos[0]!;
    const antes = inventario.cantidad(insumo.id);

    // Se captura en positivo: el signo lo pone el motivo, no quien teclea.
    const r = inventario.registrar(insumo.id, 250, "utilizacion", "Prueba de cocina");

    expect(r.ok).toBe(true);
    expect(inventario.cantidad(insumo.id)).toBe(antes - 250);
  });

  it("no se confunde con la merma: es consumo declarado, no pérdida", () => {
    const insumo = inventario.insumos[0]!;
    const uso = inventario.consumoDe(insumo.id);

    expect(uso.utilizacion).toBeGreaterThan(0);
    // La merma es el número del que cuelga el cobro por ahorro verificado: si la
    // utilización cayera ahí, dejaría de significar «pérdida evitable».
    expect(uso.merma ?? 0).toBe(0);
  });
});
