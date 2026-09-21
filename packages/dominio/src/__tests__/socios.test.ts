/**
 * Socios e inversionistas: sus beneficios y su bolsa de consumo del mes.
 *
 * La prueba que da sentido a todo el módulo es la última: **lo que consume un
 * socio sigue siendo una venta**. Si algún día alguien la cambia para que el
 * consumo se descuente de las ventas, el food cost y el ticket promedio del
 * local dejarán de ser ciertos, y eso no se nota hasta que se toma una decisión
 * de compras con esos números.
 */
import { describe, expect, it } from "vitest";
import { CERO, pesos } from "../comun/dinero.js";
import { uuidv7 } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import type { EventoComanda } from "../comanda/eventos.js";
import { proyectarComanda, type EstadoComanda } from "../comanda/reducers.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { totalesComanda } from "../comanda/totales.js";
import { FabricaEventos } from "../evento.js";
import { cuentasCerradasEn, resumenVentas } from "../inteligencia/reportes.js";
import {
  bolsaDelMes,
  consumidoPorSocio,
  mesDe,
  problemaConsumoSocio,
  proyectarSocios,
  sociosActivos,
  valorBeneficio,
  type EventoSocio,
  type Socio,
} from "../organizacion/socios.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-1", sucursal_id: "suc-1" };
const AHORA = new Date(2026, 7, 10, 21, 0).getTime(); // 10-ago-2026, 21:00 local
const SOCIO = "socio-1";

function socio(parcial: Partial<Socio> = {}): Socio {
  return {
    socio_id: SOCIO,
    nombre: "María Fernández",
    beneficios: [{ tipo: "saldo_mensual", valor: pesos(5_000) }],
    activo: true,
    registrado_ts: AHORA - 86_400_000,
    ...parcial,
  };
}

function renglon(precio: number): RenglonComanda {
  return {
    id: uuidv7(), producto_id: "p1", descripcion: "Pizza", cantidad: 1,
    precio_unitario: pesos(precio), costo_unitario: pesos(precio / 3),
    impuesto: snapshotTasas(IVA_16), estado: "entregado",
  };
}

/** Una cuenta cobrada, con la forma de pago que se le indique. */
function cuentaCobrada(opciones: {
  precio: number;
  forma: "efectivo" | "socio";
  socioId?: string;
  ts?: number;
  anulada?: boolean;
}): EstadoComanda {
  const f = new FabricaEventos<EventoComanda>(CTX);
  const orden_id = uuidv7();
  const ts = opciones.ts ?? AHORA;
  const r = renglon(opciones.precio);

  const eventos: EventoComanda[] = [
    f.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-1", abierta_ts: ts }),
    f.crear("item_agregado", orden_id, { orden_id, renglon: r }),
  ];

  if (opciones.anulada) {
    eventos.push(f.crear("orden_anulada", orden_id, { orden_id }));
    return { ...proyectarComanda(eventos), cerrada_ts: ts };
  }

  const total = totalesComanda(proyectarComanda(eventos)).total;
  eventos.push(
    f.crear("pago_registrado", orden_id, {
      orden_id,
      monto: total,
      forma: opciones.forma,
      socio_id: opciones.socioId,
    }),
    f.crear("cuenta_cerrada", orden_id, { orden_id }),
  );

  // El sello se fija a mano: la fábrica usa el reloj real y estas pruebas
  // comparan contra un mes concreto.
  return { ...proyectarComanda(eventos), cerrada_ts: ts };
}

describe("proyección de socios", () => {
  const f = new FabricaEventos<EventoSocio>(CTX);

  it("un alta reaplicada no pisa lo editado después", () => {
    const alta = f.crear("socio_registrado", "socios:suc-1", {
      socio_id: SOCIO,
      datos: { nombre: "María", beneficios: [] },
    });
    const cambio = f.crear("socio_actualizado", "socios:suc-1", {
      socio_id: SOCIO,
      cambios: { nombre: "María Fernández" },
    });

    // El Hub reenvía el alta tras una resincronización: no puede borrar el
    // cambio posterior.
    const socios = proyectarSocios([alta, cambio, alta]);
    expect(socios[0]!.nombre).toBe("María Fernández");
  });

  it("se da de baja, no se borra, y se puede reactivar", () => {
    const alta = f.crear("socio_registrado", "socios:suc-1", {
      socio_id: SOCIO,
      datos: { nombre: "María", beneficios: [] },
    });
    const baja = f.crear("socio_desactivado", "socios:suc-1", {
      socio_id: SOCIO,
      motivo: "Vendió su parte",
    });

    expect(sociosActivos(proyectarSocios([alta, baja]))).toHaveLength(0);
    expect(proyectarSocios([alta, baja])).toHaveLength(1);

    const alta2 = f.crear("socio_reactivado", "socios:suc-1", { socio_id: SOCIO });
    expect(sociosActivos(proyectarSocios([alta, baja, alta2]))).toHaveLength(1);
  });
});

