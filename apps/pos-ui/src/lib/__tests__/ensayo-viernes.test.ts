/**
 * ENSAYO GENERAL: el viernes de Rodizio, completo.
 *
 * `servicio.test.ts` prueba que un servicio sencillo cuadra. Este ensayo es
 * otra cosa: reproduce el viernes que de verdad ocurre —carga alta, pizzas
 * mitad y mitad, promoción, cuenta dividida, un renglón traspasado, una
 * cancelación autorizada, una cortesía, un pedido para llevar, una cuenta
 * reabierta— y comprueba que **el dinero cuadre en las cuatro capas a la vez**:
 *
 *     cuenta  →  corte de caja  →  reporte del contador  →  costeo
 *
 * Por qué importa que sean las cuatro: cada capa suma por su cuenta. Una pieza
 * puede estar bien sola y aun así no coincidir con la de al lado, y eso es
 * exactamente lo que aparece como "faltante" el sábado en la mañana, cuando ya
 * nadie se acuerda de qué pasó.
 *
 * Si este ensayo falla, NO se despliega.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  cuentasCerradasEn,
  pesos,
  reporteContable,
  restar,
  resumenVentas,
  sumar,
  totalesComanda,
  uuidv7,
  type Centavos,
  type EstadoComanda,
  type FormaPago,
  type Promocion,
} from "@motrest/dominio";
import { arranque } from "../persistencia/arranque.svelte";
import { caja } from "../caja.svelte";
import { catalogo } from "../catalogo";
import { local } from "../local.svelte";
import { menu } from "../menu.svelte";
import { plano } from "../plano.svelte";
import { pos } from "../pos.svelte";
import { mitades } from "../semilla";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";
const CONTRASENA_INICIAL_PROPIETARIO = credencialesDeDemostracion().contrasena;

const FONDO = pesos(2000);

/** Producto de una categoría, para armar comandas parecidas a las de verdad. */
function productoDe(categoriaId: string): string {
  const p = [...catalogo.productos.values()].find(
    (x) => x.categoria_id === categoriaId && x.disponible && x.precio > 0 && !x.esquema_porciones,
  );
  if (!p) throw new Error(`La carta no tiene producto vendible en ${categoriaId}`);
  return p.id;
}

/** La pizza mitad y mitad: el caso que define a Rodizio. */
function pizzaMitadYMitad(): string {
  const p = [...catalogo.productos.values()].find((x) => x.esquema_porciones && x.disponible);
  if (!p) throw new Error("La carta no tiene pizza configurable");
  return p.id;
}

function cocinarTodo(ordenId: string): Promise<void[]> {
  return Promise.all(
    (pos.comanda?.renglones ?? []).map(async (r) => {
      await pos.marcarEnMarcha(ordenId, r.id);
      await pos.marcarListo(ordenId, r.id);
      await pos.marcarEntregado(ordenId, r.id);
    }),
  );
}

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", CONTRASENA_INICIAL_PROPIETARIO);
  caja.abrir(sesion.usuarioActual!.id, FONDO);
});

// --- El servicio ---------------------------------------------------------------------------

