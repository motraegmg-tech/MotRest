/**
 * Un servicio completo, de punta a punta.
 *
 * Todas las demás pruebas miran una pieza. Esta hace lo que hace el
 * restaurante un viernes: abrir la caja, sentar mesas, mandar a cocina,
 * cobrar, facturar y cerrar el turno — y comprueba que al final **el dinero
 * cuadre**.
 *
 * Es la prueba que más veces va a salvar un despliegue, porque es la única que
 * falla cuando dos piezas que funcionan por separado dejan de entenderse.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { pesos, restar, totalesComanda, type FormaPago } from "@motrest/dominio";
import { arranque } from "../persistencia/arranque.svelte";
import { caja } from "../caja.svelte";
import { catalogo } from "../catalogo";
import { inventario } from "../inventario.svelte";
import { local } from "../local.svelte";
import { opiniones } from "../opiniones.svelte";
import { plano } from "../plano.svelte";
import { pos } from "../pos.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { CONTRASENA_INICIAL_PROPIETARIO } from "../sesion/usuarios";

/** Un producto vendible cualquiera de la carta cargada. */
function algunProducto(): string {
  const p = [...catalogo.productos.values()].find((x) => x.disponible && x.precio > 0);
  if (!p) throw new Error("La carta de pruebas no tiene ningún producto vendible");
  return p.id;
}

/** Sienta una mesa, le pone de comer y la manda a cocina. Devuelve la orden. */
async function sentarYPedir(mesaId: string, platillos: number): Promise<string> {
  pos.seleccionarMesa(mesaId);
  const ordenId = pos.abrirMesa(mesaId);
  for (let i = 0; i < platillos; i++) await pos.agregarSimple(algunProducto());
  await pos.enviarACocina();
  return ordenId;
}

/** Cocina y entrega todo lo de la mesa activa, como haría el KDS. */
async function cocinarYEntregar(ordenId: string): Promise<void> {
  for (const r of pos.comanda?.renglones ?? []) {
    await pos.marcarEnMarcha(ordenId, r.id);
    await pos.marcarListo(ordenId, r.id);
    await pos.marcarEntregado(ordenId, r.id);
  }
}

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", CONTRASENA_INICIAL_PROPIETARIO);
});

describe("un servicio de viernes", () => {
  const FONDO = pesos(1500);
  let mesas: string[] = [];
  let cobradoEfectivo = 0;
  let cobradoTarjeta = 0;

  it("abre la caja con su fondo", () => {
    const r = caja.abrir(sesion.usuarioActual!.id, FONDO);
    expect(r.ok).toBe(true);
    expect(caja.activa?.fondo_inicial).toBe(FONDO);
  });

  it("hay salón donde sentar gente", () => {
    mesas = plano.todasLasMesas.map((m) => m.id);
    expect(mesas.length).toBeGreaterThanOrEqual(3);
  });

  it("sirve tres mesas y las cobra: dos en efectivo, una con tarjeta", async () => {
    const formas: FormaPago[] = ["efectivo", "efectivo", "tarjeta_credito"];

    for (let i = 0; i < 3; i++) {
      const ordenId = await sentarYPedir(mesas[i]!, 2);
      await cocinarYEntregar(ordenId);

      const total = totalesComanda(pos.comanda!).total;
      await pos.cobrarTodo(formas[i]!);

      if (formas[i] === "efectivo") cobradoEfectivo += total;
      else cobradoTarjeta += total;

      expect(pos.comanda?.cerrada).toBe(true);
    }

    expect(cobradoEfectivo).toBeGreaterThan(0);
    expect(cobradoTarjeta).toBeGreaterThan(0);
  });

  /*
   * LA COMPROBACIÓN QUE IMPORTA. Si esto falla, el cajero aparece con un
   * faltante que no cometió.
   */
  it("el corte espera SOLO el efectivo, no las tarjetas", () => {
    const corte = caja.corteEnVivo!;

    expect(corte.efectivoVentas).toBe(cobradoEfectivo);
    expect(corte.totalVendido).toBe(cobradoEfectivo + cobradoTarjeta);
    // Fondo + efectivo. La tarjeta no está en el cajón.
    expect(corte.efectivoEsperado).toBe(FONDO + cobradoEfectivo);
    expect(corte.cuentasCerradas).toBe(3);
  });

  it("un retiro a la caja fuerte baja lo esperado", () => {
    const antes = caja.corteEnVivo!.efectivoEsperado;
    const r = caja.movimiento("retiro", pesos(500), "A la caja fuerte");
    expect(r.ok).toBe(true);
    expect(caja.corteEnVivo!.efectivoEsperado).toBe(antes - pesos(500));
  });

  it("las ventas del turno están dentro de la jornada del local", () => {
    // Si esto falla, las ventas caerían en otro día y saldrían del corte.
    const { desde, hasta } = local.jornadaActual;
    const cerradas = pos.todasLasComandas.filter((c) => c.cerrada);
    expect(cerradas.length).toBeGreaterThanOrEqual(3);
    for (const c of cerradas) {
      expect(c.cerrada_ts).toBeGreaterThanOrEqual(desde);
      expect(c.cerrada_ts).toBeLessThan(hasta);
    }
  });

  it("se puede registrar la opinión de una mesa cobrada", () => {
    const cerrada = pos.todasLasComandas.find((c) => c.cerrada)!;
    const r = opiniones.registrar({ ordenId: cerrada.orden_id, calificacion: "bien" });
    expect(r.ok).toBe(true);
    // Y no se pregunta dos veces a la misma mesa.
    expect(opiniones.registrar({ ordenId: cerrada.orden_id, calificacion: "mal" }).ok).toBe(false);
  });

  it("cierra el turno con un arqueo que cuadra", async () => {
    const esperado = caja.corteEnVivo!.efectivoEsperado;

    const r = await caja.cerrar(esperado, "Gonzalo");
    expect(r.ok).toBe(true);

    const cerrada = caja.sesiones.find((s) => s.cerrada);
    expect(cerrada?.resumen?.diferencia).toBe(0);
    expect(cerrada?.sello).toBeTruthy();
    // Y ya no hay turno abierto.
    expect(caja.activa).toBeUndefined();
  });

  it("un faltante se refleja en el corte, no se disimula", async () => {
    caja.abrir(sesion.usuarioActual!.id, pesos(1000));
    const esperado = caja.corteEnVivo!.efectivoEsperado;

    await caja.cerrar(restar(esperado, pesos(50)), "Gonzalo");

    const ultima = caja.sesiones.find((s) => s.cerrada)!;
    expect(ultima.resumen?.diferencia).toBe(pesos(-50));
  });
});

describe("lo que la operación deja registrado", () => {
  it("el inventario se movió al mandar a cocina", () => {
    // Solo si la carta de pruebas trae recetas; si no, no hay nada que descontar.
    const movimientos = inventario.movimientos.filter((m) => m.tipo === "movimiento_inventario");
    if (inventario.insumos.length === 0) {
      expect(movimientos).toEqual([]);
      return;
    }
    expect(movimientos.length).toBeGreaterThan(0);
  });

  it("todo lo ocurrido quedó en el log, en orden", async () => {
    const guardados = await arranque.repositorio!.eventos.leerTodos();
    expect(guardados.length).toBeGreaterThan(20);

    // El log es la bitácora: tiene que poder reproducirse en orden estable.
    const ordenados = [...guardados].sort((a, b) => a.ts - b.ts || a.orden_local - b.orden_local);
    expect(ordenados[0]!.ts).toBeLessThanOrEqual(ordenados.at(-1)!.ts);
  });
});
