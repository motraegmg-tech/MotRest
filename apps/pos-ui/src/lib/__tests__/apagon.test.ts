/**
 * El apagón de media noche.
 *
 * Es el escenario que de verdad va a ocurrir en Rodizio: se va la luz —o
 * alguien cierra la aplicación por error— con mesas servidas, la caja abierta y
 * cuentas a medio cobrar. Al reencender, TODO tiene que estar donde estaba.
 *
 * La prueba de persistencia comprueba que los eventos se guardan. Esta va más
 * lejos: reconstruye el estado exactamente como lo hace el arranque real y
 * compara lo que ve el restaurante antes y después. La diferencia importa,
 * porque un evento guardado que nadie rehidrata es un evento perdido.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  pesos,
  proyectarCaja,
  proyectarComanda,
  agruparPorMesa,
  totalesComanda,
  type EventoCaja,
  type EventoComanda,
} from "@motrest/dominio";
import { arranque } from "../persistencia/arranque.svelte";
import { caja } from "../caja.svelte";
import { catalogo } from "../catalogo";
import { plano } from "../plano.svelte";
import { pos } from "../pos.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { CONTRASENA_INICIAL_PROPIETARIO } from "../sesion/usuarios";

function algunProducto(): string {
  const p = [...catalogo.productos.values()].find((x) => x.disponible && x.precio > 0);
  if (!p) throw new Error("Sin productos vendibles en la carta de pruebas");
  return p.id;
}

/**
 * Lo que vería el restaurante al reencender: se relee el log del disco y se
 * reproyecta, igual que hace `arranque.iniciar()`.
 */
async function alReencender() {
  const guardados = await arranque.repositorio!.eventos.leerTodos();

  const comanda = guardados.filter((e) =>
    ["orden_creada", "item_agregado", "items_enviados", "pago_registrado", "cuenta_cerrada"].includes(
      (e as EventoComanda).tipo,
    ),
  ) as EventoComanda[];

  const cajaEv = guardados.filter((e) =>
    ["caja_abierta", "movimiento_efectivo", "arqueo_registrado", "caja_cerrada"].includes(
      (e as EventoCaja).tipo,
    ),
  ) as EventoCaja[];

  return {
    porMesa: agruparPorMesa(comanda),
    caja: cajaEv.length > 0 ? proyectarCaja(cajaEv) : null,
  };
}

let mesaServida: string;
let mesaCobrada: string;
let totalServida = 0;

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", CONTRASENA_INICIAL_PROPIETARIO);

  const mesas = plano.todasLasMesas.map((m) => m.id);
  mesaServida = mesas[0]!;
  mesaCobrada = mesas[1]!;

  caja.abrir(sesion.usuarioActual!.id, pesos(2000));

  // Una mesa servida y SIN cobrar: es la que más duele perder.
  pos.seleccionarMesa(mesaServida);
  pos.abrirMesa(mesaServida);
  await pos.agregarSimple(algunProducto());
  await pos.agregarSimple(algunProducto());
  await pos.enviarACocina();
  totalServida = totalesComanda(pos.comanda!).total;

  // Otra ya cobrada, para comprobar que el cobro también sobrevive.
  pos.seleccionarMesa(mesaCobrada);
  pos.abrirMesa(mesaCobrada);
  await pos.agregarSimple(algunProducto());
  await pos.enviarACocina();
  await pos.cobrarTodo("efectivo");

  // Un retiro, que es lo que más se olvida al reconstruir un turno.
  caja.movimiento("retiro", pesos(300), "Pago al de las tortillas");
});

describe("se va la luz a media operación", () => {
  it("la mesa servida y sin cobrar sigue ahí, con lo suyo", async () => {
    const { porMesa } = await alReencender();
    const log = porMesa[mesaServida];
    expect(log).toBeDefined();

    const comanda = proyectarComanda(log!);
    expect(comanda.cerrada).toBe(false);
    expect(comanda.renglones).toHaveLength(2);
    expect(totalesComanda(comanda).total).toBe(totalServida);
  });

  it("la mesa cobrada sigue cobrada: no se puede volver a cobrar", async () => {
    const { porMesa } = await alReencender();
    const comanda = proyectarComanda(porMesa[mesaCobrada]!);

    expect(comanda.cerrada).toBe(true);
    expect(comanda.pagos.length).toBeGreaterThan(0);
  });

  /*
   * Si el turno no sobrevive, el corte arranca de cero: el fondo desaparece y
   * las ventas del turno se le cargan al siguiente. Es dinero.
   */
  it("el turno de caja sigue abierto, con su fondo y su retiro", async () => {
    const { caja: reconstruida } = await alReencender();

    expect(reconstruida).not.toBeNull();
    expect(reconstruida!.cerrada).toBe(false);
    expect(reconstruida!.fondo_inicial).toBe(pesos(2000));
    expect(reconstruida!.movimientos).toHaveLength(1);
    expect(reconstruida!.movimientos[0]!.monto).toBe(pesos(-300));
  });

  it("lo que se ve en pantalla es lo mismo que hay en disco", async () => {
    const { porMesa } = await alReencender();

    for (const mesaId of [mesaServida, mesaCobrada]) {
      const enDisco = proyectarComanda(porMesa[mesaId]!);
      pos.seleccionarMesa(mesaId);
      const enPantalla = pos.comanda!;

      // La igualdad que importa: el dinero y el estado de la cuenta.
      expect(totalesComanda(enDisco).total).toBe(totalesComanda(enPantalla).total);
      expect(enDisco.cerrada).toBe(enPantalla.cerrada);
      expect(enDisco.renglones.length).toBe(enPantalla.renglones.length);
    }
  });

  it("el corte en vivo cuadra tras el reinicio", () => {
    const corte = caja.corteEnVivo!;
    // Fondo 2000 − retiro 300 + lo cobrado en efectivo.
    expect(corte.efectivoEsperado).toBe(pesos(2000) - pesos(300) + corte.efectivoVentas);
    expect(corte.efectivoVentas).toBeGreaterThan(0);
  });
});