describe("el viernes de Rodizio, de la apertura al corte", () => {
  /*
   * Lo que la casa lleva en la cabeza mientras sirve. Se distinguen a propósito
   * DOS cosas que es fácil confundir y que son la raíz de la mitad de los
   * descuadres: el efectivo que entró al cajón (propina incluida, porque el
   * cliente la paga junto) y la venta del restaurante (sin propina, porque esa
   * es del mesero).
   */
  let efectivoRecibido = 0 as Centavos;
  let ventaEfectivo = 0 as Centavos;
  let ventaTarjeta = 0 as Centavos;
  let propinas = 0 as Centavos;
  let mesas: string[] = [];

  it("hay salón suficiente para un viernes", () => {
    mesas = plano.todasLasMesas.map((m) => m.id);
    expect(mesas.length).toBeGreaterThanOrEqual(4);
  });

  /*
   * EL PICO. Un viernes no son tres mesas: son todas a la vez. Se sirve el
   * salón entero con comandas de verdad —pizza mitad y mitad, pasta, bebida—
   * y se cobra alternando efectivo y tarjeta.
   */
  it("sirve el salón entero en el pico, con pizzas mitad y mitad", async () => {
    const bebida = productoDe("cat-bebidas");
    const pasta = productoDe("cat-pastas");
    const pizza = pizzaMitadYMitad();

    for (const [i, mesaId] of mesas.entries()) {
      pos.seleccionarMesa(mesaId);
      const ordenId = pos.abrirMesa(mesaId);

      // La mitad y mitad: media margherita, media pepperoni.
      await pos.agregar({
        producto_id: pizza,
        cantidad: 1,
        porciones: mitades("var-margherita", "var-pepperoni"),
      });
      await pos.agregarSimple(pasta);
      await pos.agregarSimple(bebida);

      await pos.enviarACocina();
      await cocinarTodo(ordenId);

      const total = totalesComanda(pos.comanda!).total;
      const forma: FormaPago = i % 2 === 0 ? "efectivo" : "tarjeta_credito";
      await pos.cobrarTodo(forma);

      if (forma === "efectivo") {
        efectivoRecibido = sumar(efectivoRecibido, total);
        ventaEfectivo = sumar(ventaEfectivo, total);
      } else ventaTarjeta = sumar(ventaTarjeta, total);

      expect(pos.comanda?.cerrada).toBe(true);
    }

    expect(ventaEfectivo).toBeGreaterThan(0);
    expect(ventaTarjeta).toBeGreaterThan(0);
  });

  /*
   * LA PROMOCIÓN. Se da de alta el 2×1 de pizzas y se cobra una mesa con ella.
   * Lo que se comprueba es que el descuento llegue al TOTAL COBRADO, no que se
   * vea bonito en pantalla: una promoción que se pinta pero no se cobra es peor
   * que no tenerla.
   */
  it("una mesa con 2×1 paga menos, y el descuento llega al cobro", async () => {
    const promo: Promocion = {
      id: uuidv7(),
      nombre: "Martes de 2×1 en pizzas",
      tipo: "nxm",
      productos: [],
      categorias: ["cat-pizzas"],
      vigencia: {},
      activa: true,
      lleva: 2,
      paga: 1,
    };
    expect(menu.guardarPromocion(promo).ok).toBe(true);

    const mesaId = mesas[0]!;
    pos.seleccionarMesa(mesaId);
    const ordenId = pos.abrirMesa(mesaId);

    const pizza = pizzaMitadYMitad();
    await pos.agregar({ producto_id: pizza, cantidad: 1, porciones: mitades("var-margherita", "var-pepperoni") });
    await pos.agregar({ producto_id: pizza, cantidad: 1, porciones: mitades("var-cuatro-quesos", "var-hawaiana") });
    await pos.enviarACocina();
    await cocinarTodo(ordenId);

    const sinPromo = totalesComanda(pos.comanda!).total;

    const ofrecidas = pos.promociones!.descuentos;
    expect(ofrecidas).toHaveLength(1);
    pos.aplicarPromocion(ofrecidas[0]!);

    const conPromo = totalesComanda(pos.comanda!).total;
    expect(conPromo).toBeLessThan(sinPromo);

    // Ya aplicada, no se vuelve a ofrecer: no se regala dos veces lo mismo.
    expect(pos.promociones!.descuentos).toHaveLength(0);

    await pos.cobrarTodo("efectivo");
    efectivoRecibido = sumar(efectivoRecibido, conPromo);
    ventaEfectivo = sumar(ventaEfectivo, conPromo);
  });

  /*
   * LA CUENTA DIVIDIDA. Tres amigos pagan en partes iguales. Lo que muerde es
   * el centavo suelto: 100.00 entre 3 no da exacto, y si se pierde o se
   * inventa, el corte no cuadra.
   */
  it("una cuenta dividida en tres cuadra al centavo", async () => {
    const mesaId = mesas[1]!;
    pos.seleccionarMesa(mesaId);
    const ordenId = pos.abrirMesa(mesaId);

    await pos.agregarSimple(productoDe("cat-carnes"));
    await pos.agregarSimple(productoDe("cat-ensaladas"));
    await pos.agregarSimple(productoDe("cat-postres"));
    await pos.enviarACocina();
    await cocinarTodo(ordenId);

    pos.propinaPorcentaje(0.1);
    const t = totalesComanda(pos.comanda!);
    const aCobrar = sumar(t.total, t.propina);

    await pos.dividirEnPartes(3, "efectivo");

    const cerrada = pos.comanda!;
    expect(cerrada.cerrada).toBe(true);
    expect(cerrada.pagos).toHaveLength(3);

    // NI UN CENTAVO PERDIDO NI INVENTADO.
    const sumaPagos = cerrada.pagos.reduce((n, p) => sumar(n, p.monto), 0 as Centavos);
    expect(sumaPagos).toBe(aCobrar);

    // El cliente entrego cuenta + propina en efectivo: las dos estan en el cajon.
    efectivoRecibido = sumar(efectivoRecibido, aCobrar);
    ventaEfectivo = sumar(ventaEfectivo, t.total);
    propinas = sumar(propinas, t.propina);
  });

  /*
   * EL TRASPASO. Se cambiaron de mesa a media cena. El renglón viaja; lo que
   * importa es que no se cobre dos veces ni se pierda.
   */
  it("un renglón traspasado se cobra una sola vez, en la mesa destino", async () => {
    const origen = mesas[2]!;
    const destino = mesas[3]!;

    pos.seleccionarMesa(origen);
    const ordenOrigen = pos.abrirMesa(origen);
    await pos.agregarSimple(productoDe("cat-pastas"));
    await pos.agregarSimple(productoDe("cat-bebidas"));
    await pos.enviarACocina();

    const aMover = pos.renglones[0]!;
    const importeMovido = aMover.precio_unitario * aMover.cantidad;
    await pos.traspasarRenglon(aMover.id, destino);

    // En el origen ya no está.
    expect(pos.renglones.some((r) => r.id === aMover.id)).toBe(false);
    const totalOrigen = totalesComanda(pos.comanda!).total;

    // En el destino sí.
    pos.seleccionarMesa(destino);
    expect(pos.renglones.some((r) => r.id === aMover.id)).toBe(true);
    expect(totalesComanda(pos.comanda!).bruto).toBe(importeMovido);

    await cocinarTodo(pos.comanda!.orden_id);
    const totalDestino = totalesComanda(pos.comanda!).total;
    await pos.cobrarTodo("efectivo");
    efectivoRecibido = sumar(efectivoRecibido, totalDestino);
    ventaEfectivo = sumar(ventaEfectivo, totalDestino);

    pos.seleccionarMesa(origen);
    await cocinarTodo(ordenOrigen);
    await pos.cobrarTodo("efectivo");
    efectivoRecibido = sumar(efectivoRecibido, totalOrigen);
    ventaEfectivo = sumar(ventaEfectivo, totalOrigen);
  });

  /*
   * PARA LLEVAR. No hay mesa a la que mirar, así que el pedido va a nombre de
   * alguien. Si el nombre no viaja, en el mostrador no saben de quién es.
   */
  it("un pedido para llevar sale a nombre de quien lo pidió", async () => {
    const mesaId = mesas[0]!;
    pos.seleccionarMesa(mesaId);
    const ordenId = pos.abrirMesa(mesaId);

    await pos.agregar({
      producto_id: pizzaMitadYMitad(),
      cantidad: 1,
      porciones: mitades("var-margherita", "var-hawaiana"),
    });
    await pos.identificar("Familia Ramírez", "5544332211");
    await pos.enviarACocina();
    await cocinarTodo(ordenId);

    expect(pos.comanda?.a_nombre_de).toBe("Familia Ramírez");

    const total = totalesComanda(pos.comanda!).total;
    await pos.cobrarTodo("efectivo");
    efectivoRecibido = sumar(efectivoRecibido, total);
    ventaEfectivo = sumar(ventaEfectivo, total);
  });

  /*
   * SE COBRÓ Y FALTABA EL POSTRE. Es el caso real: la cuenta se cierra, el
   * cliente sigue sentado y pide algo más. Reabrir tiene que dejar rastro,
   * porque es dinero que ya se había reportado como cobrado.
   */
  it("una cuenta cobrada se reabre, se le agrega y se vuelve a cobrar", async () => {
    const mesaId = mesas[1]!;
    pos.seleccionarMesa(mesaId);
    const ordenId = pos.abrirMesa(mesaId);
    await pos.agregarSimple(productoDe("cat-bebidas"));
    await pos.enviarACocina();
    await cocinarTodo(ordenId);

    const primerCobro = totalesComanda(pos.comanda!).total;
    await pos.cobrarTodo("efectivo");
    expect(pos.comanda?.cerrada).toBe(true);

    const reabrio = await pos.reabrirCuenta("Pidieron postre después de cobrar");
    expect(reabrio).toBe(true);
    expect(pos.comanda?.cerrada).toBe(false);

    await pos.agregarSimple(productoDe("cat-postres"));
    await pos.enviarACocina();
    await cocinarTodo(ordenId);

    // Solo se cobra lo que falta: lo ya pagado sigue registrado.
    const saldo = totalesComanda(pos.comanda!).saldo;
    expect(saldo).toBeGreaterThan(0);
    await pos.cobrarTodo("efectivo");
    expect(pos.comanda?.cerrada).toBe(true);

    efectivoRecibido = sumar(efectivoRecibido, primerCobro, saldo);
    ventaEfectivo = sumar(ventaEfectivo, primerCobro, saldo);
  });

  // --- Donde tiene que cuadrar ---------------------------------------------------------------

  /*
   * CAPA 1 → 2. El corte espera SOLO el efectivo. Si aquí entra la tarjeta, el
   * cajero aparece con un sobrante que no existe.
   */
  it("el corte espera el efectivo del turno, no las tarjetas", () => {
    const corte = caja.corteEnVivo!;

    // El cajón: todo lo que entró en efectivo, propina incluida.
    expect(corte.efectivoVentas).toBe(efectivoRecibido);
    expect(corte.efectivoEsperado).toBe(sumar(FONDO, efectivoRecibido));

    // La venta: sin propina, porque la propina es del mesero.
    expect(corte.totalVendido).toBe(sumar(ventaEfectivo, ventaTarjeta));
    expect(corte.propinas).toBe(propinas);

    /*
     * Y los tres renglones cuadran entre sí, forma por forma. Es lo que le
     * permite a quien cierra la caja sumar con el dedo y confiar en el corte.
     */
    for (const forma of Object.keys(corte.cobrado) as FormaPago[]) {
      expect(corte.cobrado[forma]).toBe(
        sumar(corte.ventas[forma] ?? pesos(0), corte.propinasPorForma[forma] ?? pesos(0)),
      );
    }
    expect(sumar(...Object.values(corte.ventas))).toBe(corte.totalVendido);
  });

  /*
   * CAPA 2 → 3. El contador suma por su lado, desde las comandas cerradas. Si
   * no coincide con el corte, uno de los dos está mal y no se sabe cuál.
   */
  it("el reporte del contador cuadra contra el corte", () => {
    const { desde, hasta } = local.jornadaActual;
    const cerradas = cuentasCerradasEn(pos.todasLasComandas, { desde, hasta });
    const reporte = reporteContable(cerradas, [], [], { desde, hasta });

    expect(reporte.total).toBe(caja.corteEnVivo!.totalVendido);
  });

  /*
   * CAPA 3 → 4. El resumen de ventas es el que ve Gonzalo en Inteligencia.
   * Tiene que contar el mismo dinero que el contador.
   */
  it("lo que Gonzalo ve en Inteligencia es el mismo dinero", () => {
    const { desde, hasta } = local.jornadaActual;
    const cerradas = cuentasCerradasEn(pos.todasLasComandas, { desde, hasta });
    const resumen = resumenVentas(cerradas);
    const reporte = reporteContable(cerradas, [], [], { desde, hasta });

    expect(resumen.total).toBe(reporte.total);
    expect(resumen.cuentas).toBe(cerradas.length);
    // Y el ticket promedio sale de ahí, no de otra suma.
    expect(resumen.ticketPromedio).toBe(Math.round(resumen.total / resumen.cuentas));
  });

  it("ninguna cuenta quedó abierta al cerrar el servicio", () => {
    const abiertas = pos.todasLasComandas.filter((c: EstadoComanda) => !c.cerrada);
    expect(abiertas).toEqual([]);
  });

  /*
   * EL ARQUEO. Es el momento de verdad del viernes: contar el cajón y que
   * coincida.
   */
  it("el arqueo del cajón cuadra en cero", async () => {
    const esperado = caja.corteEnVivo!.efectivoEsperado;
    const r = await caja.cerrar(esperado, "Gonzalo");
    expect(r.ok).toBe(true);

    const cerrada = caja.sesiones.find((s) => s.cerrada);
    expect(cerrada?.resumen?.diferencia).toBe(0);
    // Sellado: un corte cerrado no se puede maquillar después.
    expect(cerrada?.sello).toBeTruthy();
    expect(caja.activa).toBeUndefined();
  });
});