describe("la bolsa del mes", () => {
  it("suma solo lo que se le cargó a ESE socio", () => {
    const comandas = [
      cuentaCobrada({ precio: 1_000, forma: "socio", socioId: SOCIO }),
      cuentaCobrada({ precio: 500, forma: "socio", socioId: "socio-2" }),
      cuentaCobrada({ precio: 800, forma: "efectivo" }),
    ];
    // 1000 + IVA.
    expect(consumidoPorSocio(comandas, SOCIO, mesDe(AHORA))).toBe(pesos(1_160));
  });

  it("no cuenta lo de otros meses", () => {
    const mesPasado = new Date(2026, 6, 10, 21, 0).getTime();
    const comandas = [
      cuentaCobrada({ precio: 1_000, forma: "socio", socioId: SOCIO, ts: mesPasado }),
    ];
    expect(consumidoPorSocio(comandas, SOCIO, mesDe(AHORA))).toBe(CERO);
  });

  it("el crédito amplía el tope, y lo que queda se calcula sobre los dos", () => {
    const conCredito = socio({
      beneficios: [
        { tipo: "saldo_mensual", valor: pesos(5_000) },
        { tipo: "credito_mensual", valor: pesos(3_000) },
      ],
    });
    const bolsa = bolsaDelMes(
      conCredito,
      [cuentaCobrada({ precio: 1_000, forma: "socio", socioId: SOCIO })],
      AHORA,
    );

    expect(bolsa.tope).toBe(pesos(8_000));
    expect(bolsa.consumido).toBe(pesos(1_160));
    expect(bolsa.disponible).toBe(pesos(6_840));
  });

  it("nunca queda en negativo aunque se haya consumido de más", () => {
    const bolsa = bolsaDelMes(
      socio({ beneficios: [{ tipo: "saldo_mensual", valor: pesos(500) }] }),
      [cuentaCobrada({ precio: 1_000, forma: "socio", socioId: SOCIO })],
      AHORA,
    );
    expect(bolsa.disponible).toBe(CERO);
  });
});

describe("qué se le puede cargar a un socio", () => {
  const vacia = bolsaDelMes(socio(), [], AHORA);

  it("deja pasar un cargo dentro de su bolsa", () => {
    expect(problemaConsumoSocio(socio(), pesos(1_000), vacia)).toBeNull();
  });

  it("no deja pasar un cargo mayor que lo que le queda, y dice cuánto le queda", () => {
    const problema = problemaConsumoSocio(socio(), pesos(9_000), vacia);
    expect(problema).toContain("5000.00");
  });

  it("un socio sin bolsa pactada no puede consumir a cuenta", () => {
    const sinBolsa = socio({ beneficios: [] });
    const problema = problemaConsumoSocio(sinBolsa, pesos(100), bolsaDelMes(sinBolsa, [], AHORA));
    expect(problema).toContain("no tiene bolsa");
  });

  it("un socio dado de baja tampoco", () => {
    const baja = socio({ activo: false });
    expect(problemaConsumoSocio(baja, pesos(100), vacia)).toContain("ya no es socio");
  });

  it("los beneficios que no se pactaron valen cero", () => {
    expect(valorBeneficio(socio(), "descuento_permanente")).toBe(0);
    expect(valorBeneficio(socio(), "saldo_mensual")).toBe(pesos(5_000));
  });
});

