/**
 * Llegaron diez y la mesa es de cuatro.
 *
 * Antes de la 1.3.5 esto se resolvía de dos maneras, las dos malas: abrir una
 * cuenta por mesa —y cobrarle dos veces al mismo grupo, con dos tickets y dos
 * comandas a cocina— o cargarlo todo a una mesa y dejar la otra marcada «libre»
 * con gente sentada, que es como se le da una mesa ocupada a otra pareja.
 *
 * Lo que se comprueba aquí es que juntar mesas produce **una sola cuenta**: un
 * ticket, una comanda, un cobro, y las dos mesas ocupadas y liberadas a la vez.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mesasDeComanda, pesos } from "@motrest/dominio";
import { arranque } from "../persistencia/arranque.svelte";
import { caja } from "../caja.svelte";
import { catalogo } from "../catalogo";
import { plano } from "../plano.svelte";
import { pos } from "../pos.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

const CONTRASENA = credencialesDeDemostracion().contrasena;

function algunProducto(): string {
  const p = [...catalogo.productos.values()].find((x) => x.disponible && x.precio > 0);
  if (!p) throw new Error("La carta de pruebas no tiene ningún producto vendible");
  return p.id;
}

/*
 * El arranque de pruebas siembra un salón con mesas ya servidas, así que nada
 * aquí puede contar cuentas en absoluto: se cuenta la DIFERENCIA que provoca lo
 * que hace la prueba.
 */
function mesasLibres(): string[] {
  return plano.todasLasMesas.filter((m) => pos.estadoMesa(m.id) === "libre").map((m) => m.id);
}

/** Dos mesas libres del mismo salón, que es lo único que se puede juntar. */
function dosMesasLibresDelMismoArea(): [string, string] {
  const libres = plano.todasLasMesas.filter((m) => pos.estadoMesa(m.id) === "libre");
  for (const a of libres) {
    const b = libres.find((otra) => otra.id !== a.id && otra.area_id === a.area_id);
    if (b) return [a.id, b.id];
  }
  throw new Error("El plano de pruebas no tiene dos mesas libres en la misma área");
}

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", CONTRASENA);
  caja.abrir(sesion.usuarioActual!.id, pesos(1500));
});

describe("juntar dos mesas en una sola cuenta", () => {
  let principal = "";
  let unida = "";

  it("las junta y abre UNA cuenta, no dos", async () => {
    [principal, unida] = dosMesasLibresDelMismoArea();
    const antes = pos.comandasAbiertas.length;

    pos.seleccionarMesa(principal);
    await pos.juntarMesas([unida]);

    // Dos mesas ocupadas, UNA cuenta nueva. Antes se abría una por mesa.
    expect(pos.comandasAbiertas.length).toBe(antes + 1);

    const cuenta = pos.comandaDeMesa(principal);
    expect(cuenta?.mesa_id).toBe(principal);
    expect(mesasDeComanda(cuenta!)).toEqual([principal, unida]);
    // La mesa unida no tiene log propio: su cuenta es la de la principal.
    expect(pos.comandaDeMesa(unida)).toBeNull();
  });

  it("las dos mesas quedan ocupadas", () => {
    expect(pos.estadoMesa(principal)).not.toBe("libre");
    expect(pos.estadoMesa(unida)).not.toBe("libre");
    expect(pos.estaUnida(unida)).toBe(true);
    expect(pos.estaUnida(principal)).toBe(false);
  });

  /*
   * El mesero toca la mesa 4 porque el grupo de la 3+4 le pidió algo. Si eso
   * abriera una cuenta vacía de la 4, tendría que adivinar cuál de las dos «es»
   * la cuenta — o sea, conocer la implementación.
   */
  it("tocar la mesa unida lleva a la cuenta que la lleva", () => {
    pos.seleccionarMesa(unida);
    expect(pos.mesaActiva).toBe(principal);
    expect(pos.comanda?.mesa_id).toBe(principal);
  });

  it("se llama por las dos mesas: en la pantalla y en el ticket", () => {
    const esperado = `${plano.nombreMesa(principal)} + ${plano.nombreMesa(unida)}`;
    expect(pos.nombreMesaActiva).toBe(esperado);
    expect(pos.mesasDeLaCuentaActiva).toEqual([principal, unida]);
  });

  it("lo que se pide va a una sola comanda", async () => {
    const antes = pos.comandasAbiertas.length;

    await pos.agregarSimple(algunProducto());
    await pos.agregarSimple(algunProducto());

    expect(pos.comandasAbiertas.length).toBe(antes);
    expect(pos.renglones).toHaveLength(2);
    expect(pos.comandaDeMesa(unida)).toBeNull();
  });

  /*
   * Entre que el mesero abre el selector y confirma, otra terminal pudo sentar
   * a alguien. Si eso no se comprobara al confirmar, la mesa de los otros
   * quedaría enganchada a esta cuenta.
   */
  it("no se junta una mesa que ya está ocupada", async () => {
    const otra = mesasLibres().find((id) => id !== principal && id !== unida);
    expect(otra).toBeDefined();

    const antes = pos.comandasAbiertas.length;
    pos.seleccionarMesa(otra!);
    await pos.juntarMesas([unida]);

    expect(pos.comandasAbiertas.length).toBe(antes);
    expect(pos.estadoMesa(otra!)).toBe("libre");
  });

  it("al cobrar se liberan las dos juntas", async () => {
    pos.seleccionarMesa(principal);
    await pos.enviarACocina();
    await pos.cobrarTodo("efectivo");

    expect(pos.comanda?.cerrada).toBe(true);
    expect(pos.estadoMesa(principal)).toBe("libre");
    expect(pos.estadoMesa(unida)).toBe("libre");
    expect(pos.estaUnida(unida)).toBe(false);
  });
});

describe("una mesa sola sigue funcionando igual", () => {
  it("abrirla sin juntar nada no escribe unión ninguna", async () => {
    const [sola] = dosMesasLibresDelMismoArea();
    pos.seleccionarMesa(sola);
    pos.abrirMesa(sola);

    const comanda = pos.comandaDeMesa(sola);
    expect(comanda?.mesas_unidas).toBeUndefined();
    expect(mesasDeComanda(comanda!)).toEqual([sola]);
    expect(pos.nombreMesaActiva).toBe(plano.nombreMesa(sola));

    await pos.liberarMesa();
  });
});