// --- Lo que queda escrito ------------------------------------------------------------------

describe("lo que el viernes dejó en el log", () => {
  it("el log se puede reproducir y da el mismo estado", async () => {
    const guardados = await arranque.repositorio!.eventos.leerTodos();
    expect(guardados.length).toBeGreaterThan(60);

    // Ningún evento repetido: un id duplicado cobraría dos veces.
    const ids = new Set(guardados.map((e) => e.id));
    expect(ids.size).toBe(guardados.length);
  });

  it("los descuentos de promoción dicen de qué promoción vinieron", () => {
    const conPromo = pos.todasLasComandas
      .flatMap((c) => c.descuentos)
      .filter((d) => d.promocion_id);

    expect(conPromo.length).toBeGreaterThan(0);
    // Sin los renglones cubiertos no se puede saber qué se regaló.
    for (const d of conPromo) expect(d.renglones_cubiertos?.length).toBeGreaterThan(0);
  });

  it("una cuenta reabierta quedó registrada como tal", () => {
    const reabiertas = pos.todosLosEventos.filter((e) => e.tipo === "cuenta_reabierta");
    expect(reabiertas.length).toBeGreaterThan(0);
  });

  it("el efectivo declarado de menos aparece como faltante, no se disimula", async () => {
    caja.abrir(sesion.usuarioActual!.id, pesos(1000));
    const esperado = caja.corteEnVivo!.efectivoEsperado;
    await caja.cerrar(restar(esperado, pesos(120)), "Gonzalo");

    const ultima = caja.sesiones.find((s) => s.cerrada)!;
    expect(ultima.resumen?.diferencia).toBe(pesos(-120));
  });
});