/*
 * LA REGLA QUE SOSTIENE EL DISEÑO, y que CAMBIÓ en la 1.5.6.
 *
 * Hasta la 1.5.5, el consumo de un socio contaba como venta: el platillo salió
 * y el consumo fue real. Gonzalo lo cambió con un argumento que pesa más: a la
 * caja no entró un peso, así que la venta del día salía inflada y el sistema
 * esperaba facturar algo que nadie compró.
 *
 * Ahora la venta NO lo incluye y el COSTO sí: esos insumos se gastaron, y es lo
 * que de verdad le cuesta el acuerdo al negocio. Si estas pruebas se caen, los
 * reportes volvieron a mezclar lo que entró con lo que se regaló.
 */
describe("el consumo de un socio NO es una venta (1.5.6)", () => {
  it("no suma a la venta, y se informa aparte", () => {
    const rango = mesDe(AHORA);
    const delSocio = resumenVentas(
      cuentasCerradasEn([cuentaCobrada({ precio: 1_000, forma: "socio", socioId: SOCIO })], rango),
    );

    expect(delSocio.total).toBe(CERO);
    expect(delSocio.subtotal).toBe(CERO);
    expect(delSocio.consumo_socios).toBeGreaterThan(0);
    expect(delSocio.cuentas_con_socio).toBe(1);
    // La mesa se atendió: sigue siendo una cuenta cobrada del día.
    expect(delSocio.cuentas).toBe(1);
  });

  it("el mismo consumo cobrado en efectivo sí es venta", () => {
    const rango = mesDe(AHORA);
    const enEfectivo = resumenVentas(
      cuentasCerradasEn([cuentaCobrada({ precio: 1_000, forma: "efectivo" })], rango),
    );
    expect(enEfectivo.total).toBeGreaterThan(0);
    expect(enEfectivo.consumo_socios).toBe(CERO);
  });

  /*
   * LA CUENTA MIXTA: el socio pone una parte y el resto se cobra. Es el caso de
   * la mesa donde el socio invita a dos y los demás pagan lo suyo. Solo sale de
   * la venta la parte que cubrió su bolsa.
   */
  it("en una cuenta mixta solo sale de la venta la parte del socio", () => {
    const fab = new FabricaEventos<EventoComanda>(CTX);
    const orden_id = uuidv7();
    const r = renglon(1_000);
    const eventos: EventoComanda[] = [
      fab.crear("orden_creada", orden_id, { orden_id, mesa_id: "mesa-1", abierta_ts: AHORA }),
      fab.crear("item_agregado", orden_id, { orden_id, renglon: r }),
    ];
    const total = totalesComanda(proyectarComanda(eventos)).total;
    const mitad = Math.round(total / 2) as typeof total;
    eventos.push(
      fab.crear("pago_registrado", orden_id, { orden_id, monto: mitad, forma: "socio", socio_id: SOCIO }),
      fab.crear("pago_registrado", orden_id, { orden_id, monto: (total - mitad) as typeof total, forma: "efectivo" }),
      fab.crear("cuenta_cerrada", orden_id, { orden_id }),
    );
    const cuenta = { ...proyectarComanda(eventos), cerrada_ts: AHORA };

    const r2 = resumenVentas(cuentasCerradasEn([cuenta], mesDe(AHORA)));
    expect(r2.consumo_socios).toBe(mitad);
    // Lo que queda es la otra mitad, al centavo.
    expect(r2.total).toBe((total - mitad) as typeof total);
    // Y el impuesto baja con ella: no queda un IVA sin venta que lo sostenga.
    expect(r2.iva).toBeGreaterThan(0);
    expect(r2.subtotal + r2.iva + r2.ieps).toBe(r2.total);
  });

  it("el costo de lo que consumió el socio SIGUE contando: se gastó", () => {
    const rango = mesDe(AHORA);
    const cuenta = cuentaCobrada({ precio: 1_000, forma: "socio", socioId: SOCIO });
    const delSocio = resumenVentas(cuentasCerradasEn([cuenta], rango));
    const enEfectivo = resumenVentas(
      cuentasCerradasEn([cuentaCobrada({ precio: 1_000, forma: "efectivo" })], rango),
    );
    expect(delSocio.costo).toBe(enEfectivo.costo);
  });

  it("en cambio, una mesa liberada sin consumo NO cuenta como cuenta", () => {
    const rango = mesDe(AHORA);
    const r = resumenVentas(
      cuentasCerradasEn([cuentaCobrada({ precio: 100, forma: "efectivo", anulada: true })], rango),
    );
    expect(r.cuentas).toBe(0);
    expect(r.total).toBe(CERO);
  });
});