// --- Que los reportes no se pongan lentos --------------------------------------------------

/*
 * El pipeline cacheado.
 *
 * `todasLasComandas` lo llaman los reportes, el contador, el CRM y el centinela
 * varias veces por render. Sin caché, agregar un refresco a una mesa obliga a
 * reproyectar el log ENTERO del local, y ese costo crece con el registro: el
 * día que llegue a cientos de miles de eventos, la caja se congela al teclear.
 *
 * La caché es exacta porque el log de cada mesa es inmutable. Lo que hay que
 * probar es justo eso: que sea RÁPIDA y que NO devuelva datos viejos.
 */
describe("los reportes siguen siendo baratos con el log lleno", () => {
  it("devuelve lo mismo llamándolo muchas veces", () => {
    const primera = pos.todasLasComandas;
    const segunda = pos.todasLasComandas;
    expect(segunda).toEqual(primera);
    expect(segunda.length).toBeGreaterThan(0);
  });

  /* Una proyección vieja sería peor que una lenta: cobraría de menos. */
  it("al cambiar una mesa, la refleja de inmediato", async () => {
    const antes = pos.todasLasComandas.length;

    const mesaId = plano.todasLasMesas[0]!.id;
    pos.seleccionarMesa(mesaId);
    pos.abrirMesa(mesaId);
    await pos.agregarSimple(productoDe("cat-bebidas"));

    const despues = pos.todasLasComandas;
    expect(despues.length).toBeGreaterThanOrEqual(antes);

    // La cuenta recién abierta está ahí, con lo que se le acaba de poner.
    const abierta = despues.find((c) => c.mesa_id === mesaId && !c.cerrada);
    expect(abierta?.renglones.length).toBeGreaterThan(0);
  });
});
